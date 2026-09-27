import { HandoffSchema, SetupPlanSchema } from "@wist/domain";
import { projectFixture, setupPlanFixture } from "@wist/fixtures";
import type { CaptureAssessor } from "@wist/intelligence";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  MAX_COMPACT_RESPONSE_TOKENS,
  MAX_DEFAULT_CONTEXT_TOKENS,
  InMemoryPassportStore,
  PassportService,
  ProjectBriefSchema,
  createPassportApp,
  estimateJsonTokens,
} from "../src/index.js";
import {
  bearer,
  bundle,
  connectionToken,
  createTestIdentity,
  ownerToken,
  publish,
  registerIdentity,
} from "./support.js";

const now = new Date("2026-09-21T00:00:00.000Z");

const PublishResponseSchema = z.object({ project: ProjectBriefSchema });

const ProjectListResponseSchema = z.object({ projects: z.array(ProjectBriefSchema) });

const AssessmentResponseSchema = z.object({
  status: z.literal("complete"),
  assessment: z.object({ model: z.string() }),
});

const OpenApiDocumentSchema = z.object({
  paths: z.record(z.string(), z.object({}).passthrough()),
});

async function testApp(assessor?: CaptureAssessor) {
  const store = new InMemoryPassportStore();

  const service =
    assessor === undefined
      ? new PassportService({ store, now: () => now })
      : new PassportService({ store, now: () => now, assessor });

  const app = createPassportApp({ service, store, now: () => now });
  const identity = await createTestIdentity();
  expect((await registerIdentity(app, identity, now)).status).toBe(201);

  return { app, identity };
}

describe("Passport HTTPS interface", () => {
  it("explains a Connection link to people and assistants without exposing data", async () => {
    const { app } = await testApp();
    const response = await app.request("https://relay.example/connect");
    const guide = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/markdown");
    expect(guide).toContain("https://relay.example/v1/projects/{projectId}/handoff");
    expect(guide).toContain("Never ask for passwords");
  });

  it("publishes, lists, and progressively retrieves an approved Passport", async () => {
    const subject = await testApp();
    const connection = await connectionToken(subject.identity, now);
    const publishResponse = await publish(subject.app, subject.identity, connection, now);

    expect(publishResponse.status).toBe(201);
    expect(PublishResponseSchema.parse(await publishResponse.json()).project.id).toBe(
      projectFixture.id,
    );

    const listResponse = await subject.app.request("/v1/projects", {
      headers: bearer(connection),
    });

    expect(listResponse.status).toBe(200);
    const list = ProjectListResponseSchema.parse(await listResponse.json());
    expect(list.projects).toHaveLength(1);
    expect(estimateJsonTokens(list)).toBeLessThanOrEqual(MAX_COMPACT_RESPONSE_TOKENS);
    const listedProject = list.projects[0];

    if (listedProject === undefined) {
      throw new Error("Expected one authorized Project.");
    }

    const handoffResponse = await subject.app.request(`/v1/projects/${projectFixture.id}/handoff`, {
      headers: bearer(connection),
    });

    expect(handoffResponse.status).toBe(200);
    const handoff = HandoffSchema.parse(await handoffResponse.json());
    expect(estimateJsonTokens({ project: listedProject, handoff })).toBeLessThanOrEqual(
      MAX_DEFAULT_CONTEXT_TOKENS,
    );

    const setupPlanResponse = await subject.app.request(
      `/v1/projects/${projectFixture.id}/setup-plan`,
      { headers: bearer(connection) },
    );

    expect(setupPlanResponse.status).toBe(200);
    expect(SetupPlanSchema.parse(await setupPlanResponse.json()).id).toBe(setupPlanFixture.id);
  });

  it("returns optional Jev review evidence without controlling publication", async () => {
    const assessor: CaptureAssessor = {
      assess: async () => ({
        model: "jev-test",
        judgments: {
          relevant: 0.95,
          sensitivityMismatch: 0.1,
          portable: 0.91,
          conflicting: 0.05,
          stale: 0.08,
        },
        warnings: [],
      }),
    };

    const subject = await testApp(assessor);

    const response = await subject.app.request(`/v1/projects/${projectFixture.id}/assess`, {
      method: "POST",
      headers: bearer(await ownerToken(subject.identity, now)),
      body: JSON.stringify({ project: bundle.project, handoff: bundle.handoff }),
    });

    expect(response.status).toBe(200);
    expect(AssessmentResponseSchema.parse(await response.json()).assessment.model).toBe("jev-test");
  });

  it("reports Jev failure without blocking deterministic publication", async () => {
    const subject = await testApp({
      assess: async () => {
        throw new Error("service unavailable");
      },
    });

    const assessment = await subject.app.request(`/v1/projects/${projectFixture.id}/assess`, {
      method: "POST",
      headers: bearer(await ownerToken(subject.identity, now)),
      body: JSON.stringify({ project: bundle.project, handoff: bundle.handoff }),
    });

    expect(await assessment.json()).toEqual({ status: "unavailable", assessment: null });

    const connection = await connectionToken(subject.identity, now);
    expect((await publish(subject.app, subject.identity, connection, now)).status).toBe(201);
  });

  it("publishes an OpenAPI contract for every relay use case", async () => {
    const subject = await testApp();
    const response = await subject.app.request("/openapi.json");
    const document = OpenApiDocumentSchema.parse(await response.json());

    expect(response.status).toBe(200);
    expect(Object.keys(document.paths)).toEqual(
      expect.arrayContaining([
        "/v1/identities",
        "/v1/projects",
        "/v1/projects/{projectId}/assess",
        "/v1/projects/{projectId}",
        "/v1/projects/{projectId}/handoff",
        "/v1/projects/{projectId}/setup-plan",
        "/v1/projects/{projectId}/readiness",
        "/v1/projects/{projectId}/revoke",
      ]),
    );
  });

  it("bounds request size and free-text length before any storage", async () => {
    const store = new InMemoryPassportStore();
    const service = new PassportService({ store, now: () => now });
    const app = createPassportApp({ service, store, now: () => now });
    const identity = await createTestIdentity();
    await registerIdentity(app, identity, now);

    const oversized = await app.request(`/v1/projects/${projectFixture.id}/publish`, {
      method: "POST",
      headers: bearer(await ownerToken(identity, now)),
      body: JSON.stringify({ padding: "x".repeat(300 * 1024) }),
    });

    expect(oversized.status).toBe(413);

    const longGoal = await app.request(`/v1/projects/${projectFixture.id}/publish`, {
      method: "POST",
      headers: bearer(await ownerToken(identity, now)),
      body: JSON.stringify({
        bundle: { ...bundle, handoff: { ...bundle.handoff, goal: "x".repeat(4_001) } },
        approved: true,
        shareId: crypto.randomUUID(),
        connectionToken: await connectionToken(identity, now),
      }),
    });

    expect(longGoal.status).toBe(400);
    expect(await store.getShare(projectFixture.id)).toBeUndefined();
  });
});
