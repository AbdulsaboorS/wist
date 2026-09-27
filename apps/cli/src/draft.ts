import { PassportBundleSchema, type PassportBundle } from "@wist/api";
import { lintSource } from "@secretlint/core";
import { creator as recommendedSecretRules } from "@secretlint/secretlint-rule-preset-recommend";

export type RepositoryState = {
  readonly activeBranch: string;
  readonly revision: string;
  readonly capturedAt: string;
};

// Fast baseline for credential shapes secretlint's recommended preset does not cover
// (generic assignments, OpenAI keys, PEM private keys, JWTs).
const secretPatterns = [
  /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/i,
  /\bgh[oprsu]_[A-Za-z0-9_]{20,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/,
  /\bsk-[A-Za-z0-9_-]{20,}\b/,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/,
  /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
  /\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|passwd)\s*[:=]\s*["']?[^\s,"']+/i,
] as const;

const REJECTED = "Capture rejected content that resembles a raw credential.";

export function assertNoSecretLikeContent(value: PassportBundle): void {
  const text = bundleText(value);

  if (secretPatterns.some((pattern) => pattern.test(text))) {
    throw new Error(REJECTED);
  }
}

/** Runs the baseline and secretlint's maintained ruleset before a bundle is stored or sent. */
export async function screenForSecrets(value: PassportBundle): Promise<void> {
  assertNoSecretLikeContent(value);

  const result = await lintSource({
    source: {
      content: bundleText(value),
      filePath: "passport.txt",
      ext: ".txt",
      contentType: "text",
    },
    options: {
      config: {
        rules: [
          { id: "@secretlint/secretlint-rule-preset-recommend", rule: recommendedSecretRules },
        ],
      },
      maskSecrets: true,
      noPhysicFilePath: true,
    },
  });

  if (result.messages.length > 0) {
    const rules = [...new Set(result.messages.map((message) => message.ruleId))].join(", ");

    throw new Error(`${REJECTED} Matched: ${rules}.`);
  }
}

// JSON escapes newlines, which multi-line secrets such as PEM keys depend on; restore them.
function bundleText(value: PassportBundle): string {
  return JSON.stringify(value).replaceAll("\\n", "\n");
}

export function captureDraft(input: PassportBundle, repository: RepositoryState): PassportBundle {
  const parsed = PassportBundleSchema.parse(input);
  assertNoSecretLikeContent(parsed);

  const expiresAt = new Date(
    Date.parse(repository.capturedAt) + 7 * 24 * 60 * 60 * 1000,
  ).toISOString();

  // Every capture is a new Handoff version, so the relay can tell it apart from the one it serves.
  const handoffId = crypto.randomUUID();

  const handoff = {
    ...parsed.handoff,
    id: handoffId,
    status: "draft" as const,
    provenance: {
      ...parsed.handoff.provenance,
      capturedAt: repository.capturedAt,
      reference: `git:${repository.activeBranch}@${repository.revision}`,
    },
    createdAt: repository.capturedAt,
    expiresAt,
  };

  delete handoff.approvedAt;
  delete handoff.revokedAt;

  return PassportBundleSchema.parse({
    ...parsed,
    project: {
      ...parsed.project,
      repository: {
        ...parsed.project.repository,
        activeBranch: repository.activeBranch,
        revision: repository.revision,
      },
      provenance: {
        ...parsed.project.provenance,
        capturedAt: repository.capturedAt,
        reference: `git:${repository.activeBranch}@${repository.revision}`,
      },
      updatedAt: repository.capturedAt,
    },
    handoff,
    setupPlan: { ...parsed.setupPlan, handoffId },
  });
}

export function validateDraft(input: PassportBundle): PassportBundle {
  const bundle = PassportBundleSchema.parse(input);
  assertNoSecretLikeContent(bundle);

  return bundle;
}

export function previewDraft(input: PassportBundle): string {
  return `${JSON.stringify(validateDraft(input), null, 2)}\n`;
}

export function approveDraft(input: PassportBundle, approvedAt: string): PassportBundle {
  const bundle = validateDraft(input);

  if (bundle.handoff.status !== "draft") {
    throw new Error("Only a draft Handoff can be approved.");
  }

  if (Date.parse(approvedAt) >= Date.parse(bundle.handoff.expiresAt)) {
    throw new Error("Approval must occur before the Handoff expires.");
  }

  return PassportBundleSchema.parse({
    ...bundle,
    handoff: {
      ...bundle.handoff,
      status: "published",
      approvedAt,
    },
  });
}
