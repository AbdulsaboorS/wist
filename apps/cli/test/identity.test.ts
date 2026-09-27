import { decodeJwt, decodeProtectedHeader, jwtVerify } from "jose";
import { describe, expect, it } from "vitest";

import { InMemoryIdentitySecretStore, LocalIdentityManager } from "../src/index.js";

const now = new Date("2026-09-21T00:00:00.000Z");

describe("local identity", () => {
  it("keeps one private identity in protected storage and mints separate owner and Connection authority", async () => {
    const secrets = new InMemoryIdentitySecretStore();
    const firstProcess = new LocalIdentityManager(secrets);
    const identity = await firstProcess.getIdentity();
    const secondProcess = new LocalIdentityManager(secrets);

    await expect(secondProcess.getIdentity()).resolves.toEqual(identity);

    const registration = await firstProcess.createRegistration(now);

    const ownerToken = await firstProcess.createOwnerToken({
      projectId: "01992222-2222-7222-8222-222222222222",
      now,
    });

    const connection = await firstProcess.createConnection({
      shareId: "01993333-3333-7333-8333-333333333333",
      projectId: "01992222-2222-7222-8222-222222222222",
      scopes: ["project:read", "handoff:read"],
      now,
      shareExpiresAt: "2026-09-23T00:00:00.000Z",
    });

    expect(registration.identityId).toBe(identity.id);
    expect(decodeProtectedHeader(registration.proof)).toMatchObject({
      alg: "EdDSA",
      kid: identity.id,
      typ: "wist-identity+jwt",
    });
    expect(decodeJwt(ownerToken)).toMatchObject({
      kind: "owner",
      scope: ["project:write"],
      projectId: "01992222-2222-7222-8222-222222222222",
    });
    expect(decodeJwt(connection.token)).toMatchObject({
      kind: "connection",
      scope: ["project:read", "handoff:read"],
      projectId: "01992222-2222-7222-8222-222222222222",
      shareId: "01993333-3333-7333-8333-333333333333",
    });
    expect(connection.expiresAt).toBe("2026-09-22T00:00:00.000Z");

    const publicKey = await crypto.subtle.importKey("jwk", identity.publicKey, "Ed25519", false, [
      "verify",
    ]);

    await expect(
      jwtVerify(connection.token, publicKey, {
        algorithms: ["EdDSA"],
        audience: "wist-relay",
        issuer: identity.id,
        currentDate: now,
      }),
    ).resolves.toMatchObject({ payload: { sub: connection.shareId } });
  });

  it("fails closed when stored private identity material is corrupt", async () => {
    const secrets = new InMemoryIdentitySecretStore(new TextEncoder().encode("not-json"));
    const identity = new LocalIdentityManager(secrets);

    await expect(identity.getIdentity()).rejects.toThrow("stored identity is invalid");
  });
});
