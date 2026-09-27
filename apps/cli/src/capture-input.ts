import {
  CapabilitySchema,
  ContextReferenceSchema,
  HandoffDecisionSchema,
  NonEmptyTextSchema,
  SensitivitySchema,
  type Capability,
  type SetupStep,
} from "@wist/domain";
import type { PassportBundle } from "@wist/api";
import { z } from "zod";

// Capabilities a Source Agent may request by key. The CLI owns the full declarations so an agent
// can name what the work needs but never author an install command or authorization scope.
export const CAPABILITY_CATALOG = {
  "github-cli": CapabilitySchema.parse({
    schemaVersion: "1",
    id: "0199a1c0-0001-7000-8000-000000000001",
    kind: "cli",
    name: "GitHub CLI",
    description: "Clones and works with the Project's GitHub repository.",
    requirement: "required",
    installationOptions: [
      { kind: "apt", package: "gh" },
      { kind: "homebrew", formula: "gh" },
    ],
    authorization: {
      required: true,
      provider: "github",
      methods: ["browser", "device-code"],
      scopes: ["repo"],
    },
    verification: { kind: "command", command: ["gh", "auth", "status"] },
  }),
  "claude-code": CapabilitySchema.parse({
    schemaVersion: "1",
    id: "0199a1c0-0002-7000-8000-000000000002",
    kind: "coding-agent-cli",
    name: "Claude Code",
    description: "Continues the Project in the destination Runtime after the user signs in.",
    requirement: "optional",
    installationOptions: [
      { kind: "npm", package: "@anthropic-ai/claude-code", version: "2.1.282" },
    ],
    authorization: { required: true, provider: "anthropic", methods: ["browser"], scopes: [] },
    verification: { kind: "command", command: ["claude", "--version"] },
  }),
  "codex-cli": CapabilitySchema.parse({
    schemaVersion: "1",
    id: "0199a1c0-0003-7000-8000-000000000003",
    kind: "coding-agent-cli",
    name: "Codex CLI",
    description: "Continues the Project in the destination Runtime after the user signs in.",
    requirement: "optional",
    installationOptions: [{ kind: "npm", package: "@openai/codex", version: "0.155.1" }],
    authorization: {
      required: true,
      provider: "openai",
      methods: ["browser", "device-code"],
      scopes: [],
    },
    verification: { kind: "command", command: ["codex", "login", "status"] },
  }),
} as const satisfies Record<string, Capability>;

type CapabilityKey = keyof typeof CAPABILITY_CATALOG;

const CapabilityKeySchema = z.enum(
  // SAFETY: Object.keys of a const object literal returns exactly its declared keys.
  Object.keys(CAPABILITY_CATALOG) as [CapabilityKey, ...CapabilityKey[]],
);

/** What a Source Agent writes. Identifiers, repository facts, and timestamps come from the CLI. */
export const HandoffDraftInputSchema = z
  .object({
    source: NonEmptyTextSchema.describe("The coding agent writing this Handoff, e.g. claude-code."),
    project: z
      .object({
        name: NonEmptyTextSchema,
        goal: NonEmptyTextSchema.describe("The Project's lasting purpose, not today's task."),
        sensitivity: SensitivitySchema.default("internal"),
      })
      .strict(),
    handoff: z
      .object({
        goal: NonEmptyTextSchema.describe("What the next agent should accomplish."),
        progress: z.array(NonEmptyTextSchema).max(30).default([]),
        decisions: z.array(HandoffDecisionSchema).max(30).default([]),
        blockers: z.array(NonEmptyTextSchema).max(30).default([]),
        nextActions: z.array(NonEmptyTextSchema).min(1).max(30),
        context: z
          .array(ContextReferenceSchema)
          .max(30)
          .default([])
          .describe("Pointers such as repository paths or docs, never file contents."),
        sensitivity: SensitivitySchema.default("internal"),
      })
      .strict(),
    capabilities: z
      .array(CapabilityKeySchema)
      .max(Object.keys(CAPABILITY_CATALOG).length)
      .default(["github-cli"])
      .describe("Capabilities the destination needs to continue."),
  })
  .strict();

export type HandoffDraftInput = z.input<typeof HandoffDraftInputSchema>;

export type GitHubOrigin = {
  readonly owner: string;
  readonly name: string;
  readonly defaultBranch: string;
};

