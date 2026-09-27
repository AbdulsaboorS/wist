import {
  connectionFixtures,
  goldenPathCapabilities,
  handoffFixture,
  museRuntimeFixture,
  projectFixture,
  setupPlanFixture,
} from "@wist/fixtures";

import type { LoadState, PassportSnapshot, Share } from "./snapshot";

/*
 * Fixture-backed source. The fixtures are frozen at 2026-09-20T19:00Z, so the clock is frozen
 * with them: five hours into a 24-hour share, matching the landing page figure.
 *
 * `scenario` exists so each designed state can be opened in a browser during review. It is read
 * from the URL only in development and never rendered as controls.
 */

export type Scenario =
  | "ready"
  | "draft"
  | "expiring"
  | "revoked"
  | "stale"
  | "empty"
  | "loading"
  | "error"
  | "unauthorized";

const SCENARIOS: readonly Scenario[] = [
  "ready",
  "draft",
  "expiring",
  "revoked",
  "stale",
  "empty",
  "loading",
  "error",
  "unauthorized",
];

export function scenarioFromSearch(search: string): Scenario {
  const value = new URLSearchParams(search).get("scenario");
  const match = SCENARIOS.find((scenario) => scenario === value);

  return match ?? "ready";
}

const HANDOFF_APPROVED_AT = handoffFixture.approvedAt ?? handoffFixture.createdAt;

const SHARE_HOURS = 24;

const passportConnection = connectionFixtures[2];

function shareAt(issuedAt: string): Share {
  const expiresAt = new Date(Date.parse(issuedAt) + SHARE_HOURS * 3_600_000).toISOString();

  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
    handoffId: handoffFixture.id,
    connectionId: passportConnection.id,
    destination: "Muse",
    scopes: passportConnection.scopes,
    status: "active",
    issuedAt,
    expiresAt,
    tokenSuffix: "4E1B",
  };
}

const baseSnapshot: PassportSnapshot = {
  identity: {
    holder: "AbdulsaboorS",
    keyAlgorithm: "ed25519",
    keyFingerprint: "7F3A9C21B04ED8F122A76C904E1B0D5C",
    sample: true,
  },
  bundle: {
    project: projectFixture,
    handoff: handoffFixture,
    capabilities: [...goldenPathCapabilities],
    runtime: museRuntimeFixture,
    setupPlan: setupPlanFixture,
  },
  share: shareAt(HANDOFF_APPROVED_AT),
  repository: {
    revision: projectFixture.repository.revision ?? "",
    branch: projectFixture.repository.activeBranch,
    observedAt: "2026-09-21T00:05:00.000Z",
  },
  observedAt: "2026-09-21T00:05:00.000Z",
};

function snapshotFor(scenario: Scenario): PassportSnapshot {
  if (scenario === "draft") {
    // Preview-before-publish: Handoff exists, no share yet.
    return {
      identity: baseSnapshot.identity,
      bundle: baseSnapshot.bundle,
      repository: baseSnapshot.repository,
      observedAt: baseSnapshot.observedAt,
    };
  }

  const share = baseSnapshot.share;

  if (share === undefined) {
    return baseSnapshot;
  }

  if (scenario === "expiring") {
    // 22h30 elapsed of 24: ticks turn to the expiring colour under three hours.
    return {
      ...baseSnapshot,
      observedAt: new Date(Date.parse(share.issuedAt) + 22.5 * 3_600_000).toISOString(),
      share: { ...share, lastAccessAt: "2026-09-20T19:44:00.000Z" },
    };
  }

  if (scenario === "revoked") {
    const revokedAt = "2026-09-21T00:02:00.000Z";

    return {
      ...baseSnapshot,
      share: { ...share, status: "revoked", revokedAt, lastAccessAt: "2026-09-20T19:44:00.000Z" },
    };
  }

  if (scenario === "stale") {
    return {
      ...baseSnapshot,
      repository: {
        revision: "d719be9f4c0a1e6b2d3c4f5a6b7c8d9e0f1a2b3c",
        branch: "fable/ui",
        observedAt: baseSnapshot.observedAt,
      },
    };
  }

  return baseSnapshot;
}

export function loadFixtureState(scenario: Scenario): Promise<LoadState> {
  if (scenario === "loading") {
    return new Promise<LoadState>(() => undefined);
  }

  if (scenario === "unauthorized") {
    return Promise.resolve({ status: "unauthorized" });
  }

  if (scenario === "empty") {
    return Promise.resolve({ status: "empty" });
  }

  if (scenario === "error") {
    return Promise.resolve({
      status: "error",
      message: "The local daemon at 127.0.0.1 did not answer.",
    });
  }

  return Promise.resolve({ status: "ready", snapshot: snapshotFor(scenario) });
}
