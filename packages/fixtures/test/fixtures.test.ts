import {
  CapabilitySchema,
  ConnectionSchema,
  HandoffSchema,
  inspectSetupPlan,
  ProjectSchema,
  RuntimeSchema,
  SetupPlanSchema,
} from "@wist/domain";
import { describe, expect, it } from "vitest";

import {
  connectionFixtures,
  goldenPathCapabilities,
  githubCliCapability,
  handoffFixture,
  museRuntimeFixture,
  projectFixture,
  setupPlanFixture,
} from "../src/index.js";

describe("golden-path fixtures", () => {
  it("validates every fixture against the shared domain schemas", () => {
    expect(
      goldenPathCapabilities.every((capability) => CapabilitySchema.safeParse(capability).success),
    ).toBe(true);
    expect(
      connectionFixtures.every((connection) => ConnectionSchema.safeParse(connection).success),
    ).toBe(true);
    expect(HandoffSchema.safeParse(handoffFixture).success).toBe(true);
    expect(ProjectSchema.safeParse(projectFixture).success).toBe(true);
    expect(RuntimeSchema.safeParse(museRuntimeFixture).success).toBe(true);
    expect(SetupPlanSchema.safeParse(setupPlanFixture).success).toBe(true);
  });

  it("uses only installation and authorization declarations from its capabilities", () => {
    expect(inspectSetupPlan(setupPlanFixture, goldenPathCapabilities)).toEqual([]);
  });

  it("detects a setup step that substitutes a different package", () => {
    const substitutedPlan = SetupPlanSchema.parse({
      ...setupPlanFixture,
      steps: setupPlanFixture.steps.map((step) => {
        if (step.kind !== "install" || step.capabilityId !== githubCliCapability.id) {
          return step;
        }

        return { ...step, artifact: { kind: "apt", package: "not-gh" } };
      }),
    });

    expect(inspectSetupPlan(substitutedPlan, goldenPathCapabilities)).toEqual([
      {
        capabilityId: githubCliCapability.id,
        message: "Install step does not match a declared installation option.",
        stepId: "99999999-9999-4999-8999-999999999991",
      },
    ]);
  });

  it("contains no credential-shaped fields", () => {
    const serialized = JSON.stringify({
      capabilities: goldenPathCapabilities,
      connections: connectionFixtures,
      handoff: handoffFixture,
      project: projectFixture,
      runtime: museRuntimeFixture,
      setupPlan: setupPlanFixture,
    });

    expect(serialized).not.toMatch(/api[_-]?key|access[_-]?token|password|refresh[_-]?token/i);
  });
});
