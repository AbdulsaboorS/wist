# Wist

**Your coding agent did the work. Your personal assistant picks it up.**

GitHub connectors give assistants your code. Wist gives them your context: what you're
building, what's done, what was decided and why, what's blocking, and what comes next. You approve
exactly what each assistant sees, and you can take it back at any time.

```sh
npx @wist/cli
```

## How it works

1. **Hand off.** The dashboard lists projects you worked on with Claude Code or Codex. Click
   **Hand off**, and that agent writes a Handoff from a copy of your latest session. It gets no
   tools, so nothing in your project changes.
2. **Approve.** You see exactly what will be shared before anything leaves your computer.
3. **Connect.** Give your assistant a private Connection link. It reads the Handoff and a setup
   plan for the project's tools, then asks you to sign in to each tool on its side.
4. **Update or revoke.** Send newer Handoffs through the same link. Revoke once, and access ends
   immediately.

Muse is the first supported assistant: see [Connect Muse](./docs/connect-muse.md). Any assistant
that can call an HTTPS API with a bearer token can read a Connection the same way.

## Requirements

- macOS, with Node.js 24 or newer
- Claude Code or Codex, used on a GitHub repository on this Mac

## What stays private

- **Nothing leaves without your approval.** Handoffs are drafted and reviewed on your computer. The
  dashboard only answers requests from your own machine.
- **No credentials travel.** Handoffs name the tools a project needs, never passwords, tokens, or
  keys. Every draft is screened for credential-shaped text, and anything suspicious is refused.
- **You hold the keys.** Your identity is a key pair in the macOS Keychain, so there's no account
  to create. The relay stores only what you approved and a fingerprint of each token, never the
  token itself.
- **Access is scoped and short-lived.** A Connection reads one project, expires within 24 hours,
  and stops working the moment you revoke it. Revoking deletes the shared content.

The full security model is in [`docs/security.md`](./docs/security.md).

## Other ways to capture a Handoff

You can also ask your agent directly. `wist skill` prints instructions any coding agent
can follow, and `wist draft --schema` prints the exact format it writes.

## Status

Wist is an early release. Today it shows one project at a time, Connections last up to
24 hours, and it runs on macOS only. Continuing the work inside Muse with private repositories and
a coding agent is still being tested.

## Development

This is a TypeScript monorepo using pnpm and Turborepo.

| Path | What it is |
|---|---|
| `packages/domain` | Versioned schemas and rules for Projects, Handoffs, Capabilities, and Setup Plans |
| `apps/cli` | The `wist` command, local dashboard server, Hand off, identity, and storage |
| `apps/web` | The local dashboard (React) |
| `apps/api` | The relay: a Hono app on Cloudflare Workers with D1 |
| `packages/intelligence` | Optional pre-publication checks on a draft |

```sh
corepack pnpm install
corepack pnpm check        # format, lint, types, tests
corepack pnpm build
corepack pnpm --filter @wist/cli release   # builds the npm package in apps/cli/release
```

Run the relay locally against local-only D1 state:

```sh
corepack pnpm --filter @wist/api d1:migrate:local
corepack pnpm --filter @wist/api dev
```

Architecture: [`docs/architecture.md`](./docs/architecture.md). Decision records:
[`docs/adr/`](./docs/adr/). Domain terms: [`CONTEXT.md`](./CONTEXT.md).

## License

[Apache-2.0](./LICENSE)
