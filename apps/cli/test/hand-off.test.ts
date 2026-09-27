import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  findAgentSessions,
  HandOffRunner,
  InMemoryConnectionSecretStore,
  InMemoryIdentitySecretStore,
  LocalIdentityManager,
  LocalPassportStore,
  LocalPassportWorkflow,
  type AgentSession,
  type HandoffDraftInput,
  type RunAgentCommand,
} from "../src/index.js";

const draft: HandoffDraftInput = {
  source: "claude-code",
  project: { name: "Widgets", goal: "Ship a reliable widget service." },
  handoff: {
    goal: "Finish the retry policy for failed webhooks.",
    nextActions: ["Add the dead-letter queue."],
  },
  capabilities: ["github-cli"],
};

describe("Hand off", () => {
  let root: string;
  let repository: string;
  let store: LocalPassportStore;
  let workflow: LocalPassportWorkflow;

  const git = (...args: string[]) =>
    execFileSync("git", ["-C", repository, ...args], { stdio: "pipe" });

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "wist-hand-off-")));
    repository = join(root, "widgets");
    mkdirSync(repository);
    git("init", "--initial-branch=main");
    git(
      "-c",
      "user.name=T",
      "-c",
      "user.email=t@example.com",
      "commit",
      "--allow-empty",
      "-m",
      "i",
    );
    git("remote", "add", "origin", "git@github.com:acme/widgets.git");
    store = new LocalPassportStore(
      new DatabaseSync(":memory:"),
      new InMemoryConnectionSecretStore(),
    );

    workflow = new LocalPassportWorkflow({
      store,
      identity: new LocalIdentityManager(new InMemoryIdentitySecretStore()),
    });
  });

  afterEach(() => {
    store.close();
    rmSync(root, { recursive: true, force: true });
  });

  function runner(runCommand: RunAgentCommand, agent: AgentSession["agent"] = "claude-code") {
    const session: AgentSession = {
      agent,
      sessionId: "session-1",
      repositoryPath: repository,
      updatedAt: "2026-09-25T12:00:00.000Z",
    };

    return new HandOffRunner({ workflow, findSessions: async () => [session], runCommand });
  }

  it("resumes a tool-less copy of the Claude Code session and captures a draft", async () => {
    const calls: { command: string; args: readonly string[]; cwd: string }[] = [];

    const handOff = runner(async (command, args, options) => {
      calls.push({ command, args, cwd: options.cwd });

      return JSON.stringify({ is_error: false, structured_output: draft });
    });

    const { done } = await handOff.start(repository);
    await done;

    expect(handOff.current).toMatchObject({ status: "succeeded", agent: "claude-code" });
    expect(store.list()[0]?.bundle.handoff).toMatchObject({
      status: "draft",
      goal: draft.handoff.goal,
    });
    expect(calls[0]?.command).toBe("claude");
    expect(calls[0]?.cwd).toBe(repository);
    expect(calls[0]?.args).toEqual(
      expect.arrayContaining([
        "--resume",
        "session-1",
        "--fork-session",
        "--no-session-persistence",
      ]),
    );
    expect(
      calls[0]?.args.slice(calls[0].args.indexOf("--tools"), calls[0].args.indexOf("--tools") + 2),
    ).toEqual(["--tools", ""]);
  });

  it("runs Codex read-only and ephemeral and reads its final message", async () => {
    let args: readonly string[] = [];

    const handOff = runner(async (_command, commandArgs) => {
      args = commandArgs;
      const output = commandArgs[commandArgs.indexOf("--output-last-message") + 1] ?? "";
      writeFileSync(output, `\`\`\`json\n${JSON.stringify({ ...draft, source: "codex" })}\n\`\`\``);

      return "";
    }, "codex");

    const { done } = await handOff.start(repository);
    await done;

    expect(handOff.current).toMatchObject({ status: "succeeded", agent: "codex" });
    expect(args).toEqual(
      expect.arrayContaining(["resume", "session-1", "--ephemeral", 'sandbox_mode="read-only"']),
    );
  });

  it("refuses repositories the session scan did not find, and concurrent runs", async () => {
    let release = () => {};

    const blocked = new Promise<void>((resolve) => (release = resolve));

    const handOff = runner(async () => {
      await blocked;

      return JSON.stringify({ structured_output: draft });
    });

    await expect(handOff.start(root)).rejects.toThrow(/No Claude Code or Codex session/);
    const { done } = await handOff.start(repository);
    await expect(handOff.start(repository)).rejects.toThrow(/already running/);
    release();
    await done;
  });

  it("reports plain failures for missing agents, bad replies, and credentials", async () => {
    const missing = runner(async () => {
      throw Object.assign(new Error("spawn claude ENOENT"), { code: "ENOENT" });
    });

    await (await missing.start(repository)).done;
    expect(missing.current).toMatchObject({
      status: "failed",
      error: "Claude Code is not installed or not on your PATH.",
    });

    const incomplete = runner(async () => JSON.stringify({ result: "I cannot do that." }));
    await (await incomplete.start(repository)).done;
    expect(incomplete.current).toMatchObject({
      error: "Claude Code did not return a complete Handoff. Try again.",
    });

    const leaky = runner(async () =>
      JSON.stringify({
        structured_output: {
          ...draft,
          handoff: { ...draft.handoff, goal: "Use ghp_abcdefghijklmnopqrstuvwxyz0123456789" },
        },
      }),
    );

    await (await leaky.start(repository)).done;
    expect(leaky.current).toMatchObject({
      status: "failed",
      error: expect.stringMatching(/credential/),
    });
    expect(store.list()).toHaveLength(0);
  });

  it("discovers the latest session per repository root from Claude Code and Codex logs", async () => {
    const home = join(root, "home");
    const claude = join(home, ".claude", "projects", "-widgets");
    const codex = join(home, ".codex", "sessions", "2026", "09", "25");
    mkdirSync(claude, { recursive: true });
    mkdirSync(codex, { recursive: true });
    mkdirSync(join(repository, "src"));
    writeFileSync(
      join(claude, "claude-1.jsonl"),
      `{"type":"mode"}\n{"cwd":"${join(repository, "src")}"}\n`,
    );

    writeFileSync(
      join(codex, "rollout-1.jsonl"),
      `${JSON.stringify({ type: "session_meta", payload: { id: "codex-1", cwd: repository } })}\n`,
    );

    writeFileSync(
      join(codex, "rollout-2.jsonl"),
      `${JSON.stringify({ type: "session_meta", payload: { id: "codex-2", cwd: join(root, "not-a-repo") } })}\n`,
    );

    const sessions = await findAgentSessions(home);

    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.repositoryPath).toBe(repository);
    expect(["claude-1", "codex-1"]).toContain(sessions[0]?.sessionId);
  });
});
