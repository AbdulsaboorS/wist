import {
  InMemoryPassportStore,
  PassportService,
  createPassportApp,
  type PassportBundle,
} from "@wist/api";
import {
  goldenPathCapabilities,
  handoffFixture,
  museRuntimeFixture,
  projectFixture,
  setupPlanFixture,
} from "@wist/fixtures";
import type { CaptureAssessor } from "@wist/intelligence";
import { describe, expect, it } from "vitest";

import {
  InMemoryIdentitySecretStore,
  LocalIdentityManager,
  PassportApiClient,
  approveDraft,
  captureDraft,
  previewDraft,
} from "../src/index.js";

const capturedAt = "2026-09-21T00:00:00.000Z";

describe("CLI vertical slice", () => {
  it("captures, previews, approves, publishes, and retrieves one Project", async () => {
    const store = new InMemoryPassportStore();

    const assessor: CaptureAssessor = {
      assess: async () => ({
        model: "jev-test",
        judgments: {
          relevant: 0.94,
          sensitivityMismatch: 0.08,
          portable: 0.9,
          conflicting: 0.03,
          stale: 0.06,
        },
        warnings: [],
      }),
    };

    const service = new PassportService({
      store,
      assessor,
      now: () => new Date(capturedAt),
    });

    const app = createPassportApp({ service, store, now: () => new Date(capturedAt) });

    const client = new PassportApiClient("https://passport.test", (input, init) =>
      app.request(new Request(input, init)),
    );

    const identity = new LocalIdentityManager(new InMemoryIdentitySecretStore());
    const now = new Date(capturedAt);
    await client.registerIdentity(await identity.createRegistration(now));
    const ownerToken = await identity.createOwnerToken({ projectId: projectFixture.id, now });

    const candidate: PassportBundle = {
      project: projectFixture,
      handoff: handoffFixture,
      capabilities: [...goldenPathCapabilities],
      runtime: museRuntimeFixture,
      setupPlan: setupPlanFixture,
    };

    const draft = captureDraft(candidate, {
      activeBranch: "codex/mvp",
      revision: "abc123",
      capturedAt,
    });

    expect(draft.handoff.status).toBe("draft");
    expect(draft.handoff.id).not.toBe(handoffFixture.id);
    expect(draft.setupPlan.handoffId).toBe(draft.handoff.id);
    expect(previewDraft(draft)).toContain('"status": "draft"');

    const assessment = await client.assess(draft, ownerToken);
    expect(assessment.status).toBe("complete");
    expect(assessment.assessment?.model).toBe("jev-test");

    const approved = approveDraft(draft, "2026-09-21T00:05:00.000Z");

    const connection = await identity.createConnection({
      shareId: "01993333-3333-7333-8333-333333333333",
      projectId: projectFixture.id,
      scopes: ["project:read", "handoff:read", "setup-plan:read"],
      now,
      shareExpiresAt: approved.handoff.expiresAt,
    });

    const published = await client.publish(approved, {
      ownerToken,
      shareId: connection.shareId,
      connectionToken: connection.token,
    });

    expect(published.project.id).toBe(projectFixture.id);

    const retrieved = await client.getProject(projectFixture.id, connection.token);
    expect(retrieved.currentHandoff.id).toBe(draft.handoff.id);
    expect(retrieved.handles.handoff).toContain(projectFixture.id);
  });

  it("rejects credential-shaped content before preview", () => {
    const candidate = {
      project: projectFixture,
      handoff: {
        ...handoffFixture,
        blockers: ["Temporary api_key=sk-abcdefghijklmnopqrstuvwxyz123456"],
      },
      capabilities: [...goldenPathCapabilities],
      runtime: museRuntimeFixture,
      setupPlan: setupPlanFixture,
    };

    expect(() =>
      captureDraft(candidate, {
        activeBranch: "codex/mvp",
        revision: "abc123",
        capturedAt,
      }),
    ).toThrow("resembles a raw credential");
  });
});
