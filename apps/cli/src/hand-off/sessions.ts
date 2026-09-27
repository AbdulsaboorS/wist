import { execFile } from "node:child_process";
import { open, readdir, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { z } from "zod";

const execFileAsync = promisify(execFile);

export type SourceAgentKind = "claude-code" | "codex";

/** A coding-agent conversation on this computer that Wist can resume to write a Handoff. */
export type AgentSession = {
  readonly agent: SourceAgentKind;
  readonly sessionId: string;
  readonly repositoryPath: string;
  readonly updatedAt: string;
};

// Session logs are only read for their opening metadata; the conversation itself stays with the agent.
const HEADER_BYTES = 256 * 1024;

const SESSIONS_PER_CLAUDE_PROJECT = 3;

const CODEX_DAYS = 30;

const ClaudeRecordSchema = z.object({ cwd: z.string().min(1) });

const CodexMetaSchema = z.object({
  type: z.literal("session_meta"),
  payload: z.object({ id: z.string().min(1), cwd: z.string().min(1) }),
});

/**
 * Finds recent Claude Code and Codex sessions whose working directory is inside a git repository,
 * newest first, keeping the latest session per repository root.
 */
export async function findAgentSessions(home = homedir()): Promise<AgentSession[]> {
  const candidates = [...(await claudeSessions(home)), ...(await codexSessions(home))].toSorted(
    (left, right) => right.updatedAt.localeCompare(left.updatedAt),
  );

  const byRoot = new Map<string, AgentSession>();
  const roots = new Map<string, Promise<string | undefined>>();

  for (const candidate of candidates) {
    const known = roots.get(candidate.repositoryPath);
    const pending = known ?? repositoryRoot(candidate.repositoryPath);
    roots.set(candidate.repositoryPath, pending);
    const root = await pending;

    if (root !== undefined && !byRoot.has(root)) {
      byRoot.set(root, { ...candidate, repositoryPath: root });
    }
  }

  return [...byRoot.values()];
}

async function claudeSessions(home: string): Promise<AgentSession[]> {
  const projectsDirectory = join(home, ".claude", "projects");
  const sessions: AgentSession[] = [];

  for (const project of await entries(projectsDirectory)) {
    const directory = join(projectsDirectory, project);
    const logs = await newestFiles(directory, (name) => name.endsWith(".jsonl"));

    for (const log of logs.slice(0, SESSIONS_PER_CLAUDE_PROJECT)) {
      const record = await firstMatch(log.path, ClaudeRecordSchema);

      if (record !== undefined) {
        sessions.push({
          agent: "claude-code",
          sessionId: log.name.replace(/\.jsonl$/, ""),
          repositoryPath: record.cwd,
          updatedAt: log.modifiedAt,
        });

        break;
      }
    }
  }

  return sessions;
}

async function codexSessions(home: string): Promise<AgentSession[]> {
  const root = join(home, ".codex", "sessions");
  const sessions: AgentSession[] = [];
  const days: string[] = [];

  for (const year of (await entries(root)).toSorted().toReversed()) {
    for (const month of (await entries(join(root, year))).toSorted().toReversed()) {
      for (const day of (await entries(join(root, year, month))).toSorted().toReversed()) {
        if (days.length < CODEX_DAYS) days.push(join(root, year, month, day));
      }
    }
  }

  for (const day of days) {
    for (const log of await newestFiles(day, (name) => name.endsWith(".jsonl"))) {
      const meta = await firstMatch(log.path, CodexMetaSchema);

      if (meta !== undefined) {
        sessions.push({
          agent: "codex",
          sessionId: meta.payload.id,
          repositoryPath: meta.payload.cwd,
          updatedAt: log.modifiedAt,
        });
      }
    }
  }

  return sessions;
}

async function repositoryRoot(path: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", path, "rev-parse", "--show-toplevel"]);

    return await realpath(stdout.trim());
  } catch {
    return undefined;
  }
}

async function entries(directory: string): Promise<string[]> {
  try {
    return await readdir(directory);
  } catch {
    return [];
  }
}

async function newestFiles(
  directory: string,
  include: (name: string) => boolean,
): Promise<{ name: string; path: string; modifiedAt: string }[]> {
  const files = await Promise.all(
    (await entries(directory)).filter(include).map(async (name) => {
      const path = join(directory, name);
      const info = await stat(path);

      return { name, path, modifiedAt: info.mtime.toISOString(), file: info.isFile() };
    }),
  );

  return files
    .filter((file) => file.file)
    .toSorted((left, right) => right.modifiedAt.localeCompare(left.modifiedAt));
}

/** Returns the first JSON line near the start of a session log that matches `schema`. */
async function firstMatch<T>(path: string, schema: z.ZodType<T>): Promise<T | undefined> {
  const handle = await open(path, "r");

  try {
    const buffer = Buffer.alloc(HEADER_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, HEADER_BYTES, 0);

    for (const line of buffer.subarray(0, bytesRead).toString("utf8").split("\n")) {
      const parsed = schema.safeParse(parseJson(line));

      if (parsed.success) return parsed.data;
    }

    return undefined;
  } finally {
    await handle.close();
  }
}

function parseJson(line: string) {
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
}
