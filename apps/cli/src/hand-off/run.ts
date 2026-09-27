import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { z } from "zod";

import { HandoffDraftInputSchema, type HandoffDraftInput } from "../capture-input.js";
import type { LocalPassportWorkflow } from "../local-workflow.js";
import { findAgentSessions, type AgentSession, type SourceAgentKind } from "./sessions.js";

const AGENT_TIMEOUT_MS = 5 * 60 * 1000;

const AGENT_NAMES: Record<SourceAgentKind, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
};

export type HandOffRun =
  | { readonly status: "idle" }
  | {
      readonly status: "running" | "succeeded" | "failed";
      readonly agent: SourceAgentKind;
      readonly agentName: string;
      readonly repositoryPath: string;
      readonly startedAt: string;
      readonly finishedAt?: string;
      readonly projectId?: string;
      readonly error?: string;
    };

type AgentCommandError = Error & { readonly code?: string | number; readonly killed?: boolean };

export type RunAgentCommand = (
  command: string,
  args: readonly string[],
  options: { cwd: string; timeoutMs: number },
) => Promise<string>;

/**
 * Runs one Hand off at a time: resumes a copy of the repository's latest coding-agent session with
 * no tools, asks it for a Handoff, and captures the result as a draft for the person to approve.
 */
export class HandOffRunner {
  readonly #workflow: LocalPassportWorkflow;
  readonly #findSessions: () => Promise<AgentSession[]>;
  readonly #runCommand: RunAgentCommand;
  readonly #now: () => Date;
  #current: HandOffRun = { status: "idle" };

  constructor(options: {
    workflow: LocalPassportWorkflow;
    findSessions?: () => Promise<AgentSession[]>;
    runCommand?: RunAgentCommand;
    now?: () => Date;
  }) {
    this.#workflow = options.workflow;
    this.#findSessions = options.findSessions ?? (async () => await findAgentSessions());
    this.#runCommand = options.runCommand ?? runAgentCommand;
    this.#now = options.now ?? (() => new Date());
  }

  get current(): HandOffRun {
    return this.#current;
  }

  /** Repositories with a resumable session, each marked with its Project once captured. */
  async sessions() {
    return (await this.#findSessions()).map((session) => ({
      ...session,
      agentName: AGENT_NAMES[session.agent],
      projectId: this.#workflow.store.findByRepository(session.repositoryPath)?.bundle.project.id,
    }));
  }

  /**
   * Starts a Hand off for a repository the session scan found. Only discovered repositories are
   * accepted, so a dashboard request cannot point an agent at an arbitrary directory.
   */
  async start(repositoryPath: string): Promise<{ run: HandOffRun; done: Promise<void> }> {
    if (this.#current.status === "running") {
      throw new Error("A Hand off is already running.");
    }

    const session = (await this.#findSessions()).find(
      (candidate) => candidate.repositoryPath === repositoryPath,
    );

    if (session === undefined) {
      throw new Error(
        "No Claude Code or Codex session was found for this repository. Work in it with a coding agent first.",
      );
    }

    const running: HandOffRun = {
      status: "running",
      agent: session.agent,
      agentName: AGENT_NAMES[session.agent],
      repositoryPath: session.repositoryPath,
      startedAt: this.#now().toISOString(),
    };

    this.#current = running;

    const done = this.#complete(session).then(
      (projectId) => {
        this.#current = {
          ...running,
          status: "succeeded",
          projectId,
          finishedAt: this.#now().toISOString(),
        };
      },
      (error: Error) => {
        this.#current = {
          ...running,
          status: "failed",
          error: error.message,
          finishedAt: this.#now().toISOString(),
        };
      },
    );

    return { run: running, done };
  }

  async #complete(session: AgentSession): Promise<string> {
    const input = await writeHandoff(session, this.#runCommand);
    const draft = await this.#workflow.captureFromAgent(input, session.repositoryPath);

    return draft.project.id;
  }
}

