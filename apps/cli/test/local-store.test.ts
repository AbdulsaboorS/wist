import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  goldenPathCapabilities,
  handoffFixture,
  museRuntimeFixture,
  projectFixture,
  setupPlanFixture,
} from "@wist/fixtures";
import { afterEach, describe, expect, it } from "vitest";

import { InMemoryConnectionSecretStore, LocalPassportStore, captureDraft } from "../src/index.js";

const capturedAt = "2026-09-21T00:00:00.000Z";

describe("durable local Passport store", () => {
  const directories: string[] = [];
  const stores: LocalPassportStore[] = [];

  afterEach(() => {
    for (const store of stores.splice(0)) {
      store.close();
    }

    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("survives restart, keeps the bearer out of SQLite, and stops reveal after revocation", async () => {
    const directory = mkdtempSync(join(tmpdir(), "wist-local-"));
    directories.push(directory);
    const secrets = new InMemoryConnectionSecretStore();
    const first = LocalPassportStore.open(secrets, directory);
    stores.push(first);

    const draft = captureDraft(
      {
        project: projectFixture,
        handoff: handoffFixture,
        capabilities: [...goldenPathCapabilities],
        runtime: museRuntimeFixture,
        setupPlan: setupPlanFixture,
      },
      { activeBranch: "codex/mvp", revision: "abc123", capturedAt },
    );

    first.saveDraft(draft, "/selected/repository");
    first.approve(projectFixture.id, "2026-09-21T00:05:00.000Z");

    const connection = {
      connectionId: crypto.randomUUID(),
      tokenId: crypto.randomUUID(),
      shareId: crypto.randomUUID(),
      token: "signed-connection-secret",
      expiresAt: "2026-09-22T00:00:00.000Z",
      scopes: ["project:read" as const],
    };

    await first.recordConnection(projectFixture.id, "https://relay.example", connection);

    expect(statSync(join(directory, "passport.sqlite")).mode & 0o077).toBe(0);
    expect(readFileSync(join(directory, "passport.sqlite")).includes(connection.token)).toBe(false);
    first.close();
    stores.splice(stores.indexOf(first), 1);

    const reopened = LocalPassportStore.open(secrets, directory);
    stores.push(reopened);
    expect(reopened.get(projectFixture.id)?.repositoryPath).toBe("/selected/repository");
    expect(reopened.connections(projectFixture.id, new Date(capturedAt))[0]).toMatchObject({
      connectionId: connection.connectionId,
      status: "active",
      maskedToken: "••••••••",
    });
    await expect(
      reopened.reveal(connection.connectionId, new Date(capturedAt)),
    ).resolves.toMatchObject({
      token: connection.token,
    });
    await expect(
      reopened.reveal(connection.connectionId, new Date(connection.expiresAt)),
    ).rejects.toThrow("unavailable");

    await reopened.revoke(projectFixture.id, "2026-09-21T01:00:00.000Z");
    expect(reopened.get(projectFixture.id)?.bundle.handoff.status).toBe("revoked");
    await expect(reopened.reveal(connection.connectionId, new Date(capturedAt))).rejects.toThrow(
      "unavailable",
    );
    expect(await secrets.read(connection.connectionId)).toBeUndefined();
  });

  it("refuses a local database readable by other users", () => {
    const directory = mkdtempSync(join(tmpdir(), "wist-local-"));
    directories.push(directory);
    const store = LocalPassportStore.open(new InMemoryConnectionSecretStore(), directory);
    store.close();
    chmodSync(join(directory, "passport.sqlite"), 0o644);

    expect(() => LocalPassportStore.open(new InMemoryConnectionSecretStore(), directory)).toThrow(
      "private regular file",
    );
  });
});
