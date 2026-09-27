import {
  ConnectionSchema,
  HandoffSchema,
  ProjectSchema,
  RuntimeSchema,
  SetupPlanSchema,
} from "@wist/domain";

import {
  codexCliCapability,
  githubCliCapability,
  passportConnectorCapability,
} from "./capabilities.js";

const capturedAt = "2026-09-20T19:00:00.000Z";

export const projectFixture = ProjectSchema.parse({
  schemaVersion: "1",
  id: "44444444-4444-4444-8444-444444444444",
  name: "Wist",
  goal: "Continue a coding Project across assistants without moving raw credentials.",
  repository: {
    provider: "github",
    owner: "example",
    name: "wist",
    url: "https://github.com/example/wist",
    defaultBranch: "main",
    activeBranch: "codex/mvp",
    revision: "6f06e5d89883c46c1ea09b2f3391cfbab46da8eb",
  },
  capabilityIds: [githubCliCapability.id, codexCliCapability.id, passportConnectorCapability.id],
  sensitivity: "internal",
  provenance: {
    source: "codex",
    capturedAt,
    reference: "git:codex/mvp",
  },
  updatedAt: capturedAt,
});

export const handoffFixture = HandoffSchema.parse({
  schemaVersion: "1",
  id: "55555555-5555-4555-8555-555555555555",
  projectId: projectFixture.id,
  status: "published",
  goal: "Prove the capture, preview, publish, and retrieval path.",
  progress: [
    "Product scope and security invariants are documented.",
    "Versioned domain contracts and representative fixtures are available.",
  ],
  decisions: [
    {
      decision: "Connections are established independently in each Runtime.",
      rationale: "A Handoff must never transport raw credentials or authenticated CLI state.",
    },
    {
      decision: "Use authenticated HTTPS for the first personal Muse retrieval POC.",
      rationale: "Personal Muse MCP support is not documented publicly.",
    },
  ],
  blockers: ["Package installation and GitHub/Codex credential storage require a live Muse POC."],
  nextActions: [
    "Retrieve this Handoff through a scoped Muse custom connector.",
    "Probe GitHub and Codex installation, authorization, storage, and persistence.",
  ],
  context: [
    {
      title: "MVP scope",
      handle: "repo://docs/mvp.md",
      sensitivity: "internal",
    },
    {
      title: "Security requirements",
      handle: "repo://docs/security.md",
      sensitivity: "sensitive",
    },
  ],
  sensitivity: "internal",
  provenance: {
    source: "codex",
    capturedAt,
    reference: "git:codex/mvp",
  },
  createdAt: capturedAt,
  approvedAt: "2026-09-20T19:05:00.000Z",
  expiresAt: "2026-09-27T19:05:00.000Z",
});

export const museRuntimeFixture = RuntimeSchema.parse({
  schemaVersion: "1",
  id: "66666666-6666-4666-8666-666666666666",
  name: "Muse Secure VM POC",
  kind: "muse-secure-vm",
  platform: "linux",
  observations: {
    browser: {
      status: "available",
      observedAt: capturedAt,
      evidence: "Meta documents a brokered Chromium-based browser in Muse Secure VM.",
    },
    connectorRetrieval: {
      status: "unverified",
      observedAt: capturedAt,
      evidence: "Custom API/CLI connectors are documented, but no public wire contract exists.",
    },
    packageInstallation: {
      status: "unverified",
      observedAt: capturedAt,
      evidence: "A Debian runtime is documented; arbitrary package installation is not.",
    },
    persistentFilesystem: {
      status: "available",
      observedAt: capturedAt,
      evidence: "Meta documents persistent, continuously backed-up Muse VM files.",
    },
    terminal: {
      status: "available",
      observedAt: capturedAt,
      evidence: "Meta documents a terminal, code execution, compilation, and CLI use.",
    },
  },
  capabilityReadiness: [
    {
      capabilityId: githubCliCapability.id,
      status: "declared",
      evidence: {
        source: "declaration",
        observedAt: capturedAt,
        detail: "Installation and secure authorization have not been tested in Muse.",
        credentialStorage: "unverified",
      },
    },
    {
      capabilityId: codexCliCapability.id,
      status: "declared",
      evidence: {
        source: "declaration",
        observedAt: capturedAt,
        detail:
          "Installation, keyring storage, and login persistence have not been tested in Muse.",
        credentialStorage: "unverified",
      },
    },
    {
      capabilityId: passportConnectorCapability.id,
      status: "declared",
      evidence: {
        source: "declaration",
        observedAt: capturedAt,
        detail: "The personal Muse custom-connector retrieval path still requires a live POC.",
        credentialStorage: "unverified",
      },
    },
  ],
  reportedAt: capturedAt,
});

