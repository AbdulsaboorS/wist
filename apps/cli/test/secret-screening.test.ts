import {
  goldenPathCapabilities,
  handoffFixture,
  museRuntimeFixture,
  projectFixture,
  setupPlanFixture,
} from "@wist/fixtures";
import { describe, expect, it } from "vitest";

import { screenForSecrets } from "../src/index.js";

const withBlocker = (blocker: string) => ({
  project: projectFixture,
  handoff: { ...handoffFixture, blockers: [blocker] },
  capabilities: [...goldenPathCapabilities],
  runtime: museRuntimeFixture,
  setupPlan: setupPlanFixture,
});

describe("secret screening", () => {
  it("accepts an ordinary Handoff", async () => {
    await expect(screenForSecrets(withBlocker("Waiting on design review"))).resolves.toBe(
      undefined,
    );
  });

  // Fake credentials are assembled at runtime so this file never contains a scannable literal.
  it.each([
    ["GitHub fine-grained token", `github_pat_${"11ABCDEFG0abcdefghijkl"}_${"a1".repeat(29)}X`],
    ["AWS key pair", `AWS_ACCESS_KEY_ID=${"AKIA"}IOSFODNN7ABCDEFG`],
    ["Slack bot token", `${"xoxb"}-123456789012-1234567890123-${"AbCd".repeat(6)}`],
    [
      "PEM private key",
      `-----BEGIN ${"OPENSSH"} PRIVATE KEY-----\nb3BlbnNzaC1rZXk\n-----END OPENSSH PRIVATE KEY-----`,
    ],
    ["credential in a URL", `https://deploy:${"hunter2secret"}@example.com/repo.git`],
  ])("rejects a %s without echoing it", async (_name, secret) => {
    const rejection = screenForSecrets(withBlocker(`Blocked until ${secret} is rotated`));

    await expect(rejection).rejects.toThrow(/resembles a raw credential/);
    await expect(rejection).rejects.not.toThrow(secret);
  });
});
