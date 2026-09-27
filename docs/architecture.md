# Architecture and technology stack

## Product architecture

Wist is a local-first, assistant-independent continuity hub with a narrow hosted relay:

```text
npx wist-cli -> local daemon -> Passport core + local store
                              |       |-> local dashboard on 127.0.0.1
                              |       +-> local keypair identity
                              |
                              +-> signed scoped share -> hosted relay + connector API
                                                        |
                                                        +-> Destination Assistant -> Runtime
```

- The **local daemon** is the install entrypoint, local API, key custodian, and dashboard server.
- A **source adapter** turns explicitly selected Project evidence into a typed draft. Codex is first.
- The **Passport core** validates contracts, enforces lifecycle and sharing policy, excludes secrets,
  produces compact views, and derives Setup Plans from Capability declarations and Runtime evidence.
- The **hosted relay** stores only explicitly approved scoped shares plus the public-key, expiry, and
  revocation metadata needed to authorize retrieval.
- The **connector API** exposes assistant-neutral retrieval use cases over authenticated HTTPS.
- A **destination adapter** maps one assistant's connector model onto that interface. Muse is first.
- A **Runtime** establishes its own Connections and reports evidence; credentials never cross the core contract.

Adding another personal assistant means adding an adapter or protocol mapping, not changing Project,
Handoff, Capability, Runtime, Connection, or Setup Plan.

## How the promise is executed

1. **Install:** `npx wist-cli` starts a daemon bound to `127.0.0.1`, creates a keypair on first
   run, and opens the local dashboard. There is no sign-up or account.
2. **Capture:** the Source Agent CLI reads only the selected repository and agent-authored handoff
   inputs, then validates a draft against the versioned domain schemas.
3. **Preview:** the local dashboard shows exactly what context and Capability declarations will be shared.
4. **Publish:** approval creates an immutable Handoff version and uploads only its scoped payload to
   the relay under a signed, expiring, revocable capability token.
5. **Retrieve:** Muse presents the capability token as proof of its Connection, gets the compact
   Project brief and current Handoff, and follows handles only when deeper context is needed.
6. **Prepare:** deterministic code compares declared Capabilities with evidence reported by the Runtime
   and returns a declarative Setup Plan. It never assumes installation or authorization succeeded.
7. **Authorize:** the person completes destination-side provider flows; Wist records status,
   scope, storage mode, freshness, and revocation evidence, never the credential.
8. **Continue:** the destination launches the selected coding agent with the approved Handoff and
   retrieves more context on demand.

## MVP module seams

The MVP keeps three deep modules and thin adapters:

- `packages/domain`: versioned schemas, lifecycle rules, compact views, and deterministic Setup Plan
  inspection. This is the portable contract and has no framework, persistence, or Muse dependency.
- `apps/cli`: the install entrypoint, local daemon, local identity and storage owner, and first source
  adapter. It serves the local dashboard and performs capture, validation, approval, publication,
  revocation, and local retrieval.
- `apps/api`: the hosted relay and connector use-case module. Its Hono interface validates signed
  capability tokens, retrieves only scoped shared payloads, accepts readiness evidence, and revokes
  shares. Cloudflare D1 is its persistence seam.

The UI branch owns two account-free surfaces: a public landing page whose primary action is the
install command, and the dashboard bundle served by the local daemon. `packages/sdk`, MCP delivery,
and additional destination adapters are added only when a second real caller makes those seams concrete.

## Identity and sharing

The first-run keypair is the person's MVP identity. The private key stays on the local Runtime; the
relay knows only the public key and signed proofs. Possession of the computer is the local login, so
the dashboard binds only to loopback and has no account session.

A capability token authorizes one Connection to one explicitly shared scope. It is signed, expiring,
and revocable. The token never becomes a Handoff, Capability field, or destination credential. Losing
the local key and using a second computer are deliberate MVP tradeoffs recorded in ADR-0003;
account-based recovery and multi-device identity are deferred.

The MVP identity uses an Ed25519 keypair protected by macOS Keychain. Its relay identity is the
thumbprint of the public JWK. Short-lived owner proofs authorize Project publication and revocation;
separate read-only Connection tokens authorize destination retrieval. Both use typed JOSE envelopes,
but the relay persists only the token identifier and authorization facts—not the raw token. A valid
signature never bypasses the D1 scope, expiry, share-expiry, or revocation checks.

