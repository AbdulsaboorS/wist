import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { PassportBundleSchema } from "@wist/api";
import { inspectSetupPlan } from "@wist/domain";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  InMemoryConnectionSecretStore,
  InMemoryIdentitySecretStore,
  LocalIdentityManager,
  LocalPassportStore,
  LocalPassportWorkflow,
  type HandoffDraftInput,
} from "../src/index.js";

const draft: HandoffDraftInput = {
  source: "claude-code",
  project: { name: "Widgets", goal: "Ship a reliable widget service." },
  handoff: {
    goal: "Finish the retry policy for failed webhooks.",
    progress: ["Exponential backoff is implemented and unit tested."],
    decisions: [{ decision: "Cap retries at five", rationale: "Upstream rate limits." }],
    nextActions: ["Add the dead-letter queue."],
  },
  capabilities: ["github-cli", "claude-code"],
};

describe("Source Agent capture", () => {
  let repository: string;
  let store: LocalPassportStore;
  let workflow: LocalPassportWorkflow;

  const git = (...args: string[]) =>
    execFileSync("git", ["-C", repository, ...args], { stdio: "pipe" });

  beforeEach(() => {
    repository = mkdtempSync(join(tmpdir(), "wist-capture-"));
    git("init", "--initial-branch=main");
    git(
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "commit",
      "--allow-empty",
      "-m",
      "init",
    );
    git("remote", "add", "origin", "git@github.com:acme/widgets.git");
    store = new LocalPassportStore(
      new DatabaseSync(":memory:"),
      new InMemoryConnectionSecretStore(),
    );

    workflow = new LocalPassportWorkflow({
      store,
      identity: new LocalIdentityManager(new InMemoryIdentitySecretStore()),
      now: () => new Date("2026-09-25T12:00:00.000Z"),
    });
  });

  afterEach(() => {
    store.close();
    rmSync(repository, { recursive: true, force: true });
  });

  it("expands a minimal agent draft into a valid bundle and Setup Plan", async () => {
    const bundle = PassportBundleSchema.parse(await workflow.captureFromAgent(draft, repository));

    expect(bundle.project.repository).toMatchObject({
      owner: "acme",
      name: "widgets",
      url: "https://github.com/acme/widgets",
      activeBranch: "main",
    });
    expect(bundle.handoff.status).toBe("draft");
    expect(bundle.handoff.provenance.source).toBe("claude-code");
    expect(bundle.capabilities.map((capability) => capability.name)).toEqual([
      "GitHub CLI",
      "Claude Code",
    ]);
    expect(bundle.setupPlan.handoffId).toBe(bundle.handoff.id);
    expect(bundle.setupPlan.steps.map((step) => step.kind)).toEqual([
      "install",
      "authorize",
      "verify",
      "install",
      "authorize",
      "verify",
    ]);
    expect(inspectSetupPlan(bundle.setupPlan, bundle.capabilities)).toEqual([]);
  });

  it("keeps one Project per repository and mints a new Handoff each capture", async () => {
    const first = await workflow.captureFromAgent(draft, repository);
    const second = await workflow.captureFromAgent(draft, repository);

    expect(second.project.id).toBe(first.project.id);
    expect(second.handoff.id).not.toBe(first.handoff.id);
  });

  it("rejects non-GitHub origins and agent-authored identifiers", async () => {
    await expect(
      workflow.captureFromAgent(
        // SAFETY: Deliberately malformed input exercising strict runtime validation.
        { ...draft, project: { ...draft.project, id: crypto.randomUUID() } } as HandoffDraftInput,
        repository,
      ),
    ).rejects.toThrow();

    git("remote", "set-url", "origin", "https://gitlab.com/acme/widgets.git");
    await expect(workflow.captureFromAgent(draft, repository)).rejects.toThrow(/GitHub/);
  });
});
