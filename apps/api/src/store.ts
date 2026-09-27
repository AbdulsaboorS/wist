import type { Runtime } from "@wist/domain";

import type { ConnectionTokenClaims, Ed25519PublicKey, PassportBundle } from "./contracts.js";

export type StoredIdentity = {
  readonly id: string;
  readonly publicKey: Ed25519PublicKey;
  readonly createdAt: string;
};

export type StoredShare = {
  readonly id: string;
  readonly identityId: string;
  readonly projectId: string;
  readonly handoffId: string;
  readonly expiresAt: string;
  // Absent once the share is revoked or its expired content has been purged.
  readonly bundle?: PassportBundle;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly revokedAt?: string;
};

export type StoredConnectionGrant = {
  readonly tokenId: string;
  readonly connectionId: string;
  readonly identityId: string;
  readonly shareId: string;
  readonly projectId: string;
  readonly scopes: ConnectionTokenClaims["scope"];
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly revokedAt?: string;
};

export type AuthorizationRecord = {
  readonly identity: StoredIdentity;
  readonly share: StoredShare;
  readonly grant: StoredConnectionGrant;
};

export type PublishShareInput = {
  readonly share: StoredShare & { readonly bundle: PassportBundle };
  readonly grant: StoredConnectionGrant;
};

export type UpdateHandoffInput = {
  readonly projectId: string;
  readonly identityId: string;
  readonly bundle: PassportBundle;
  readonly updatedAt: string;
};

export class PassportStoreConflictError extends Error {}

export interface PassportStore {
  registerIdentity(identity: StoredIdentity): Promise<void>;
  getIdentity(identityId: string): Promise<StoredIdentity | undefined>;
  /** Creates a share, superseding any earlier share of the Project owned by the same identity. */
  publish(input: PublishShareInput): Promise<void>;
  /** Replaces the Handoff of an unrevoked share in place; false when no such share exists. */
  updateHandoff(input: UpdateHandoffInput): Promise<boolean>;
  getShare(projectId: string): Promise<StoredShare | undefined>;
  getAuthorization(tokenId: string): Promise<AuthorizationRecord | undefined>;
  replaceGrant(
    oldTokenId: string,
    grant: StoredConnectionGrant,
    revokedAt: string,
  ): Promise<boolean>;
  recordReadiness(shareId: string, runtime: Runtime, reportedAt: string): Promise<void>;
  getReadiness(shareId: string): Promise<Runtime | undefined>;
  revokeProject(projectId: string, identityId: string, revokedAt: string): Promise<boolean>;
  /** Deletes the content of shares that expired at or before `now`; returns how many. */
  purgeExpired(now: string): Promise<number>;
}

export class InMemoryPassportStore implements PassportStore {
  readonly #identities = new Map<string, StoredIdentity>();
  readonly #shares = new Map<string, StoredShare>();
  readonly #projectShares = new Map<string, string>();
  readonly #grants = new Map<string, StoredConnectionGrant>();
  readonly #readiness = new Map<string, Runtime>();

  async registerIdentity(identity: StoredIdentity): Promise<void> {
    const existing = this.#identities.get(identity.id);

    if (
      existing !== undefined &&
      JSON.stringify(existing.publicKey) !== JSON.stringify(identity.publicKey)
    ) {
      throw new PassportStoreConflictError("Identity key does not match its existing record.");
    }

    this.#identities.set(identity.id, structuredClone(identity));
  }

  async getIdentity(identityId: string): Promise<StoredIdentity | undefined> {
    const identity = this.#identities.get(identityId);

    return identity === undefined ? undefined : structuredClone(identity);
  }

  async publish(input: PublishShareInput): Promise<void> {
    if (this.#identities.get(input.share.identityId) === undefined) {
      throw new PassportStoreConflictError("Publishing identity is not registered.");
    }

    const previousId = this.#projectShares.get(input.share.projectId);
    const previous = previousId === undefined ? undefined : this.#shares.get(previousId);

    if (
      (previous !== undefined && previous.identityId !== input.share.identityId) ||
      this.#shares.has(input.share.id) ||
      this.#grants.has(input.grant.tokenId)
    ) {
      throw new PassportStoreConflictError("Share or Connection already exists.");
    }

    if (previous !== undefined) {
      this.#deleteShare(previous.id);
    }

    this.#shares.set(input.share.id, structuredClone(input.share));
    this.#projectShares.set(input.share.projectId, input.share.id);
    this.#grants.set(input.grant.tokenId, structuredClone(input.grant));
  }