export function parseGitHubRemote(remote: string): Omit<GitHubOrigin, "defaultBranch"> {
  const match =
    /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(
      remote.trim(),
    );

  if (match?.[1] === undefined || match[2] === undefined) {
    throw new Error("The repository's origin remote must be a GitHub repository.");
  }

  return { owner: match[1], name: match[2] };
}

/**
 * Expands a Source Agent's draft into a complete bundle. `captureDraft` then stamps the Handoff
 * identifier, branch, revision, and capture time from git.
 */
export function bundleFromDraftInput(
  input: HandoffDraftInput,
  origin: GitHubOrigin & { readonly projectId: string },
  now: Date,
): PassportBundle {
  const draft = HandoffDraftInputSchema.parse(input);
  const at = now.toISOString();
  const handoffId = crypto.randomUUID();
  const runtimeId = crypto.randomUUID();
  const capabilities = [...new Set(draft.capabilities)].map((key) => CAPABILITY_CATALOG[key]);
  const provenance = { source: draft.source, capturedAt: at };

  return {
    project: {
      schemaVersion: "1",
      id: origin.projectId,
      name: draft.project.name,
      goal: draft.project.goal,
      repository: {
        provider: "github",
        owner: origin.owner,
        name: origin.name,
        url: `https://github.com/${origin.owner}/${origin.name}`,
        defaultBranch: origin.defaultBranch,
        activeBranch: origin.defaultBranch,
      },
      capabilityIds: capabilities.map((capability) => capability.id),
      sensitivity: draft.project.sensitivity,
      provenance,
      updatedAt: at,
    },
    handoff: {
      schemaVersion: "1",
      id: handoffId,
      projectId: origin.projectId,
      status: "draft",
      goal: draft.handoff.goal,
      progress: draft.handoff.progress,
      decisions: draft.handoff.decisions,
      blockers: draft.handoff.blockers,
      nextActions: draft.handoff.nextActions,
      context: draft.handoff.context,
      sensitivity: draft.handoff.sensitivity,
      provenance,
      createdAt: at,
      expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    },
    capabilities,
    runtime: {
      schemaVersion: "1",
      id: runtimeId,
      name: "Muse",
      kind: "muse-secure-vm",
      platform: "linux",
      observations: {
        browser: unverified(at),
        connectorRetrieval: unverified(at),
        packageInstallation: unverified(at),
        persistentFilesystem: unverified(at),
        terminal: unverified(at),
      },
      capabilityReadiness: capabilities.map((capability) => ({
        capabilityId: capability.id,
        status: "declared" as const,
        evidence: {
          source: "declaration" as const,
          observedAt: at,
          detail: "Declared by the Source Agent; not yet checked in the destination.",
        },
      })),
      reportedAt: at,
    },
    setupPlan: {
      schemaVersion: "1",
      id: crypto.randomUUID(),
      projectId: origin.projectId,
      handoffId,
      runtimeId,
      status: "pending",
      steps: capabilities.flatMap(setupSteps),
      generatedAt: at,
    },
  };
}

function unverified(observedAt: string) {
  return {
    status: "unverified" as const,
    observedAt,
    evidence: "Not yet reported by the destination.",
  };
}

function setupSteps(capability: Capability): SetupStep[] {
  const steps: SetupStep[] = [];
  const artifact = capability.installationOptions?.[0];

  if (artifact !== undefined) {
    steps.push({
      id: crypto.randomUUID(),
      capabilityId: capability.id,
      kind: "install",
      instruction: `Install ${capability.name}.`,
      status: "pending",
      artifact,
    });
  }

  if (capability.authorization.required) {
    steps.push({
      id: crypto.randomUUID(),
      capabilityId: capability.id,
      kind: "authorize",
      instruction: `Ask the user to sign in to ${capability.name} through its official flow.`,
      status: "pending",
      provider: capability.authorization.provider,
      method: capability.authorization.methods[0] ?? "browser",
      scopes: capability.authorization.scopes,
    });
  }

  steps.push({
    id: crypto.randomUUID(),
    capabilityId: capability.id,
    kind: "verify",
    instruction: `Verify ${capability.name} is usable.`,
    status: "pending",
    verification: capability.verification,
  });

  return steps;
}
