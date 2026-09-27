import type { PassportBundle } from "@wist/api";
import type { Capability, CapabilityReadiness } from "@wist/domain";

/*
 * What the dashboard renders. `PassportBundle` is the portable part and comes straight from the
 * shared contracts. The rest comes from the local daemon: its identity, the share, and the
 * repository's current revision.
 */

export type Identity = {
  readonly holder: string;
  readonly keyAlgorithm: "ed25519";
  /** Hex, uppercase, no separators. Rendered in groups of four. */
  readonly keyFingerprint: string;
  /** True while the holder name is a stand-in rather than a value the daemon supplied. */
  readonly sample: boolean;
};

export type ShareStatus = "active" | "expired" | "revoked";

/*
 * One published share and the Connection token it issued. Mirrors `StoredShare` and
 * `StoredConnectionGrant` in apps/api on `codex/mvp`, minus the token itself: the daemon keeps the
 * bare token and hands it over only when the person asks to reveal it.
 */
export type Share = {
  readonly id: string;
  readonly handoffId: string;
  readonly connectionId: string;
  readonly destination: string;
  readonly scopes: readonly string[];
  readonly status: ShareStatus;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly revokedAt?: string;
  readonly lastAccessAt?: string;
  /** Last four characters of the Connection token; the full token is fetched on demand. */
  readonly tokenSuffix?: string;
};

export type RepositoryObservation = {
  readonly revision: string;
  readonly branch: string;
  readonly observedAt: string;
};

export type PassportSnapshot = {
  readonly identity: Identity;
  readonly bundle: PassportBundle;
  readonly share?: Share;
  readonly repository: RepositoryObservation;
  /** The daemon's clock when it answered; every relative time on screen is measured from here. */
  readonly observedAt: string;
};

export type LoadState =
  | { readonly status: "loading" }
  | { readonly status: "unauthorized" }
  | { readonly status: "empty" }
  | { readonly status: "error"; readonly message: string }
  | { readonly status: "ready"; readonly snapshot: PassportSnapshot };

export type ReadinessRow = {
  readonly capability: Capability;
  readonly readiness: CapabilityReadiness | undefined;
};

export function readinessRows(snapshot: PassportSnapshot): readonly ReadinessRow[] {
  const { bundle } = snapshot;

  return bundle.capabilities.map((capability) => ({
    capability,
    readiness: bundle.runtime.capabilityReadiness.find(
      (entry) => entry.capabilityId === capability.id,
    ),
  }));
}

/** The repository has moved past the revision the Handoff was captured from. */
export function isHandoffStale(snapshot: PassportSnapshot): boolean {
  const captured = snapshot.bundle.project.repository.revision;

  return captured !== undefined && captured !== snapshot.repository.revision;
}