export const connectionFixtures = [
  ConnectionSchema.parse({
    schemaVersion: "1",
    id: "77777777-7777-4777-8777-777777777771",
    runtimeId: museRuntimeFixture.id,
    capabilityId: githubCliCapability.id,
    provider: "github",
    status: "pending",
    authorizationMethod: "device-code",
    scopes: ["repo"],
    createdAt: capturedAt,
  }),
  ConnectionSchema.parse({
    schemaVersion: "1",
    id: "77777777-7777-4777-8777-777777777772",
    runtimeId: museRuntimeFixture.id,
    capabilityId: codexCliCapability.id,
    provider: "openai",
    status: "pending",
    authorizationMethod: "device-code",
    scopes: [],
    createdAt: capturedAt,
  }),
  ConnectionSchema.parse({
    schemaVersion: "1",
    id: "77777777-7777-4777-8777-777777777773",
    runtimeId: museRuntimeFixture.id,
    capabilityId: passportConnectorCapability.id,
    provider: "wist",
    status: "pending",
    authorizationMethod: "oauth",
    scopes: ["project:read", "handoff:read", "setup-plan:read"],
    createdAt: capturedAt,
  }),
] as const;

export const setupPlanFixture = SetupPlanSchema.parse({
  schemaVersion: "1",
  id: "88888888-8888-4888-8888-888888888888",
  projectId: projectFixture.id,
  handoffId: handoffFixture.id,
  runtimeId: museRuntimeFixture.id,
  status: "blocked",
  steps: [
    {
      id: "99999999-9999-4999-8999-999999999991",
      kind: "install",
      capabilityId: githubCliCapability.id,
      instruction: "Install GitHub CLI through its declared official package only after approval.",
      status: "blocked",
      artifact: { kind: "apt", package: "gh" },
    },
    {
      id: "99999999-9999-4999-8999-999999999992",
      kind: "authorize",
      capabilityId: githubCliCapability.id,
      instruction: "Authorize the required repository scope with the user controlling the flow.",
      status: "blocked",
      provider: "github",
      method: "device-code",
      scopes: ["repo"],
    },
    {
      id: "99999999-9999-4999-8999-999999999993",
      kind: "install",
      capabilityId: codexCliCapability.id,
      instruction: "Install the pinned Codex CLI package only after package support is verified.",
      status: "blocked",
      artifact: { kind: "npm", package: "@openai/codex", version: "0.155.1" },
    },
    {
      id: "99999999-9999-4999-8999-999999999994",
      kind: "authorize",
      capabilityId: codexCliCapability.id,
      instruction: "Authorize Codex with keyring-only storage and user control.",
      status: "blocked",
      provider: "openai",
      method: "device-code",
      scopes: [],
    },
    {
      id: "99999999-9999-4999-8999-999999999995",
      kind: "verify",
      capabilityId: passportConnectorCapability.id,
      instruction: "Retrieve the scoped Project list through authenticated HTTPS.",
      status: "pending",
      verification: {
        kind: "https",
        endpoint: "https://connector.wist.test/v1/projects",
      },
    },
  ],
  generatedAt: capturedAt,
});
