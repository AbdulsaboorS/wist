import { CapabilitySchema } from "@wist/domain";

export const githubCliCapability = CapabilitySchema.parse({
  schemaVersion: "1",
  id: "11111111-1111-4111-8111-111111111111",
  kind: "cli",
  name: "GitHub CLI",
  description: "Clones and works with the Project's authorized GitHub repository.",
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
});

export const codexCliCapability = CapabilitySchema.parse({
  schemaVersion: "1",
  id: "22222222-2222-4222-8222-222222222222",
  kind: "coding-agent-cli",
  name: "Codex CLI",
  description: "Continues the Project in the destination Runtime after user authorization.",
  requirement: "required",
  installationOptions: [{ kind: "npm", package: "@openai/codex", version: "0.155.1" }],
  authorization: {
    required: true,
    provider: "openai",
    methods: ["browser", "device-code"],
    scopes: [],
  },
  verification: { kind: "command", command: ["codex", "login", "status"] },
});

export const passportConnectorCapability = CapabilitySchema.parse({
  schemaVersion: "1",
  id: "33333333-3333-4333-8333-333333333333",
  kind: "connected-service",
  name: "Wist connector",
  description: "Retrieves only the Projects and Handoffs shared with this Runtime.",
  requirement: "required",
  installationOptions: [{ kind: "remote", endpoint: "https://connector.wist.test/v1" }],
  authorization: {
    required: true,
    provider: "wist",
    methods: ["oauth"],
    scopes: ["project:read", "handoff:read", "setup-plan:read"],
  },
  verification: {
    kind: "https",
    endpoint: "https://connector.wist.test/v1/projects",
  },
});

export const goldenPathCapabilities = [
  githubCliCapability,
  codexCliCapability,
  passportConnectorCapability,
] as const;
