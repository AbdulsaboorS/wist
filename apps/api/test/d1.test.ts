import { readdir, readFile } from "node:fs/promises";
import { URL as NodeUrl } from "node:url";

import { museRuntimeFixture, projectFixture } from "@wist/fixtures";
import { Miniflare } from "miniflare";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { D1PassportStore, PassportService, createPassportApp } from "../src/index.js";
import {
  bearer,
  bundle,
  connectionToken,
  createTestIdentity,
  ownerToken,
  publish,
  registerIdentity,
} from "./support.js";

describe("D1 relay adapter", () => {
  let miniflare: Miniflare;

  const migrate = async (database: D1Database, filter: (name: string) => boolean = () => true) => {
    const migrations = new NodeUrl("../../../d1/migrations/", import.meta.url);
    const names = (await readdir(migrations)).filter((file) => file.endsWith(".sql")).sort();

    for (const name of names.filter(filter)) {
      const migration = await readFile(new NodeUrl(name, migrations), "utf8");

      await database.batch(
        migration
          .split(";")
          .map((statement) => statement.trim())
          .filter((statement) => statement.length > 0)
          .map((statement) => database.prepare(statement)),
      );
    }
  };

  beforeEach(async () => {
    miniflare = new Miniflare({
      modules: true,
      script: "export default { fetch() { return new Response('ok') } }",
      d1Databases: { DB: crypto.randomUUID(), LEGACY: crypto.randomUUID() },
    });
    await migrate(await miniflare.getD1Database("DB"));
  });

  it("migrates live shares and replaced grants into separate share content", async () => {
    const database = await miniflare.getD1Database("LEGACY");
    await migrate(database, (name) => name < "0003");

    await database.batch([
      database.prepare("PRAGMA foreign_keys = ON"),
      database.prepare("INSERT INTO identities VALUES ('i', '{}', 't')"),
      database.prepare(
        "INSERT INTO shares VALUES ('revoked', 'i', 'p1', 'h1', 'e', 'r', '{\"old\":1}', 't')",
      ),
      database.prepare(
        "INSERT INTO shares VALUES ('live', 'i', 'p2', 'h2', 'e', NULL, '{\"live\":1}', 't')",
      ),
      database.prepare(
        "INSERT INTO connection_grants VALUES ('t1', 'c1', 'i', 'revoked', 'p1', '[]', 't', 't', 'r', NULL)",
      ),
      database.prepare(
        "INSERT INTO connection_grants VALUES ('t2', 'c2', 'i', 'revoked', 'p1', '[]', 't', 't', NULL, 't1')",
      ),
    ]);

    await migrate(database, (name) => name >= "0003");

    const bundles = await database
      .prepare("SELECT share_id, bundle_json FROM share_bundles")
      .all<{ share_id: string; bundle_json: string }>();

    expect(bundles.results).toEqual([{ share_id: "live", bundle_json: '{"live":1}' }]);
    expect(
      (await database.prepare("SELECT count(*) AS n FROM connection_grants").first<{ n: number }>())
        ?.n,
    ).toBe(2);
  });

  afterEach(async () => {
    await miniflare.dispose();
  });

  it("persists signed authorization and enforces immediate revocation through the relay", async () => {
    const now = new Date("2026-09-21T00:00:00.000Z");
    const database = await miniflare.getD1Database("DB");
    const store = new D1PassportStore(database);
    const service = new PassportService({ store, now: () => now });
    const app = createPassportApp({ service, store, now: () => now });
    const identity = await createTestIdentity();

    expect((await registerIdentity(app, identity, now)).status).toBe(201);
    const connection = await connectionToken(identity, now);
    expect((await publish(app, identity, connection, now)).status).toBe(201);

    const read = await app.request(`/v1/projects/${projectFixture.id}`, {
      headers: bearer(connection),
    });

    expect(read.status).toBe(200);

    const revoke = await app.request(`/v1/projects/${projectFixture.id}/revoke`, {
      method: "POST",
      headers: bearer(await ownerToken(identity, now)),
      body: JSON.stringify({ reason: "D1 revocation proof" }),
    });

    expect(revoke.status).toBe(204);

    const replay = await app.request(`/v1/projects/${projectFixture.id}`, {
      headers: bearer(connection),
    });

    expect(replay.status).toBe(410);
  });

  it("replaces a grant atomically in D1 and rejects the old token", async () => {
    const now = new Date("2026-09-21T00:00:00.000Z");
    const database = await miniflare.getD1Database("DB");
    const store = new D1PassportStore(database);
    const service = new PassportService({ store, now: () => now });
    const app = createPassportApp({ service, store, now: () => now });
    const identity = await createTestIdentity();
    await registerIdentity(app, identity, now);
    const old = await connectionToken(identity, now);
    await publish(app, identity, old, now);

    const replacement = await connectionToken(identity, now, {
      tokenId: crypto.randomUUID(),
      connectionId: crypto.randomUUID(),
      expiresAt: new Date(now.getTime() + 60_000),
      scopes: ["project:read"],
    });

    const response = await app.request(`/v1/projects/${projectFixture.id}/connections`, {
      method: "POST",
      headers: bearer(await ownerToken(identity, now)),
      body: JSON.stringify({
        oldTokenId: "01995555-5555-7555-8555-555555555555",
        connectionToken: replacement,
        scopes: ["project:read"],
      }),
    });

    expect(response.status).toBe(201);
    expect(
      (await app.request(`/v1/projects/${projectFixture.id}`, { headers: bearer(old) })).status,
    ).toBe(410);
    expect(
      (await app.request(`/v1/projects/${projectFixture.id}`, { headers: bearer(replacement) }))
        .status,
    ).toBe(200);
    expect(
      (
        await app.request(`/v1/projects/${projectFixture.id}/handoff`, {
          headers: bearer(replacement),
        })
      ).status,
    ).toBe(403);
  });

  it("follows the latest approved Handoff, isolates readiness, and supersedes after revocation", async () => {
    const now = new Date("2026-09-21T00:00:00.000Z");
    const database = await miniflare.getD1Database("DB");
    const store = new D1PassportStore(database);
    const service = new PassportService({ store, now: () => now });
    const app = createPassportApp({ service, store, now: () => now });
    const identity = await createTestIdentity();
    await registerIdentity(app, identity, now);
    const first = await connectionToken(identity, now);
    expect((await publish(app, identity, first, now)).status).toBe(201);

    const handoff = async (token: string) =>
      await app.request(`/v1/projects/${projectFixture.id}/handoff`, { headers: bearer(token) });

    const readiness = await app.request(`/v1/projects/${projectFixture.id}/readiness`, {
      method: "POST",
      headers: bearer(first),
      body: JSON.stringify({ ...museRuntimeFixture, name: "Reported by destination" }),
    });

    expect(readiness.status).toBe(200);

    const shared = await store.getShare(projectFixture.id);
    expect(shared?.bundle?.runtime.name).toBe(museRuntimeFixture.name);
    expect((await store.getReadiness(shared?.id ?? ""))?.name).toBe("Reported by destination");

    const version = (goal: string) => {
      const id = crypto.randomUUID();

      return {
        ...bundle,
        handoff: { ...bundle.handoff, id, goal },
        setupPlan: { ...bundle.setupPlan, handoffId: id },
      };
    };

    const next = version("Continue from the second Handoff");
    const nextHandoffId = next.handoff.id;

    const putHandoff = async (value: typeof next) =>
      await app.request(`/v1/projects/${projectFixture.id}/handoff`, {
        method: "PUT",
        headers: bearer(await ownerToken(identity, now)),
        body: JSON.stringify({ bundle: value, approved: true }),
      });

    expect((await putHandoff(next)).status).toBe(200);
    expect((await putHandoff(next)).status).toBe(400);
    await expect((await handoff(first)).json()).resolves.toMatchObject({
      id: nextHandoffId,
      goal: "Continue from the second Handoff",
    });

    await app.request(`/v1/projects/${projectFixture.id}/revoke`, {
      method: "POST",
      headers: bearer(await ownerToken(identity, now)),
      body: JSON.stringify({ reason: "Done with this destination" }),
    });

    expect((await handoff(first)).status).toBe(410);
    expect((await putHandoff(version("After revocation"))).status).toBe(410);

    const revoked = await store.getShare(projectFixture.id);
    expect(revoked?.bundle).toBeUndefined();
    expect(await store.getReadiness(revoked?.id ?? "")).toBeUndefined();

    const reshareId = crypto.randomUUID();

    const second = await connectionToken(identity, now, {
      shareId: reshareId,
      tokenId: crypto.randomUUID(),
      connectionId: crypto.randomUUID(),
    });

    expect((await publish(app, identity, second, now, reshareId)).status).toBe(201);
    expect((await handoff(first)).status).toBe(401);
    expect((await handoff(second)).status).toBe(200);

    const intruder = await createTestIdentity();
    await registerIdentity(app, intruder, now);

    const squat = await connectionToken(intruder, now, {
      shareId: crypto.randomUUID(),
      tokenId: crypto.randomUUID(),
      connectionId: crypto.randomUUID(),
    });

    expect((await publish(app, intruder, squat, now)).status).toBeGreaterThanOrEqual(400);
    expect((await handoff(second)).status).toBe(200);
  });

  it("purges expired share content and readiness without touching live shares", async () => {
    const now = new Date("2026-09-21T00:00:00.000Z");
    const database = await miniflare.getD1Database("DB");
    const store = new D1PassportStore(database);
    const service = new PassportService({ store, now: () => now });
    const app = createPassportApp({ service, store, now: () => now });
    const identity = await createTestIdentity();
    await registerIdentity(app, identity, now);
    const connection = await connectionToken(identity, now);
    await publish(app, identity, connection, now);

    await app.request(`/v1/projects/${projectFixture.id}/readiness`, {
      method: "POST",
      headers: bearer(connection),
      body: JSON.stringify(museRuntimeFixture),
    });

    const share = await store.getShare(projectFixture.id);
    expect(await store.purgeExpired(now.toISOString())).toBe(0);
    expect((await store.getShare(projectFixture.id))?.bundle).toBeDefined();

    expect(await store.purgeExpired(share?.expiresAt ?? "")).toBe(1);
    expect((await store.getShare(projectFixture.id))?.bundle).toBeUndefined();
    expect(await store.getReadiness(share?.id ?? "")).toBeUndefined();
  });
});
