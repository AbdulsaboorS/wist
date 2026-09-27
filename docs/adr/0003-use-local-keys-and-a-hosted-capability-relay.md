# Use local keys and a hosted capability relay instead of accounts

## Context

Cross-machine Handoff retrieval requires authentication, Project scope, expiry, and revocation; it does not require a hosted user account. A hosted dashboard and Supabase Auth would make account creation the front door to a product whose primary value can begin on one computer, while also placing identity and the working Passport farther from the person who owns them.

## Decision

Wist is local-first. `npx wist-cli` starts a daemon bound to `127.0.0.1`, opens the local Passport dashboard, and generates a keypair on first run. Possession of that computer and private key is the MVP identity and login; the private key remains local.

Publishing sends only the approved, scoped payload to a hosted relay. The local identity signs an expiring, revocable capability token for that share. Muse presents that token to the connector API as proof of its Connection. The relay stores the public key, scoped payload, token identifier, expiry, and revocation state, never the private key or destination credentials.

The relay and connector API run as a Hono Cloudflare Worker backed by [Cloudflare D1](https://developers.cloudflare.com/d1/). D1 is selected for its direct [Worker binding](https://developers.cloudflare.com/d1/worker-api/), SQL constraints and indexes over identity, Project, expiry, and revocation records, and small operational footprint—not for bundled authentication. Authorization and revocation checks use the primary database path. Workers KV is excluded because its [eventually consistent reads](https://developers.cloudflare.com/kv/concepts/how-kv-works/) can expose a revoked value for 60 seconds or more; D1 read replicas may be added only with [sequential-consistency sessions](https://developers.cloudflare.com/d1/best-practices/read-replication/).

This replaces Supabase Auth as MVP identity and replaces the hosted Next.js dashboard in `docs/architecture.md`. The public landing page remains hosted and unauthenticated; the Passport dashboard runs locally. It also supersedes the web, identity, and persistence choices in the second paragraph of ADR-0001 while retaining its TypeScript monorepo and portable-contract decision.

## Consequences

- The MVP has no sign-up, account, recovery service, or account session.
- Losing the private key loses the cryptographic identity and its ability to revoke existing shares unless a separate local recovery copy exists. Automated recovery is deferred.
- A second computer begins with a different identity. Secure key transfer, multi-device identity, and an optional recovery/account layer are deferred.
- Device compromise grants local control until the key is removed and outstanding shares are revoked. Local key storage must use operating-system protection where available and fail closed rather than exporting the key into Passport data.
- Loopback binding is not an authentication boundary because another web page can target the daemon
  through CSRF or DNS rebinding. The daemon must enforce strict `Host` and `Origin` checks, never
  enable wildcard CORS, and require a high-entropy per-launch local token carried in the dashboard
  URL it opens. The URL fragment is unavailable to the server on the first HTML request, so the
  daemon may serve only the inert, packaged dashboard shell and assets without the token. Every
  local API response containing Passport data or performing an action fails closed when the token
  is absent or invalid; the dashboard removes the fragment before navigation and never embeds
  private data in its static files.
- The relay remains necessary for cross-machine retrieval, expiry, and revocation, but it is not the system of record for the full local Passport.
