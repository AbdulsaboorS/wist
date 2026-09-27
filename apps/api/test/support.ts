import {
  goldenPathCapabilities,
  handoffFixture,
  museRuntimeFixture,
  projectFixture,
  setupPlanFixture,
} from "@wist/fixtures";
import {
  SignJWT,
  calculateJwkThumbprint,
  exportJWK,
  generateKeyPair,
  type CryptoKey,
  type JWK,
} from "jose";

import {
  createPassportApp,
  type DestinationAccessScope,
  type PassportBundle,
} from "../src/index.js";

export const bundle: PassportBundle = {
  project: projectFixture,
  handoff: handoffFixture,
  capabilities: [...goldenPathCapabilities],
  runtime: museRuntimeFixture,
  setupPlan: setupPlanFixture,
};

export const shareId = "01993333-3333-7333-8333-333333333333";

const connectionId = "01994444-4444-7444-8444-444444444444";

const connectionTokenId = "01995555-5555-7555-8555-555555555555";

export type TestIdentity = {
  id: string;
  privateKey: CryptoKey;
  publicKey: JWK;
};

type TestTokenClaims =
  | { readonly kind: "identity"; readonly version: 1 }
  | {
      readonly kind: "owner";
      readonly version: 1;
      readonly projectId: string;
      readonly scope: readonly ["project:write"];
    }
  | {
      readonly kind: "connection";
      readonly version: 1;
      readonly connectionId: string;
      readonly projectId: string;
      readonly shareId: string;
      readonly scope: readonly DestinationAccessScope[];
    };

export async function createTestIdentity(): Promise<TestIdentity> {
  const keys = await generateKeyPair("Ed25519", { extractable: true });
  const publicKey = await exportJWK(keys.publicKey);

  return {
    id: await calculateJwkThumbprint(publicKey, "sha256"),
    privateKey: keys.privateKey,
    publicKey,
  };
}

async function sign(
  identity: TestIdentity,
  options: {
    type: string;
    subject: string;
    tokenId: string;
    issuedAt: Date;
    expiresAt: Date;
    claims: TestTokenClaims;
  },
): Promise<string> {
  return await new SignJWT(options.claims)
    .setProtectedHeader({ alg: "EdDSA", kid: identity.id, typ: options.type })
    .setIssuer(identity.id)
    .setAudience("wist-relay")
    .setSubject(options.subject)
    .setJti(options.tokenId)
    .setIssuedAt(Math.floor(options.issuedAt.getTime() / 1_000))
    .setExpirationTime(Math.floor(options.expiresAt.getTime() / 1_000))
    .sign(identity.privateKey);
}

export async function registerIdentity(
  app: ReturnType<typeof createPassportApp>,
  identity: TestIdentity,
  now: Date,
): Promise<Response> {
  const proof = await sign(identity, {
    type: "wist-identity+jwt",
    subject: identity.id,
    tokenId: crypto.randomUUID(),
    issuedAt: now,
    expiresAt: new Date(now.getTime() + 5 * 60_000),
    claims: { kind: "identity", version: 1 },
  });

  return await app.request("/v1/identities", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identityId: identity.id, publicKey: identity.publicKey, proof }),
  });
}

export async function ownerToken(identity: TestIdentity, now: Date): Promise<string> {
  return await sign(identity, {
    type: "wist-owner+jwt",
    subject: projectFixture.id,
    tokenId: crypto.randomUUID(),
    issuedAt: now,
    expiresAt: new Date(now.getTime() + 5 * 60_000),
    claims: {
      kind: "owner",
      version: 1,
      projectId: projectFixture.id,
      scope: ["project:write"],
    },
  });
}

export async function connectionToken(
  identity: TestIdentity,
  now: Date,
  options: {
    scopes?: DestinationAccessScope[];
    expiresAt?: Date;
    tokenId?: string;
    connectionId?: string;
    shareId?: string;
  } = {},
): Promise<string> {
  return await sign(identity, {
    type: "wist-connection+jwt",
    subject: options.shareId ?? shareId,
    tokenId: options.tokenId ?? connectionTokenId,
    issuedAt: now,
    expiresAt: options.expiresAt ?? new Date(now.getTime() + 24 * 60 * 60_000),
    claims: {
      kind: "connection",
      version: 1,
      connectionId: options.connectionId ?? connectionId,
      projectId: projectFixture.id,
      shareId: options.shareId ?? shareId,
      scope: options.scopes ?? [
        "project:read",
        "handoff:read",
        "setup-plan:read",
        "readiness:write",
      ],
    },
  });
}

export function bearer(token: string) {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

export async function publish(
  app: ReturnType<typeof createPassportApp>,
  identity: TestIdentity,
  token: string,
  now: Date,
  publishedShareId = shareId,
): Promise<Response> {
  return await app.request(`/v1/projects/${projectFixture.id}/publish`, {
    method: "POST",
    headers: bearer(await ownerToken(identity, now)),
    body: JSON.stringify({
      bundle,
      approved: true,
      shareId: publishedShareId,
      connectionToken: token,
    }),
  });
}
