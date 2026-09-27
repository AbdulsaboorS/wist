import { RuntimeSchema, type Runtime } from "@wist/domain";

import {
  DestinationAccessScopeSchema,
  Ed25519PublicKeySchema,
  PassportBundleSchema,
} from "./contracts.js";
import {
  PassportStoreConflictError,
  type AuthorizationRecord,
  type PassportStore,
  type PublishShareInput,
  type StoredConnectionGrant,
  type StoredIdentity,
  type StoredShare,
  type UpdateHandoffInput,
} from "./store.js";

// Share content lives in share_bundles so revocation and expiry delete it with one row.
const SHARE_SELECT = `SELECT s.id, s.identity_id, s.project_id, s.handoff_id, s.expires_at,
  s.revoked_at, b.bundle_json, s.created_at, s.updated_at
  FROM shares s LEFT JOIN share_bundles b ON b.share_id = s.id`;

type IdentityRow = {
  id: string;
  public_jwk: string;
  created_at: string;
};

type ShareRow = {
  id: string;
  identity_id: string;
  project_id: string;
  handoff_id: string;
  expires_at: string;
  revoked_at: string | null;
  bundle_json: string | null;
  created_at: string;
  updated_at: string;
};

type AuthorizationRow = ShareRow & {
  public_jwk: string;
  identity_created_at: string;
  token_id: string;
  connection_id: string;
  grant_identity_id: string;
  grant_share_id: string;
  grant_project_id: string;
  scopes_json: string;
  issued_at: string;
  grant_expires_at: string;
  grant_revoked_at: string | null;
};

export class D1PassportStore implements PassportStore {
  readonly #database: D1Database;

  constructor(database: D1Database) {
    this.#database = database;
  }

  async registerIdentity(identity: StoredIdentity): Promise<void> {
    await this.#database
      .prepare("INSERT OR IGNORE INTO identities (id, public_jwk, created_at) VALUES (?1, ?2, ?3)")
      .bind(identity.id, JSON.stringify(identity.publicKey), identity.createdAt)
      .run();

    const stored = await this.getIdentity(identity.id);

    if (
      stored === undefined ||
      JSON.stringify(stored.publicKey) !== JSON.stringify(identity.publicKey)
    ) {
      throw new PassportStoreConflictError("Identity key does not match its existing record.");
    }
  }

  async getIdentity(identityId: string): Promise<StoredIdentity | undefined> {
    const row = await this.#database
      .prepare("SELECT id, public_jwk, created_at FROM identities WHERE id = ?1")
      .bind(identityId)
      .first<IdentityRow>();

    return row === null ? undefined : identityFromRow(row);
  }

  async publish(input: PublishShareInput): Promise<void> {
    const previous = await this.getShare(input.share.projectId);

    if (previous !== undefined && previous.identityId !== input.share.identityId) {
      throw new PassportStoreConflictError("Share or Connection already exists.");
    }

    const supersede =
      previous === undefined
        ? []
        : [
            this.#database
              .prepare("DELETE FROM runtime_readiness WHERE share_id = ?1")
              .bind(previous.id),
            this.#database
              .prepare("DELETE FROM share_bundles WHERE share_id = ?1")
              .bind(previous.id),
            this.#database
              .prepare("DELETE FROM connection_grants WHERE share_id = ?1")
              .bind(previous.id),
            this.#database
              .prepare("DELETE FROM shares WHERE id = ?1 AND identity_id = ?2")
              .bind(previous.id, input.share.identityId),
          ];

    const insertShare = this.#database
      .prepare(
        `INSERT INTO shares
          (id, identity_id, project_id, handoff_id, expires_at, revoked_at, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, NULL, ?6, ?6)`,
      )
      .bind(
        input.share.id,
        input.share.identityId,
        input.share.projectId,
        input.share.handoffId,
        input.share.expiresAt,
        input.share.createdAt,
      );

    const insertBundle = this.#database
      .prepare("INSERT INTO share_bundles (share_id, bundle_json) VALUES (?1, ?2)")
      .bind(input.share.id, JSON.stringify(input.share.bundle));

    const insertGrant = this.#database
      .prepare(
        `INSERT INTO connection_grants
          (token_id, connection_id, identity_id, share_id, project_id, scopes_json,
           issued_at, expires_at, revoked_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, NULL)`,
      )
      .bind(
        input.grant.tokenId,
        input.grant.connectionId,
        input.grant.identityId,
        input.grant.shareId,
        input.grant.projectId,
        JSON.stringify(input.grant.scopes),
        input.grant.issuedAt,
        input.grant.expiresAt,
      );

    try {
      await this.#database.batch([...supersede, insertShare, insertBundle, insertGrant]);
    } catch (error) {
      if (error instanceof Error && /constraint|unique/i.test(error.message)) {
        throw new PassportStoreConflictError("Share or Connection already exists.");
      }

      throw error;
    }
  }

