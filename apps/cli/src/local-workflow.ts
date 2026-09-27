import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { promisify } from "node:util";

import type { PassportBundle } from "@wist/api";

import {
  bundleFromDraftInput,
  parseGitHubRemote,
  type HandoffDraftInput,
} from "./capture-input.js";
import { PassportApiClient } from "./client.js";
import { captureDraft, screenForSecrets } from "./draft.js";
import { LocalIdentityManager } from "./identity.js";
import { LocalPassportStore } from "./local-store.js";

const execFileAsync = promisify(execFile);

const DEFAULT_SCOPES = ["project:read", "handoff:read", "setup-plan:read"] as const;

export class LocalPassportWorkflow {
  readonly #store: LocalPassportStore;
  readonly #identity: LocalIdentityManager;
  readonly #client: (relayUrl: string) => PassportApiClient;
  readonly #now: () => Date;

  constructor(options: {
    store: LocalPassportStore;
    identity: LocalIdentityManager;
    client?: (relayUrl: string) => PassportApiClient;
    now?: () => Date;
  }) {
    this.#store = options.store;
    this.#identity = options.identity;
    this.#client = options.client ?? ((url) => new PassportApiClient(url));
    this.#now = options.now ?? (() => new Date());
  }

  get store(): LocalPassportStore {
    return this.#store;
  }

  get identity(): LocalIdentityManager {
    return this.#identity;
  }

  async capture(bundle: PassportBundle, selectedRepositoryPath: string): Promise<PassportBundle> {
    const repositoryPath = await realpath(selectedRepositoryPath);

    const git = async (...args: string[]) =>
      (await execFileAsync("git", ["-C", repositoryPath, ...args])).stdout.trim();

    const root = await realpath(await git("rev-parse", "--show-toplevel"));

    if (root !== repositoryPath) {
      throw new Error("Select the repository root for this Project.");
    }

    const draft = captureDraft(bundle, {
      activeBranch: await git("branch", "--show-current"),
      revision: await git("rev-parse", "HEAD"),
      capturedAt: this.#now().toISOString(),
    });

    await screenForSecrets(draft);

    return this.#store.saveDraft(draft, repositoryPath);
  }

  /** Captures a Handoff written by a Source Agent, filling repository facts from git. */
  async captureFromAgent(
    input: HandoffDraftInput,
    selectedRepositoryPath: string,
  ): Promise<PassportBundle> {
    const repositoryPath = await realpath(selectedRepositoryPath);

    const git = async (...args: string[]) =>
      (await execFileAsync("git", ["-C", repositoryPath, ...args])).stdout.trim();

    const remote = await git("remote", "get-url", "origin").catch(() => {
      throw new Error("Choose a git repository whose origin remote is on GitHub.");
    });

    const origin = parseGitHubRemote(remote);

    const defaultBranch = await git("symbolic-ref", "--short", "refs/remotes/origin/HEAD").then(
      (reference) => reference.replace(/^origin\//, ""),
      async () => await git("branch", "--show-current"),
    );

    const projectId =
      this.#store.findByRepository(repositoryPath)?.bundle.project.id ?? crypto.randomUUID();

    return await this.capture(
      bundleFromDraftInput(input, { ...origin, defaultBranch, projectId }, this.#now()),
      repositoryPath,
    );
  }

  approve(projectId: string): PassportBundle {
    return this.#store.approve(projectId, this.#now().toISOString());
  }

  /**
   * Delivers the approved Handoff. An active share is updated in place so destinations keep their
   * Connection; otherwise a new share and Connection supersede any earlier share.
   */
  async publish(projectId: string, relayUrl: string) {
    const project = this.#store.get(projectId);

    if (project === undefined || project.bundle.handoff.status !== "published") {
      throw new Error("Publishing requires a locally approved Handoff.");
    }

    await screenForSecrets(project.bundle);
    const now = this.#now();

    const active = this.#store
      .connections(projectId, now)
      .find((connection) => connection.status === "active");

    if (
      project.shareId !== undefined &&
      project.relayUrl !== undefined &&
      project.revokedAt === undefined &&
      active !== undefined
    ) {
      if (project.publishedHandoffId === project.bundle.handoff.id) {
        throw new Error("This Handoff is already shared.");
      }

      const ownerToken = await this.#identity.createOwnerToken({ projectId, now });

      const published = await this.#client(project.relayUrl).publishHandoff(
        project.bundle,
        ownerToken,
      );

      this.#store.recordPublishedHandoff(projectId, project.bundle.handoff.id);

      return { ...published, delivery: "updated" as const, connection: active };
    }

    const apiUrl = checkedRelayUrl(relayUrl);
    const client = this.#client(apiUrl);
    await client.registerIdentity(await this.#identity.createRegistration(now));
    const shareId = crypto.randomUUID();

    const connection = await this.#identity.createConnection({
      shareId,
      projectId,
      scopes: DEFAULT_SCOPES,
      now,
      shareExpiresAt: project.bundle.handoff.expiresAt,
    });

    const ownerToken = await this.#identity.createOwnerToken({ projectId, now });

    const published = await client.publish(project.bundle, {
      ownerToken,
      shareId,
      connectionToken: connection.token,
    });

    try {
      await this.#store.recordConnection(projectId, apiUrl, connection);
    } catch (error) {
      try {
        await client.revoke(projectId, ownerToken, "Local Connection storage failed");
      } catch (revokeError) {
        throw new AggregateError(
          [error, revokeError],
          `Published Project ${projectId} could not be saved or revoked at ${apiUrl}.`,
        );
      }

      throw error;
    }

    return {
      ...published,
      delivery: "shared" as const,
      connection: this.#store.connections(projectId, now)[0],
    };
  }

