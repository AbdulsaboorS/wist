import {
  calculateJwkThumbprint,
  decodeJwt,
  decodeProtectedHeader,
  errors as joseErrors,
  importJWK,
  jwtVerify,
  type CryptoKey,
} from "jose";
import { z } from "zod";

import {
  ConnectionTokenClaimsSchema,
  Ed25519PublicKeySchema,
  IdentityTokenClaimsSchema,
  OwnerTokenClaimsSchema,
  type AccessScope,
  type ConnectionTokenClaims,
  type IdentityRegistrationRequest,
} from "./contracts.js";
import { PassportServiceError } from "./service.js";
import type { PassportStore, StoredConnectionGrant } from "./store.js";

const RELAY_AUDIENCE = "wist-relay";

const MAX_CONNECTION_SECONDS = 24 * 60 * 60;

const TokenLocatorSchema = z.object({ jti: z.string().min(1) }).passthrough();

type TokenLocator = z.infer<typeof TokenLocatorSchema>;

export type OwnerAuthorization = {
  readonly identityId: string;
  readonly projectId: string;
};

export type ConnectionAuthorization = {
  readonly identityId: string;
  readonly projectId: string;
  readonly shareId: string;
};

export class RelayAuthorizer {
  readonly #store: PassportStore;
  readonly #now: () => Date;

  constructor(options: { store: PassportStore; now?: () => Date }) {
    this.#store = options.store;
    this.#now = options.now ?? (() => new Date());
  }

