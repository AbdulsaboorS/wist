import { randomUUID } from "node:crypto";
import process from "node:process";

import { AsyncEntry } from "@napi-rs/keyring";
import {
  Ed25519PublicKeySchema,
  type DestinationAccessScope,
  type Ed25519PublicKey,
  type IdentityRegistrationRequest,
} from "@wist/api";
import { SignJWT, calculateJwkThumbprint, exportJWK, generateKeyPair, importJWK } from "jose";

const RELAY_AUDIENCE = "wist-relay";

const OWNER_TOKEN_LIFETIME_SECONDS = 5 * 60;

const CONNECTION_TOKEN_LIFETIME_SECONDS = 24 * 60 * 60;

const IDENTITY_KEYCHAIN_SERVICE = "dev.wist.identity";

const IDENTITY_KEYCHAIN_ACCOUNT = "default-ed25519-v1";

type Ed25519PrivateKey = Ed25519PublicKey & {
  readonly d: string;
};

type UnsignedTokenClaims =
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

const Ed25519PrivateKeySchema = Ed25519PublicKeySchema.extend({
  d: Ed25519PublicKeySchema.shape.x,
});

export type LocalIdentity = {
  readonly id: string;
  readonly publicKey: Ed25519PublicKey;
};

export type IdentityRegistration = IdentityRegistrationRequest;

export type ConnectionToken = {
  readonly connectionId: string;
  readonly issuedAt?: string;
  readonly expiresAt: string;
  readonly shareId: string;
  readonly token: string;
  readonly tokenId: string;
  readonly scopes: readonly DestinationAccessScope[];
};

export interface IdentitySecretStore {
  read(): Promise<Uint8Array | undefined>;
  write(secret: Uint8Array): Promise<void>;
}

export class InMemoryIdentitySecretStore implements IdentitySecretStore {
  #secret: Uint8Array | undefined;

  constructor(secret?: Uint8Array) {
    this.#secret = secret?.slice();
  }

  async read(): Promise<Uint8Array | undefined> {
    return this.#secret?.slice();
  }

  async write(secret: Uint8Array): Promise<void> {
    this.#secret = secret.slice();
  }
}

export class MacOsKeychainIdentitySecretStore implements IdentitySecretStore {
  readonly #entry: AsyncEntry;

  constructor(options: { service?: string; account?: string } = {}) {
    if (process.platform !== "darwin") {
      throw new Error("Protected identity storage currently requires macOS Keychain.");
    }

    this.#entry = new AsyncEntry(
      options.service ?? IDENTITY_KEYCHAIN_SERVICE,
      options.account ?? IDENTITY_KEYCHAIN_ACCOUNT,
    );
  }

  async read(): Promise<Uint8Array | undefined> {
    const secret = await this.#entry.getSecret();

    // The native macOS binding currently returns null/number[] despite its Uint8Array typings.
    return secret === undefined || secret === null ? undefined : Uint8Array.from(secret);
  }

  async write(secret: Uint8Array): Promise<void> {
    await this.#entry.setSecret(secret);
  }
}

export class LocalIdentityManager {
  readonly #store: IdentitySecretStore;
  #privateKeyPromise: Promise<Ed25519PrivateKey> | undefined;

  constructor(store: IdentitySecretStore) {
    this.#store = store;
  }

  async getIdentity(): Promise<LocalIdentity> {
    const privateKey = await this.#privateKey();
    const publicKey = publicPart(privateKey);

    return {
      id: await calculateJwkThumbprint(publicKey, "sha256"),
      publicKey,
    };
  }

  async createRegistration(now: Date): Promise<IdentityRegistration> {
    const identity = await this.getIdentity();

    const proof = await this.#sign(
      {
        kind: "identity",
        version: 1,
      },
      {
        subject: identity.id,
        type: "wist-identity+jwt",
        now,
        expiresAt: addSeconds(now, OWNER_TOKEN_LIFETIME_SECONDS),
      },
    );