  async updateHandoff(input: UpdateHandoffInput): Promise<boolean> {
    const shareId = this.#projectShares.get(input.projectId);
    const share = shareId === undefined ? undefined : this.#shares.get(shareId);

    if (
      share === undefined ||
      share.identityId !== input.identityId ||
      share.revokedAt !== undefined
    ) {
      return false;
    }

    this.#shares.set(share.id, {
      ...share,
      handoffId: input.bundle.handoff.id,
      expiresAt: input.bundle.handoff.expiresAt,
      bundle: structuredClone(input.bundle),
      updatedAt: input.updatedAt,
    });

    return true;
  }

  async getShare(projectId: string): Promise<StoredShare | undefined> {
    const shareId = this.#projectShares.get(projectId);
    const share = shareId === undefined ? undefined : this.#shares.get(shareId);

    return share === undefined ? undefined : structuredClone(share);
  }

  async getAuthorization(tokenId: string): Promise<AuthorizationRecord | undefined> {
    const grant = this.#grants.get(tokenId);

    if (grant === undefined) {
      return undefined;
    }

    const share = this.#shares.get(grant.shareId);
    const identity = this.#identities.get(grant.identityId);

    if (share === undefined || identity === undefined) {
      return undefined;
    }

    return structuredClone({ identity, share, grant });
  }

  async replaceGrant(
    oldTokenId: string,
    grant: StoredConnectionGrant,
    revokedAt: string,
  ): Promise<boolean> {
    const old = this.#grants.get(oldTokenId);
    const share = old === undefined ? undefined : this.#shares.get(old.shareId);

    if (
      old === undefined ||
      share === undefined ||
      old.revokedAt !== undefined ||
      share.revokedAt !== undefined ||
      old.identityId !== grant.identityId ||
      old.projectId !== grant.projectId ||
      old.shareId !== grant.shareId ||
      this.#grants.has(grant.tokenId)
    ) {
      return false;
    }

    this.#grants.set(oldTokenId, { ...old, revokedAt });
    this.#grants.set(grant.tokenId, structuredClone(grant));

    return true;
  }

  async recordReadiness(shareId: string, runtime: Runtime): Promise<void> {
    if (this.#shares.has(shareId)) {
      this.#readiness.set(shareId, structuredClone(runtime));
    }
  }

  async getReadiness(shareId: string): Promise<Runtime | undefined> {
    const runtime = this.#readiness.get(shareId);

    return runtime === undefined ? undefined : structuredClone(runtime);
  }

  async revokeProject(projectId: string, identityId: string, revokedAt: string): Promise<boolean> {
    const shareId = this.#projectShares.get(projectId);
    const share = shareId === undefined ? undefined : this.#shares.get(shareId);

    if (share === undefined || share.identityId !== identityId) {
      return false;
    }

    const { bundle: _deleted, ...retained } = share;
    this.#shares.set(share.id, { ...retained, revokedAt });
    this.#readiness.delete(share.id);

    for (const [tokenId, grant] of this.#grants) {
      if (grant.shareId === share.id && grant.revokedAt === undefined) {
        this.#grants.set(tokenId, { ...grant, revokedAt });
      }
    }

    return true;
  }

  async purgeExpired(now: string): Promise<number> {
    let purged = 0;

    for (const share of this.#shares.values()) {
      if (share.bundle !== undefined && Date.parse(share.expiresAt) <= Date.parse(now)) {
        const { bundle: _deleted, ...retained } = share;
        this.#shares.set(share.id, retained);
        this.#readiness.delete(share.id);
        purged += 1;
      }
    }

    return purged;
  }

  #deleteShare(shareId: string): void {
    this.#shares.delete(shareId);
    this.#readiness.delete(shareId);

    for (const [tokenId, grant] of this.#grants) {
      if (grant.shareId === shareId) {
        this.#grants.delete(tokenId);
      }
    }
  }
}