  async updateHandoff(input: UpdateHandoffInput): Promise<boolean> {
    const share = await this.getShare(input.projectId);

    if (
      share === undefined ||
      share.identityId !== input.identityId ||
      share.revokedAt !== undefined
    ) {
      return false;
    }

    const [updated] = await this.#database.batch([
      this.#database
        .prepare(
          `UPDATE shares SET handoff_id = ?1, expires_at = ?2, updated_at = ?3
           WHERE id = ?4 AND identity_id = ?5 AND revoked_at IS NULL`,
        )
        .bind(
          input.bundle.handoff.id,
          input.bundle.handoff.expiresAt,
          input.updatedAt,
          share.id,
          input.identityId,
        ),
      this.#database
        .prepare(
          `INSERT INTO share_bundles (share_id, bundle_json) VALUES (?1, ?2)
           ON CONFLICT(share_id) DO UPDATE SET bundle_json = excluded.bundle_json`,
        )
        .bind(share.id, JSON.stringify(input.bundle)),
    ]);

    return updated?.meta.changes === 1;
  }

  async getShare(projectId: string): Promise<StoredShare | undefined> {
    const row = await this.#database
      .prepare(`${SHARE_SELECT} WHERE s.project_id = ?1`)
      .bind(projectId)
      .first<ShareRow>();

    return row === null ? undefined : shareFromRow(row);
  }

  async getAuthorization(tokenId: string): Promise<AuthorizationRecord | undefined> {
    const row = await this.#database
      .prepare(
        `SELECT
           s.id, s.identity_id, s.project_id, s.handoff_id, s.expires_at, s.revoked_at,
           b.bundle_json, s.created_at, s.updated_at,
           i.public_jwk, i.created_at AS identity_created_at,
           g.token_id, g.connection_id, g.identity_id AS grant_identity_id,
           g.share_id AS grant_share_id, g.project_id AS grant_project_id,
           g.scopes_json, g.issued_at, g.expires_at AS grant_expires_at,
           g.revoked_at AS grant_revoked_at
         FROM connection_grants g
         JOIN shares s ON s.id = g.share_id
         LEFT JOIN share_bundles b ON b.share_id = s.id
         JOIN identities i ON i.id = g.identity_id
         WHERE g.token_id = ?1`,
      )
      .bind(tokenId)
      .first<AuthorizationRow>();

    if (row === null) {
      return undefined;
    }

    return {
      identity: {
        id: row.identity_id,
        publicKey: Ed25519PublicKeySchema.parse(JSON.parse(row.public_jwk)),
        createdAt: row.identity_created_at,
      },
      share: shareFromRow(row),
      grant: grantFromRow(row),
    };
  }

  async replaceGrant(
    oldTokenId: string,
    grant: StoredConnectionGrant,
    revokedAt: string,
  ): Promise<boolean> {
    const old = await this.getAuthorization(oldTokenId);

    if (
      old === undefined ||
      old.grant.revokedAt !== undefined ||
      old.share.revokedAt !== undefined ||
      old.grant.identityId !== grant.identityId ||
      old.grant.projectId !== grant.projectId ||
      old.grant.shareId !== grant.shareId
    ) {
      return false;
    }

    const results = await this.#database.batch([
      this.#database
        .prepare(
          `INSERT INTO connection_grants
          (token_id, connection_id, identity_id, share_id, project_id, scopes_json,
           issued_at, expires_at, revoked_at, replaces_token_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, NULL, ?9)`,
        )
        .bind(
          grant.tokenId,
          grant.connectionId,
          grant.identityId,
          grant.shareId,
          grant.projectId,
          JSON.stringify(grant.scopes),
          grant.issuedAt,
          grant.expiresAt,
          oldTokenId,
        ),
      this.#database
        .prepare(
          "UPDATE connection_grants SET revoked_at = ?1 WHERE token_id = ?2 AND revoked_at IS NULL",
        )
        .bind(revokedAt, oldTokenId),
    ]);

    return (results[1]?.meta.changes ?? 0) === 1;
  }

  async recordReadiness(shareId: string, runtime: Runtime, reportedAt: string): Promise<void> {
    await this.#database
      .prepare(
        `INSERT INTO runtime_readiness (share_id, runtime_json, reported_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(share_id) DO UPDATE SET
           runtime_json = excluded.runtime_json, reported_at = excluded.reported_at`,
      )
      .bind(shareId, JSON.stringify(runtime), reportedAt)
      .run();
  }

  async getReadiness(shareId: string): Promise<Runtime | undefined> {
    const row = await this.#database
      .prepare("SELECT runtime_json FROM runtime_readiness WHERE share_id = ?1")
      .bind(shareId)
      .first<{ runtime_json: string }>();

    return row === null ? undefined : RuntimeSchema.parse(JSON.parse(row.runtime_json));
  }

  async revokeProject(projectId: string, identityId: string, revokedAt: string): Promise<boolean> {
    const share = await this.getShare(projectId);

    if (share === undefined || share.identityId !== identityId) {
      return false;
    }

    await this.#database.batch([
      this.#database
        .prepare("UPDATE shares SET revoked_at = ?1 WHERE id = ?2 AND identity_id = ?3")
        .bind(revokedAt, share.id, identityId),
      this.#database
        .prepare(
          "UPDATE connection_grants SET revoked_at = ?1 WHERE share_id = ?2 AND revoked_at IS NULL",
        )
        .bind(revokedAt, share.id),
      this.#database.prepare("DELETE FROM runtime_readiness WHERE share_id = ?1").bind(share.id),
      this.#database.prepare("DELETE FROM share_bundles WHERE share_id = ?1").bind(share.id),
    ]);

    return true;
  }

  async purgeExpired(now: string): Promise<number> {
    const [, purged] = await this.#database.batch([
      this.#database
        .prepare(
          `DELETE FROM runtime_readiness WHERE share_id IN
           (SELECT id FROM shares WHERE julianday(expires_at) <= julianday(?1))`,
        )
        .bind(now),
      this.#database
        .prepare(
          `DELETE FROM share_bundles WHERE share_id IN
           (SELECT id FROM shares WHERE julianday(expires_at) <= julianday(?1))`,
        )
        .bind(now),
    ]);

    return purged?.meta.changes ?? 0;
  }
}