async function writeHandoff(
  session: AgentSession,
  runCommand: RunAgentCommand,
): Promise<HandoffDraftInput> {
  // Claude Code's validator does not resolve the draft 2020-12 meta-schema reference.
  const { $schema: _metaSchema, ...schema } = z.toJSONSchema(HandoffDraftInputSchema, {
    io: "input",
  });

  const prompt = handoffPrompt(session.agent, JSON.stringify(schema));
  const options = { cwd: session.repositoryPath, timeoutMs: AGENT_TIMEOUT_MS };
  const name = AGENT_NAMES[session.agent];
  let reply: string;

  try {
    reply =
      session.agent === "claude-code"
        ? claudeReply(
            await runCommand(
              "claude",
              [
                "--print",
                "--resume",
                session.sessionId,
                "--fork-session",
                "--no-session-persistence",
                "--tools",
                "",
                "--output-format",
                "json",
                "--json-schema",
                JSON.stringify(schema),
                prompt,
              ],
              options,
            ),
          )
        : await codexReply(session.sessionId, prompt, runCommand, options);
  } catch (error) {
    throw new Error(agentFailure(name, error instanceof Error ? error : undefined), {
      cause: error,
    });
  }

  const parsed = HandoffDraftInputSchema.safeParse(jsonObject(reply));

  if (!parsed.success) {
    throw new Error(`${name} did not return a complete Handoff. Try again.`);
  }

  return parsed.data;
}

const ClaudeResultSchema = z.object({
  is_error: z.boolean().optional(),
  result: z.string().optional(),
  structured_output: z.record(z.string(), z.json()).optional(),
});

function claudeReply(stdout: string): string {
  const result = ClaudeResultSchema.parse(JSON.parse(stdout));

  if (result.is_error === true) {
    throw new Error(result.result ?? "Claude Code reported an error.");
  }

  return result.structured_output === undefined
    ? (result.result ?? "")
    : JSON.stringify(result.structured_output);
}

async function codexReply(
  sessionId: string,
  prompt: string,
  runCommand: RunAgentCommand,
  options: { cwd: string; timeoutMs: number },
): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "wist-hand-off-"));
  const output = join(directory, "reply.txt");

  try {
    // Ephemeral keeps the resumed copy out of the person's session history; read-only with no
    // approvals means Codex can only answer, never change the repository.
    await runCommand(
      "codex",
      [
        "exec",
        "resume",
        sessionId,
        "--ephemeral",
        "-c",
        'sandbox_mode="read-only"',
        "-c",
        'approval_policy="never"',
        "--output-last-message",
        output,
        prompt,
      ],
      options,
    );

    return await readFile(output, "utf8");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/** Accepts a bare JSON object or one wrapped in a Markdown code fence. */
function jsonObject(reply: string) {
  const start = reply.indexOf("{");
  const end = reply.lastIndexOf("}");

  if (start === -1 || end < start) return undefined;

  try {
    return JSON.parse(reply.slice(start, end + 1));
  } catch {
    return undefined;
  }
}

function agentFailure(name: string, error: AgentCommandError | undefined): string {
  if (error?.code === "ENOENT") return `${name} is not installed or not on your PATH.`;

  if (error?.killed === true) {
    return `${name} took longer than five minutes. Try again.`;
  }

  return `${name} could not write the Handoff. Check that it is signed in, then try again.`;
}

export const runAgentCommand: RunAgentCommand = async (command, args, options) => {
  // Launched from inside a coding agent, these variables would make the child act as a sub-agent.
  const env = { ...process.env };
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;

  return await new Promise((resolve, reject) => {
    const child = execFile(
      command,
      [...args],
      { cwd: options.cwd, env, timeout: options.timeoutMs, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error === null) {
          resolve(stdout);

          return;
        }

        // The dashboard shows a short message; the agent's own output stays in the daemon log.
        process.stderr.write(`Hand off: ${command} failed.\n${stderr.slice(-2000)}\n`);
        reject(error);
      },
    );

    // The prompt is an argument; closing stdin stops the agent waiting for piped input.
    child.stdin?.end();
  });
};

function handoffPrompt(agent: SourceAgentKind, schema: string): string {
  return `The user clicked "Hand off" in Wist. Write a Handoff of this session's work so a
capable assistant who has never seen this conversation can continue it. Use only what you already
know from this session; you have no tools.

Return only one JSON object matching this JSON Schema, with no prose and no code fence:
${schema}

- source: "${agent}"
- project.goal: the repository's lasting purpose, not today's task.
- handoff.goal: what the next agent should accomplish.
- progress: completed, verified facts, and how you know.
- decisions: choices already made, each with its rationale.
- blockers: what stops progress now and what would unblock it.
- nextActions: concrete steps in order; the first is doable immediately.
- context: pointers such as repository paths or URLs, never file contents.
- capabilities: the tools the next agent needs, from the allowed keys.

Never include secrets, tokens, keys, passwords, environment values, cookies, or private customer
data, even redacted. Set sensitivity to "sensitive" if the work itself is confidential.`;
}
