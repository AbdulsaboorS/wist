# Use a TypeScript monorepo with portable domain contracts

Wist will use a pnpm and Turborepo TypeScript monorepo, with versioned Zod contracts in a domain module consumed by the web, API, CLI, MCP, persistence, fixtures, and assistant adapters. This keeps the portability contract independent of Muse and lets parallel UI and MVP work share one validated language without duplicating payload types.

The original web, identity, and persistence choices below are superseded by ADR-0003. The TypeScript monorepo and portable-contract decision remains in force.

The web surface was planned for Next.js, the connector surface for Hono on Cloudflare Workers, and durable identity and data for Supabase. ADR-0003 replaces the hosted dashboard and account identity with a local daemon, local dashboard, local keypair, and a D1-backed capability relay.
