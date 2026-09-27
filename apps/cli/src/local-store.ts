import { closeSync, constants, lstatSync, mkdirSync, openSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { AsyncEntry } from "@napi-rs/keyring";
import {
  DestinationAccessScopeSchema,
  PassportBundleSchema,
  type DestinationAccessScope,
  type PassportBundle,
} from "@wist/api";

import { approveDraft, validateDraft } from "./draft.js";
import type { ConnectionToken } from "./identity.js";

const CONNECTION_SERVICE = "dev.wist.connection";

type ConnectionRow = {
  connection_id: string;
  project_id: string;
  share_id: string;
  token_id: string;
  relay_url: string;
  expires_at: string;
  issued_at: string | null;
  token_suffix: string | null;
  scopes_json: string;
  revoked_at: string | null;
};

export type LocalProjectRecord = {
  bundle: PassportBundle;
  repositoryPath: string;
  shareId?: string;
  relayUrl?: string;
  revokedAt?: string;
  // The Handoff the relay currently serves; the working bundle may be a newer draft.
  publishedHandoffId?: string;
};

export type LocalConnectionRecord = {
  connectionId: string;
  shareId: string;
  tokenId: string;
  expiresAt: string;
  issuedAt?: string;
  tokenSuffix?: string;
  scopes: readonly DestinationAccessScope[];
  status: "active" | "expired" | "revoked";
  maskedToken: string;
};

export interface ConnectionSecretStore {
  read(connectionId: string): Promise<string | undefined>;
  write(connectionId: string, token: string): Promise<void>;
  delete(connectionId: string): Promise<void>;
}

export class InMemoryConnectionSecretStore implements ConnectionSecretStore {
  readonly #tokens = new Map<string, string>();

  async read(connectionId: string): Promise<string | undefined> {
    return this.#tokens.get(connectionId);
  }

  async write(connectionId: string, token: string): Promise<void> {
    this.#tokens.set(connectionId, token);
  }

  async delete(connectionId: string): Promise<void> {
    this.#tokens.delete(connectionId);
  }
}

export class MacOsKeychainConnectionSecretStore implements ConnectionSecretStore {
  constructor() {
    if (process.platform !== "darwin") {
      throw new Error("Protected Connection storage currently requires macOS Keychain.");
    }
  }

  async read(connectionId: string): Promise<string | undefined> {
    return await new AsyncEntry(CONNECTION_SERVICE, connectionId).getPassword();
  }

  async write(connectionId: string, token: string): Promise<void> {
    await new AsyncEntry(CONNECTION_SERVICE, connectionId).setPassword(token);
  }

  async delete(connectionId: string): Promise<void> {
    await new AsyncEntry(CONNECTION_SERVICE, connectionId).deletePassword();
  }
}

export class LocalPassportStore {
  readonly #database: DatabaseSync;
  readonly #secrets: ConnectionSecretStore;

  constructor(database: DatabaseSync, secrets: ConnectionSecretStore) {
    this.#database = database;
    this.#secrets = secrets;
    this.#database.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS local_projects (
        id TEXT PRIMARY KEY NOT NULL,
        repository_path TEXT NOT NULL,
        bundle_json TEXT NOT NULL,
        share_id TEXT,
        relay_url TEXT,
        revoked_at TEXT
      );
      CREATE TABLE IF NOT EXISTS local_connections (
        connection_id TEXT PRIMARY KEY NOT NULL,
        project_id TEXT NOT NULL REFERENCES local_projects(id),
        share_id TEXT NOT NULL,
        token_id TEXT NOT NULL UNIQUE,
        relay_url TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        issued_at TEXT,
        token_suffix TEXT,
        scopes_json TEXT NOT NULL,
        revoked_at TEXT
      );
      CREATE INDEX IF NOT EXISTS local_connections_project_idx
        ON local_connections(project_id, revoked_at);
    `);

    // SAFETY: SQLite PRAGMA table_info returns a name string for each column.
    const columns = this.#database.prepare("PRAGMA table_info(local_connections)").all() as Array<{
      name: string;
    }>;

    if (!columns.some((column) => column.name === "issued_at")) {
      this.#database.exec("ALTER TABLE local_connections ADD COLUMN issued_at TEXT");
    }

    if (!columns.some((column) => column.name === "token_suffix")) {
      this.#database.exec("ALTER TABLE local_connections ADD COLUMN token_suffix TEXT");
    }

    // SAFETY: SQLite PRAGMA table_info returns a name string for each column.
    const projectColumns = this.#database
      .prepare("PRAGMA table_info(local_projects)")
      .all() as Array<{ name: string }>;

    if (!projectColumns.some((column) => column.name === "published_handoff_id")) {
      this.#database.exec(`
        ALTER TABLE local_projects ADD COLUMN published_handoff_id TEXT;
        UPDATE local_projects SET published_handoff_id = json_extract(bundle_json, '$.handoff.id')
          WHERE share_id IS NOT NULL;
      `);
    }
  }

  static open(
    secrets: ConnectionSecretStore,
    directory = defaultLocalDirectory(),
  ): LocalPassportStore {
    ensurePrivateDirectory(directory);
    const path = join(directory, "passport.sqlite");

    try {
      const file = openSync(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
      closeSync(file);
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) {
        throw error;
      }
    }

    const file = lstatSync(path);

    if (!file.isFile() || (file.mode & 0o077) !== 0) {
      throw new Error("Local Passport database must be a private regular file.");
    }

    return new LocalPassportStore(new DatabaseSync(path), secrets);
  }

  close(): void {
    this.#database.close();
  }

  saveDraft(bundle: PassportBundle, repositoryPath: string): PassportBundle {
    const draft = validateDraft(bundle);

    if (draft.handoff.status !== "draft") {
      throw new Error("Only a draft Handoff can be saved as a draft.");
    }

    // A new draft replaces only the working bundle; an existing share keeps serving its
    // published Handoff until the draft is approved and published.
    this.#database
      .prepare(`INSERT INTO local_projects (id, repository_path, bundle_json)
        VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET
        repository_path = excluded.repository_path, bundle_json = excluded.bundle_json`)
      .run(draft.project.id, repositoryPath, JSON.stringify(draft));

    return draft;
  }

  approve(projectId: string, approvedAt: string): PassportBundle {
    const project = this.get(projectId);

    if (project === undefined) {
      throw new Error("Project was not found locally.");
    }

    const approved = approveDraft(project.bundle, approvedAt);
    this.#database
      .prepare("UPDATE local_projects SET bundle_json = ? WHERE id = ?")
      .run(JSON.stringify(approved), projectId);

    return approved;
  }

  saveApproved(bundle: PassportBundle, repositoryPath: string): void {
    const approved = validateDraft(bundle);

    if (approved.handoff.status !== "published" || approved.handoff.approvedAt === undefined) {
      throw new Error("Import requires an approved Handoff.");
    }

    const existing = this.get(approved.project.id);

    if (existing?.shareId !== undefined || existing?.revokedAt !== undefined) {
      throw new Error("An existing share cannot be replaced by an imported Handoff.");
    }

    this.#database
      .prepare(`INSERT INTO local_projects (id, repository_path, bundle_json)
      VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET
      repository_path = excluded.repository_path, bundle_json = excluded.bundle_json`)
      .run(approved.project.id, repositoryPath, JSON.stringify(approved));
  }

  get(projectId: string): LocalProjectRecord | undefined {
    // SAFETY: The selected columns have the declared SQLite TEXT/null constraints.
    const row = this.#database
      .prepare(
        "SELECT repository_path, bundle_json, share_id, relay_url, revoked_at, published_handoff_id FROM local_projects WHERE id = ?",
      )
      .get(projectId) as
      | {
          repository_path: string;
          bundle_json: string;
          share_id: string | null;
          relay_url: string | null;
          revoked_at: string | null;
          published_handoff_id: string | null;
        }
      | undefined;

    if (row === undefined) {
      return undefined;
    }

    const record: LocalProjectRecord = {
      bundle: PassportBundleSchema.parse(JSON.parse(row.bundle_json)),
      repositoryPath: row.repository_path,
    };

    if (row.share_id !== null) record.shareId = row.share_id;

    if (row.relay_url !== null) record.relayUrl = row.relay_url;

    if (row.revoked_at !== null) record.revokedAt = row.revoked_at;

    if (row.published_handoff_id !== null) record.publishedHandoffId = row.published_handoff_id;

    return record;
  }

  findByRepository(repositoryPath: string): LocalProjectRecord | undefined {
    // SAFETY: This query selects only the non-null id column.
    const row = this.#database
      .prepare(
        "SELECT id FROM local_projects WHERE repository_path = ? ORDER BY rowid DESC LIMIT 1",
      )
      .get(repositoryPath) as { id: string } | undefined;

    return row === undefined ? undefined : this.get(row.id);
  }

  list(): LocalProjectRecord[] {
    // SAFETY: This query selects only the non-null id column.
    const rows = this.#database
      .prepare("SELECT id FROM local_projects ORDER BY id")
      .all() as Array<{ id: string }>;

    return rows.map((row) => {
      const project = this.get(row.id);

      if (project === undefined) {
        throw new Error("Local Passport database changed while listing Projects.");
      }

      return project;
    });
  }

  /** Records a new share and its first Connection, superseding any earlier share. */
  async recordConnection(
    projectId: string,
    relayUrl: string,
    connection: ConnectionToken,
  ): Promise<void> {
    const project = this.get(projectId);

    if (
      project === undefined ||
      project.bundle.handoff.status !== "published" ||
      Date.parse(connection.expiresAt) > Date.parse(project.bundle.handoff.expiresAt)
    ) {
      throw new Error("A new share requires an approved Handoff and bounded expiry.");
    }

    // SAFETY: This query selects only the non-null connection_id column.
    const superseded = this.#database
      .prepare("SELECT connection_id FROM local_connections WHERE project_id = ?")
      .all(projectId) as Array<{ connection_id: string }>;

    await this.#secrets.write(connection.connectionId, connection.token);

    try {
      this.#database.exec("BEGIN IMMEDIATE");
      this.#database
        .prepare(
          "UPDATE local_connections SET revoked_at = ? WHERE project_id = ? AND revoked_at IS NULL",
        )
        .run(connection.issuedAt ?? new Date().toISOString(), projectId);
      this.#database
        .prepare(
          `UPDATE local_projects SET share_id = ?, relay_url = ?, revoked_at = NULL,
           published_handoff_id = ? WHERE id = ?`,
        )
        .run(connection.shareId, relayUrl, project.bundle.handoff.id, projectId);
      this.#database
        .prepare(`INSERT INTO local_connections
          (connection_id, project_id, share_id, token_id, relay_url, expires_at, issued_at, token_suffix, scopes_json)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(
          connection.connectionId,
          projectId,
          connection.shareId,
          connection.tokenId,
          relayUrl,
          connection.expiresAt,
          connection.issuedAt ?? new Date().toISOString(),
          connection.token.slice(-4),
          JSON.stringify(connection.scopes),
        );
      this.#database.exec("COMMIT");
    } catch (error) {
      this.#database.exec("ROLLBACK");
      await this.#secrets.delete(connection.connectionId);
      throw error;
    }

    for (const row of superseded) {
      await this.#secrets.delete(row.connection_id);
    }
  }

  recordPublishedHandoff(projectId: string, handoffId: string): void {
    const updated = this.#database
      .prepare(
        `UPDATE local_projects SET published_handoff_id = ?
         WHERE id = ? AND share_id IS NOT NULL AND revoked_at IS NULL
           AND json_extract(bundle_json, '$.handoff.id') = ?`,
      )
      .run(handoffId, projectId, handoffId);

    if (updated.changes !== 1) {
      throw new Error("Only the approved Handoff of an active share can be recorded as published.");
    }
  }

  connections(projectId: string, now = new Date()): LocalConnectionRecord[] {
    const rows = this.#database
      .prepare("SELECT * FROM local_connections WHERE project_id = ? ORDER BY rowid DESC")
      .all(projectId);

    return rows.map((value) => {
      // SAFETY: SELECT * reads the local_connections table whose columns are declared above.
      const row = value as ConnectionRow;

      const record: LocalConnectionRecord = {
        connectionId: row.connection_id,
        shareId: row.share_id,
        tokenId: row.token_id,
        expiresAt: row.expires_at,
        scopes: DestinationAccessScopeSchema.array().parse(JSON.parse(row.scopes_json)),
        status:
          row.revoked_at !== null
            ? ("revoked" as const)
            : Date.parse(row.expires_at) <= now.getTime()
              ? ("expired" as const)
              : ("active" as const),
        maskedToken: "••••••••",
      };

      if (row.issued_at !== null) record.issuedAt = row.issued_at;

      if (row.token_suffix !== null) record.tokenSuffix = row.token_suffix;

      return record;
    });
  }

  async reveal(
    connectionId: string,
    now = new Date(),
  ): Promise<{ connectionUrl: string; token: string }> {
    const row = this.#connection(connectionId);
    const project = row === undefined ? undefined : this.get(row.project_id);

    if (
      row === undefined ||
      project === undefined ||
      row.revoked_at !== null ||
      project.revokedAt !== undefined ||
      project.shareId !== row.share_id ||
      Date.parse(row.expires_at) <= now.getTime()
    ) {
      throw new Error("Connection is unavailable.");
    }

    const token = await this.#secrets.read(connectionId);

    if (token === undefined) {
      throw new Error("The local Connection token is missing.");
    }

    const url = new URL("/connect", row.relay_url);
    url.hash = `token=${encodeURIComponent(token)}`;

    return { connectionUrl: url.toString(), token };
  }

  async revoke(projectId: string, revokedAt: string): Promise<void> {
    const project = this.get(projectId);

    if (project === undefined) {
      throw new Error("Project was not found locally.");
    }

    // Only the shared Handoff becomes revoked; a newer working draft stays reusable.
    const shared =
      project.bundle.handoff.status === "published" &&
      project.bundle.handoff.id === project.publishedHandoffId;

    const bundle = shared
      ? PassportBundleSchema.parse({
          ...project.bundle,
          handoff: { ...project.bundle.handoff, status: "revoked", revokedAt },
        })
      : project.bundle;

    // SAFETY: This query selects only the non-null connection_id column.
    const rows = this.#database
      .prepare("SELECT connection_id FROM local_connections WHERE project_id = ?")
      .all(projectId) as Array<{ connection_id: string }>;

    this.#database.exec("BEGIN IMMEDIATE");

    try {
      this.#database
        .prepare("UPDATE local_projects SET revoked_at = ?, bundle_json = ? WHERE id = ?")
        .run(revokedAt, JSON.stringify(bundle), projectId);
      this.#database
        .prepare(
          "UPDATE local_connections SET revoked_at = ? WHERE project_id = ? AND revoked_at IS NULL",
        )
        .run(revokedAt, projectId);
      this.#database.exec("COMMIT");
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }

    for (const row of rows) {
      await this.#secrets.delete(row.connection_id);
    }
  }

  async replaceConnection(
    projectId: string,
    oldConnectionId: string,
    relayUrl: string,
    replacement: ConnectionToken,
    revokedAt: string,
  ): Promise<void> {
    const old = this.#connection(oldConnectionId);

    if (
      old === undefined ||
      old.project_id !== projectId ||
      old.revoked_at !== null ||
      old.share_id !== replacement.shareId
    ) {
      throw new Error("Connection is not active for this share.");
    }

    await this.#secrets.write(replacement.connectionId, replacement.token);

    try {
      this.#database.exec("BEGIN IMMEDIATE");
      this.#database
        .prepare(`INSERT INTO local_connections
          (connection_id, project_id, share_id, token_id, relay_url, expires_at, issued_at, token_suffix, scopes_json)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(
          replacement.connectionId,
          projectId,
          replacement.shareId,
          replacement.tokenId,
          relayUrl,
          replacement.expiresAt,
          replacement.issuedAt ?? revokedAt,
          replacement.token.slice(-4),
          JSON.stringify(replacement.scopes),
        );

      const revoked = this.#database
        .prepare(
          "UPDATE local_connections SET revoked_at = ? WHERE connection_id = ? AND revoked_at IS NULL",
        )
        .run(revokedAt, oldConnectionId);

      if (revoked.changes !== 1) {
        throw new Error("Connection was already replaced or revoked.");
      }

      this.#database.exec("COMMIT");
    } catch (error) {
      this.#database.exec("ROLLBACK");
      await this.#secrets.delete(replacement.connectionId);
      throw error;
    }

    await this.#secrets.delete(oldConnectionId);
  }

  #connection(connectionId: string): ConnectionRow | undefined {
    const row = this.#database
      .prepare("SELECT * FROM local_connections WHERE connection_id = ?")
      .get(connectionId);

    // SAFETY: SELECT * reads the local_connections table whose columns are declared above.
    return row === undefined ? undefined : (row as ConnectionRow);
  }
}

function defaultLocalDirectory(): string {
  return join(homedir(), "Library", "Application Support", "Wist");
}

function ensurePrivateDirectory(directory: string): void {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const info = lstatSync(directory);

  if (
    !info.isDirectory() ||
    (info.mode & 0o077) !== 0 ||
    statSync(directory).uid !== process.getuid?.()
  ) {
    throw new Error("Local Passport directory must be owned by this user and private.");
  }
}