    return { identityId: identity.id, publicKey: identity.publicKey, proof };
  }

  async createOwnerToken(options: { projectId: string; now: Date }): Promise<string> {
    return await this.#sign(
      {
        kind: "owner",
        version: 1,
        projectId: options.projectId,
        scope: ["project:write"],
      },
      {
        subject: options.projectId,
        type: "wist-owner+jwt",
        now: options.now,
        expiresAt: addSeconds(options.now, OWNER_TOKEN_LIFETIME_SECONDS),
      },
    );
  }

  async createConnection(options: {
    shareId: string;
    projectId: string;
    scopes: readonly DestinationAccessScope[];
    now: Date;
    shareExpiresAt: string;
    lifetimeSeconds?: number;
  }): Promise<ConnectionToken> {
    const lifetime = options.lifetimeSeconds ?? CONNECTION_TOKEN_LIFETIME_SECONDS;

    if (
      !Number.isInteger(lifetime) ||
      lifetime < 1 ||
      lifetime > CONNECTION_TOKEN_LIFETIME_SECONDS
    ) {
      throw new Error("Connection lifetime must be between 1 second and 24 hours.");
    }

    const latestExpiry = addSeconds(options.now, lifetime);
    const shareExpiry = new Date(options.shareExpiresAt);

    if (!Number.isFinite(shareExpiry.getTime()) || shareExpiry <= options.now) {
      throw new Error("A Connection requires an unexpired share.");
    }

    const expiresAt = shareExpiry < latestExpiry ? shareExpiry : latestExpiry;
    const connectionId = randomUUID();
    const tokenId = randomUUID();

    const token = await this.#sign(
      {
        kind: "connection",
        version: 1,
        connectionId,
        projectId: options.projectId,
        shareId: options.shareId,
        scope: [...options.scopes],
      },
      {
        subject: options.shareId,
        type: "wist-connection+jwt",
        tokenId,
        now: options.now,
        expiresAt,
      },
    );

    return {
      connectionId,
      issuedAt: options.now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      shareId: options.shareId,
      token,
      tokenId,
      scopes: [...options.scopes],
    };
  }

  async #sign(
    claims: UnsignedTokenClaims,
    options: {
      subject: string;
      type: string;
      tokenId?: string;
      now: Date;
      expiresAt: Date;
    },
  ): Promise<string> {
    const identity = await this.getIdentity();
    const privateKey = await importJWK(await this.#privateKey(), "EdDSA");

    return await new SignJWT(claims)
      .setProtectedHeader({ alg: "EdDSA", kid: identity.id, typ: options.type })
      .setIssuer(identity.id)
      .setAudience(RELAY_AUDIENCE)
      .setSubject(options.subject)
      .setJti(options.tokenId ?? randomUUID())
      .setIssuedAt(toEpochSeconds(options.now))
      .setExpirationTime(toEpochSeconds(options.expiresAt))
      .sign(privateKey);
  }

  #privateKey(): Promise<Ed25519PrivateKey> {
    this.#privateKeyPromise ??= this.#loadOrCreatePrivateKey();

    return this.#privateKeyPromise;
  }

  async #loadOrCreatePrivateKey(): Promise<Ed25519PrivateKey> {
    const stored = await this.#store.read();

    if (stored !== undefined) {
      return parsePrivateKey(stored);
    }

    const generated = await generateKeyPair("Ed25519", { extractable: true });
    const privateKey = Ed25519PrivateKeySchema.parse(await exportJWK(generated.privateKey));
    await this.#store.write(new TextEncoder().encode(JSON.stringify(privateKey)));

    return privateKey;
  }
}

function parsePrivateKey(secret: Uint8Array): Ed25519PrivateKey {
  try {
    return Ed25519PrivateKeySchema.parse(JSON.parse(new TextDecoder().decode(secret)));
  } catch {
    throw new Error("The stored identity is invalid; refusing to replace it automatically.");
  }
}

function publicPart(privateKey: Ed25519PrivateKey): Ed25519PublicKey {
  return { crv: privateKey.crv, kty: privateKey.kty, x: privateKey.x };
}

function addSeconds(date: Date, seconds: number): Date {
  return new Date(date.getTime() + seconds * 1_000);
}

function toEpochSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1_000);
}