The **Connect Muse** artifact is a Connection URL shaped like
`https://<relay>/connect#token=<capability-token>`; Muse parses the fragment and presents the token to
the connector API. The local dashboard offers that URL as the primary copy action and the same bare
token as a manual fallback. It keeps an active token masked but retrievable until expiry or revocation,
rather than displaying it only once. A Connection token expires after 24 hours by default and can
never outlive its underlying share or Handoff. The relay cannot mint or attenuate tokens; only the
local daemon can sign a replacement or a shorter-lived token for the same share.

## Fastest execution path

1. **Local bootstrap:** one install command creates the local identity, starts the loopback daemon,
   opens the dashboard, and completes capture -> preview -> approval locally.
2. **Capability relay:** publish one approved scoped payload to the Hono Worker backed by D1, then
   prove expiry and immediate revocation through the connector API.
3. **Destination proof:** a Muse custom connector calls that same interface. Run the live Runtime,
   installation, authorization, persistence, and revocation probes before claiming readiness.
4. **Expansion:** add optional key recovery or multi-device identity, MCP, SDK packaging, additional
   measured Jev judgments, and more Destination Assistant adapters without changing the core contract.

## Stack

- **Language:** strict TypeScript across web, API, CLI, contracts, and tests
- **Workspace:** pnpm workspaces with Turborepo
- **Web:** a public static landing page plus a React dashboard bundle served by the local daemon
- **Styling:** Tailwind CSS with accessible headless primitives
- **Motion:** Motion for React plus CSS and SVG; Rive may be evaluated for one branded interactive asset
- **Connector API:** Hono on Cloudflare Workers
- **Contracts:** Zod as the runtime source of truth, inferred TypeScript types, and generated JSON Schema/OpenAPI
- **Persistence and identity:** a locally protected keypair and local Passport store; Cloudflare D1
  stores only hosted relay shares and their authorization metadata
- **CLI:** Node.js TypeScript install entrypoint, loopback daemon, guided commands, and local UI host
- **Agent surface:** authenticated HTTPS/OpenAPI first; official Model Context Protocol TypeScript SDK as a later adapter
- **Semantic judgments:** TypeSafe's JavaScript SDK, called only from trusted server-side code
- **Testing:** Vitest for modules and contracts; Playwright for critical browser journeys
- **Quality:** Oxlint with vendored Anti-Slop for lint policy, Biome for formatting only, strict compiler options, dependency boundaries, and CI checks
- **Hosting:** a static public landing page plus Cloudflare Workers and D1 for the relay and connector API

Dependency versions belong in lockfiles and package manifests, not this document. Scaffolding should select current stable releases and pin them through the lockfile.

## Planned module layout

```text
apps/
  web/             public landing page and local dashboard bundle
  api/             hosted relay, connector API, and D1 adapter
  cli/             install entrypoint, local daemon, identity, storage, and source adapter
packages/
  domain/          versioned schemas, invariants, and domain operations
  fixtures/        representative passport and handoff states for UI and tests
  ui/              design tokens and reusable UI modules
  intelligence/    optional evaluated Jev questions and deterministic composition
  sdk/             typed client added when a second real caller needs it
d1/
  migrations/      relay shares, public identities, expiry, and revocation records
```

## Retrieval use cases

The domain module owns meaning and validation. Web, HTTP, CLI, persistence, MCP, and
assistant-specific code are adapters around its seam.

The connector API exposes a small set of use cases rather than raw database records:

- list authorized Projects
- retrieve a compact Project brief
- retrieve the current Handoff
- retrieve a Setup Plan
- report Runtime readiness
- revoke a Project share

Context search is added after compact brief, Handoff, and handle-based retrieval prove insufficient.

Persistence schemas and assistant-specific payloads must not become the domain interface.

## Jev boundary

Jev may classify candidate context, score relevance, detect semantic sensitivity, judge Capability portability, and identify conflicting or stale claims. Code performs candidate discovery, authorization, secret exclusion, schema validation, threshold policy, persistence, and all side effects.

Jev is expected to be strategically important to capture quality, but it does not control transport,
authorization, policy, publication, or side effects. The local slice exposes a pre-publication pilot
for relevance, sensitivity, portability, conflict, and staleness judgments using a pinned model.
Assessment failure is explicit and never prevents the deterministic workflow. Retain each judgment
only where representative evaluations show a material improvement over the baseline.

Jev is text-only and does not generate visual assets, layouts, prose, or animations. UI personalization using Jev is deferred until a concrete user decision benefits from a typed judgment.

## Visual asset boundary

The MVP uses browser-native motion, SVG, and CSS. If the brand direction proves that a 3D passport object materially improves the experience, Blender may author a compressed glTF asset consumed by the web application. Blender is an asset tool, not a Runtime dependency.
