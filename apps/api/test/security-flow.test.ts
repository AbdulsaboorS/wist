import { projectFixture } from "@wist/fixtures";
import { beforeEach, describe, expect, it } from "vitest";

import { InMemoryPassportStore, PassportService, createPassportApp } from "../src/index.js";
import {
  bearer,
  connectionToken,
  createTestIdentity,
  ownerToken,
  publish,
  registerIdentity,
  type TestIdentity,
} from "./support.js";

describe("signed relay authorization", () => {
  let currentTime: Date;
  let identity: TestIdentity;
  let app: ReturnType<typeof createPassportApp>;

  beforeEach(async () => {
    currentTime = new Date("2026-09-21T00:00:00.000Z");
    identity = await createTestIdentity();
    const store = new InMemoryPassportStore();
    const service = new PassportService({ store, now: () => currentTime });
    app = createPassportApp({ service, store, now: () => currentTime });
  });

  it("registers a public identity and retrieves only its signed, recorded share", async () => {
    expect((await registerIdentity(app, identity, currentTime)).status).toBe(201);
    const connection = await connectionToken(identity, currentTime);
    expect((await publish(app, identity, connection, currentTime)).status).toBe(201);

    const response = await app.request(`/v1/projects/${projectFixture.id}`, {
      headers: bearer(connection),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ id: projectFixture.id });
  });

  it("rejects altered signatures and missing scopes", async () => {
    expect((await registerIdentity(app, identity, currentTime)).status).toBe(201);
    const connection = await connectionToken(identity, currentTime, { scopes: ["project:read"] });
    expect((await publish(app, identity, connection, currentTime)).status).toBe(201);

    const segments = connection.split(".");
    const signature = segments[2];

    if (segments.length !== 3 || signature === undefined || signature.length === 0) {
      throw new Error("Expected a compact signed token.");
    }

    segments[2] = `${signature.startsWith("a") ? "b" : "a"}${signature.slice(1)}`;

    const tamperedResponse = await app.request(`/v1/projects/${projectFixture.id}`, {
      headers: bearer(segments.join(".")),
    });

    const wrongScopeResponse = await app.request(`/v1/projects/${projectFixture.id}/handoff`, {
      headers: bearer(connection),
    });

    expect(tamperedResponse.status).toBe(401);
    expect(wrongScopeResponse.status).toBe(403);
  });

  it("rejects expiry and replay immediately after owner revocation", async () => {
    expect((await registerIdentity(app, identity, currentTime)).status).toBe(201);
    const expiresAt = new Date(currentTime.getTime() + 60_000);
    const connection = await connectionToken(identity, currentTime, { expiresAt });
    expect((await publish(app, identity, connection, currentTime)).status).toBe(201);

    currentTime = new Date(expiresAt.getTime() + 1);

    const expired = await app.request(`/v1/projects/${projectFixture.id}`, {
      headers: bearer(connection),
    });

    expect(expired.status).toBe(410);

    currentTime = new Date("2026-09-21T00:00:30.000Z");

    const revoke = await app.request(`/v1/projects/${projectFixture.id}/revoke`, {
      method: "POST",
      headers: bearer(await ownerToken(identity, currentTime)),
      body: JSON.stringify({ reason: "No longer needed" }),
    });

    expect(revoke.status).toBe(204);

    const replay = await app.request(`/v1/projects/${projectFixture.id}`, {
      headers: bearer(connection),
    });

    expect(replay.status).toBe(410);
  });

  it("requires owner authority and cannot broaden scope during replacement", async () => {
    await registerIdentity(app, identity, currentTime);
    const old = await connectionToken(identity, currentTime, { scopes: ["project:read"] });
    await publish(app, identity, old, currentTime);

    const replacement = await connectionToken(identity, currentTime, {
      tokenId: crypto.randomUUID(),
      connectionId: crypto.randomUUID(),
      scopes: ["project:read", "handoff:read"],
    });

    const path = `/v1/projects/${projectFixture.id}/connections`;

    const body = JSON.stringify({
      oldTokenId: "01995555-5555-7555-8555-555555555555",
      connectionToken: replacement,
      scopes: ["project:read", "handoff:read"],
    });

    expect((await app.request(path, { method: "POST", headers: bearer(old), body })).status).toBe(
      401,
    );
    expect(
      (
        await app.request(path, {
          method: "POST",
          headers: bearer(await ownerToken(identity, currentTime)),
          body,
        })
      ).status,
    ).toBe(403);
    expect(
      (await app.request(`/v1/projects/${projectFixture.id}`, { headers: bearer(old) })).status,
    ).toBe(200);
  });
});