function identityFromRow(row: IdentityRow): StoredIdentity {
  return {
    id: row.id,
    publicKey: Ed25519PublicKeySchema.parse(JSON.parse(row.public_jwk)),
    createdAt: row.created_at,
  };
}

function shareFromRow(row: ShareRow): StoredShare {
  let share: StoredShare = {
    id: row.id,
    identityId: row.identity_id,
    projectId: row.project_id,
    handoffId: row.handoff_id,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };

  if (row.bundle_json !== null) {
    share = { ...share, bundle: PassportBundleSchema.parse(JSON.parse(row.bundle_json)) };
  }

  return row.revoked_at === null ? share : { ...share, revokedAt: row.revoked_at };
}

function grantFromRow(row: AuthorizationRow): StoredConnectionGrant {
  const grant: StoredConnectionGrant = {
    tokenId: row.token_id,
    connectionId: row.connection_id,
    identityId: row.grant_identity_id,
    shareId: row.grant_share_id,
    projectId: row.grant_project_id,
    scopes: DestinationAccessScopeSchema.array().parse(JSON.parse(row.scopes_json)),
    issuedAt: row.issued_at,
    expiresAt: row.grant_expires_at,
  };

  return row.grant_revoked_at === null ? grant : { ...grant, revokedAt: row.grant_revoked_at };
}
