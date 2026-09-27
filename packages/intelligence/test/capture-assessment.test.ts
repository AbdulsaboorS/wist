import { handoffFixture, projectFixture } from "@wist/fixtures";
import { describe, expect, it } from "vitest";

import { JevCaptureAssessor, type JevEvaluator } from "../src/index.js";

describe("Jev capture assessment", () => {
  it("turns narrow semantic judgments into review warnings without making policy decisions", async () => {
    const evaluator: JevEvaluator = {
      evaluate: async () => ({
        model: "jev-test",
        judgments: {
          relevant: 0.92,
          sensitivityMismatch: 0.42,
          portable: 0.8,
          conflicting: 0.1,
          stale: 0.7,
        },
      }),
    };

    const assessment = await new JevCaptureAssessor(evaluator).assess({
      project: projectFixture,
      handoff: handoffFixture,
    });

    expect(assessment.model).toBe("jev-test");
    expect(assessment.warnings).toEqual([
      "Jev found a possible sensitivity mismatch; review the preview before publishing.",
      "Jev found signals that some captured context may be stale.",
    ]);
  });
});
