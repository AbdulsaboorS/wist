import type { Handoff, Project } from "@wist/domain";

export const CAPTURE_JEV_MODEL = "jev-1.13.0";

export const captureJudgmentNames = [
  "relevant",
  "sensitivityMismatch",
  "portable",
  "conflicting",
  "stale",
] as const;

export type CaptureJudgmentName = (typeof captureJudgmentNames)[number];

export type CaptureJudgments = Readonly<Record<CaptureJudgmentName, number>>;

export type CaptureAssessment = {
  readonly model: string;
  readonly judgments: CaptureJudgments;
  readonly warnings: string[];
};

export type CaptureAssessmentInput = {
  readonly project: Project;
  readonly handoff: Handoff;
};

export interface CaptureAssessor {
  assess(input: CaptureAssessmentInput): Promise<CaptureAssessment>;
}

export type JevEvaluation = {
  readonly model: string;
  readonly judgments: CaptureJudgments;
};

export interface JevEvaluator {
  evaluate(input: CaptureAssessmentInput): Promise<JevEvaluation>;
}

export function warningsForJudgments(judgments: CaptureJudgments): string[] {
  const warnings: string[] = [];

  if (judgments.relevant < 0.6) {
    warnings.push("Jev found weak evidence that this Handoff is relevant to the Project goal.");
  }

  if (judgments.sensitivityMismatch >= 0.35) {
    warnings.push(
      "Jev found a possible sensitivity mismatch; review the preview before publishing.",
    );
  }

  if (judgments.portable < 0.6) {
    warnings.push("Jev found that the Handoff may rely on unmentioned local context.");
  }

  if (judgments.conflicting >= 0.5) {
    warnings.push("Jev found possibly conflicting statements in the captured context.");
  }

  if (judgments.stale >= 0.5) {
    warnings.push("Jev found signals that some captured context may be stale.");
  }

  return warnings;
}

export class JevCaptureAssessor implements CaptureAssessor {
  readonly #evaluator: JevEvaluator;

  constructor(evaluator: JevEvaluator) {
    this.#evaluator = evaluator;
  }

  async assess(input: CaptureAssessmentInput): Promise<CaptureAssessment> {
    const result = await this.#evaluator.evaluate(input);

    return {
      model: result.model,
      judgments: result.judgments,
      warnings: warningsForJudgments(result.judgments),
    };
  }
}