  async replaceConnection(projectId: string, oldConnectionId: string, lifetimeSeconds?: number) {
    const project = this.#store.get(projectId);

    const old = this.#store
      .connections(projectId, this.#now())
      .find((item) => item.connectionId === oldConnectionId);

    if (
      project?.shareId === undefined ||
      project.relayUrl === undefined ||
      project.revokedAt !== undefined ||
      old === undefined ||
      old.status !== "active" ||
      old.shareId !== project.shareId
    ) {
      throw new Error("An active Connection for this share is required.");
    }

    const now = this.#now();

    const connection = await this.#identity.createConnection({
      shareId: project.shareId,
      projectId,
      scopes: old.scopes,
      now,
      shareExpiresAt: project.bundle.handoff.expiresAt,
      lifetimeSeconds: lifetimeSeconds ?? 86400,
    });

    const ownerToken = await this.#identity.createOwnerToken({ projectId, now });
    const client = this.#client(project.relayUrl);
    await client.replaceConnection(projectId, ownerToken, {
      oldTokenId: old.tokenId,
      connectionToken: connection.token,
      scopes: connection.scopes,
    });

    try {
      await this.#store.replaceConnection(
        projectId,
        oldConnectionId,
        project.relayUrl,
        connection,
        now.toISOString(),
      );
    } catch (error) {
      try {
        await client.revoke(projectId, ownerToken, "Replacement Connection storage failed");
        await this.#store.revoke(projectId, now.toISOString());
      } catch (revokeError) {
        throw new AggregateError(
          [error, revokeError],
          `Replacement Connection for Project ${projectId} could not be saved or fully revoked.`,
        );
      }

      throw error;
    }

    return this.#store.connections(projectId, now)[0];
  }

  async revoke(projectId: string, reason: string): Promise<void> {
    const project = this.#store.get(projectId);

    if (project?.shareId === undefined || project.relayUrl === undefined) {
      throw new Error("Project has no published share.");
    }

    const now = this.#now();
    const ownerToken = await this.#identity.createOwnerToken({ projectId, now });
    await this.#client(project.relayUrl).revoke(projectId, ownerToken, reason);
    await this.#store.revoke(projectId, now.toISOString());
  }
}

function checkedRelayUrl(input: string): string {
  const url = new URL(input);

  if (
    url.username !== "" ||
    url.password !== "" ||
    url.hash !== "" ||
    (url.protocol !== "https:" &&
      !(url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname)))
  ) {
    throw new Error("Relay URL must use HTTPS or local HTTP without embedded credentials.");
  }

  return url.origin;
}