  async registerIdentity(input: IdentityRegistrationRequest): Promise<void> {
    const publicKey = Ed25519PublicKeySchema.parse(input.publicKey);
    const identityId = await calculateJwkThumbprint(publicKey, "sha256");

    if (identityId !== input.identityId) {
      throw new PassportServiceError("invalid", "Identity does not match its public key.");
    }

    const header = this.#protectedHeader(input.proof, "wist-identity+jwt");

    if (header.kid !== identityId) {
      throw new PassportServiceError("invalid", "Identity proof names a different key.");
    }

    const key = await importJWK(publicKey, "EdDSA");

    const { payload } = await this.#verify(input.proof, key, {
      issuer: identityId,
      subject: identityId,
    });

    IdentityTokenClaimsSchema.parse(payload);
    await this.#store.registerIdentity({
      id: identityId,
      publicKey,
      createdAt: this.#now().toISOString(),
    });
  }

  async authorizeOwner(token: string, projectId: string): Promise<OwnerAuthorization> {
    const header = this.#protectedHeader(token, "wist-owner+jwt");
    const identityId = this.#requiredKeyId(header.kid);
    const identity = await this.#store.getIdentity(identityId);

    if (identity === undefined) {
      throw new PassportServiceError("unauthorized", "The signing identity is not registered.");
    }

    const key = await importJWK(identity.publicKey, "EdDSA");

    const { payload } = await this.#verify(token, key, {
      issuer: identityId,
      subject: projectId,
    });

    const claims = OwnerTokenClaimsSchema.parse(payload);

    if (claims.projectId !== projectId) {
      throw new PassportServiceError("forbidden", "Owner proof names a different Project.");
    }

    return { identityId, projectId };
  }

  async connectionForPublish(
    token: string,
    expected: {
      identityId: string;
      projectId: string;
      shareId: string;
      shareExpiresAt: string;
    },
  ): Promise<StoredConnectionGrant> {
    const header = this.#protectedHeader(token, "wist-connection+jwt");

    if (header.kid !== expected.identityId) {
      throw new PassportServiceError("forbidden", "Connection was signed by another identity.");
    }

    const identity = await this.#store.getIdentity(expected.identityId);

    if (identity === undefined) {
      throw new PassportServiceError("unauthorized", "The signing identity is not registered.");
    }

    const key = await importJWK(identity.publicKey, "EdDSA");

    const { payload } = await this.#verify(token, key, {
      issuer: expected.identityId,
      subject: expected.shareId,
    });

    const claims = ConnectionTokenClaimsSchema.parse(payload);

    if (claims.projectId !== expected.projectId || claims.shareId !== expected.shareId) {
      throw new PassportServiceError("forbidden", "Connection names a different share.");
    }

    const connectionExpiresAt = new Date(claims.exp * 1_000);

    if (connectionExpiresAt.getTime() > Date.parse(expected.shareExpiresAt)) {
      throw new PassportServiceError(
        "invalid",
        "Connection cannot outlive its underlying Handoff.",
      );
    }

    if (claims.exp - claims.iat > MAX_CONNECTION_SECONDS) {
      throw new PassportServiceError("invalid", "Connection cannot last longer than 24 hours.");
    }

    return this.#storedGrant(expected.identityId, claims);
  }

  async authorizeConnection(
    token: string,
    requiredScope: Exclude<AccessScope, "project:write">,
    projectId?: string,
  ): Promise<ConnectionAuthorization> {
    this.#protectedHeader(token, "wist-connection+jwt");
    const untrusted = this.#decodedClaims(token);
    const record = await this.#store.getAuthorization(untrusted.jti);

    if (record === undefined) {
      throw new PassportServiceError("unauthorized", "The Connection is not recognized.");
    }

    if (record.grant.revokedAt !== undefined || record.share.revokedAt !== undefined) {
      throw new PassportServiceError("revoked", "The Connection has been revoked.");
    }

    const now = this.#now().getTime();

    if (Date.parse(record.grant.expiresAt) <= now || Date.parse(record.share.expiresAt) <= now) {
      throw new PassportServiceError("expired", "The Connection has expired.");
    }

    const key = await importJWK(record.identity.publicKey, "EdDSA");

    const { payload, protectedHeader } = await this.#verify(token, key, {
      issuer: record.identity.id,
      subject: record.share.id,
    });

    const claims = ConnectionTokenClaimsSchema.parse(payload);

    if (protectedHeader.kid !== record.identity.id || !matchesRecord(claims, record.grant)) {
      throw new PassportServiceError("unauthorized", "Connection claims do not match the relay.");
    }

    if (!claims.scope.includes(requiredScope)) {
      throw new PassportServiceError("forbidden", "The Connection lacks the required scope.");
    }

    if (projectId !== undefined && claims.projectId !== projectId) {
      throw new PassportServiceError("forbidden", "The Connection cannot access this Project.");
    }

    return {
      identityId: record.identity.id,
      projectId: claims.projectId,
      shareId: claims.shareId,
    };
  }

  #protectedHeader(token: string, expectedType: string) {
    try {
      const header = decodeProtectedHeader(token);

      if (header.alg !== "EdDSA" || header.typ !== expectedType) {
        throw new Error("Unexpected token header.");
      }

      return header;
    } catch {
      throw new PassportServiceError("unauthorized", "The signed token is malformed.");
    }
  }

  #decodedClaims(token: string): TokenLocator {
    try {
      return TokenLocatorSchema.parse(decodeJwt(token));
    } catch {
      throw new PassportServiceError("unauthorized", "The signed token is malformed.");
    }
  }

  #requiredKeyId(keyId: string | undefined): string {
    if (keyId === undefined || keyId.length === 0) {
      throw new PassportServiceError("unauthorized", "The signed token has no key identifier.");
    }

    return keyId;
  }

  async #verify(
    token: string,
    key: CryptoKey | Uint8Array,
    expected: { issuer: string; subject: string },
  ) {
    try {
      return await jwtVerify(token, key, {
        algorithms: ["EdDSA"],
        audience: RELAY_AUDIENCE,
        issuer: expected.issuer,
        subject: expected.subject,
        currentDate: this.#now(),
      });
    } catch (error) {
      if (error instanceof joseErrors.JWTExpired) {
        throw new PassportServiceError("expired", "The signed token has expired.");
      }

      throw new PassportServiceError("unauthorized", "The signed token is invalid.");
    }
  }

  #storedGrant(identityId: string, claims: ConnectionTokenClaims): StoredConnectionGrant {
    return {
      tokenId: claims.jti,
      connectionId: claims.connectionId,
      identityId,
      shareId: claims.shareId,
      projectId: claims.projectId,
      scopes: claims.scope,
      issuedAt: new Date(claims.iat * 1_000).toISOString(),
      expiresAt: new Date(claims.exp * 1_000).toISOString(),
    };
  }
}

function matchesRecord(claims: ConnectionTokenClaims, grant: StoredConnectionGrant): boolean {
  return (
    claims.jti === grant.tokenId &&
    claims.connectionId === grant.connectionId &&
    claims.iss === grant.identityId &&
    claims.shareId === grant.shareId &&
    claims.projectId === grant.projectId &&
    new Date(claims.iat * 1_000).toISOString() === grant.issuedAt &&
    new Date(claims.exp * 1_000).toISOString() === grant.expiresAt &&
    JSON.stringify(claims.scope) === JSON.stringify(grant.scopes)
  );
}
