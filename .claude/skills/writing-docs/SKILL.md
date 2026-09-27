---
name: writing-docs
description: House style for Wist's user-facing text, adapted from the Google developer documentation style guide. Use when writing or editing the docs site (`apps/docs`), a README, a guide, CLI help or error text, or landing-page copy.
---

# Writing Wist docs

Write like the Google developer documentation style guide (https://developers.google.com/style): plain,
friendly, and exact. The reader is a developer who uses Claude Code or Codex, may read English as a second
language, and decides in minutes whether to trust a tool with their project.

## Voice

- Address the reader as **you**. Use active voice and present tense: "Wist screens the Handoff", not "the
  Handoff will be screened".
- Write short sentences with one idea each. Use common words: _use_, not _utilize_; _start_, not _initiate_.
- Describe what the product does today. A behaviour that is still being tested gets stated as such, once, in
  plain words.
- Keep claims measurable: "links expire after 24 hours", "runs on macOS". Let the reader draw the adjective.

## Structure

- Open each page with one or two sentences that say what the page helps the reader do.
- Headings use sentence case and name a task or a thing: "Connect Muse", "What stays on your computer".
- Procedures:
  - Introduce them with a full sentence ending in a colon: "To share a Handoff, follow these steps:".
  - Number the steps. One action per step, starting with an imperative verb.
  - Put the place or condition first: "In the dashboard, click **Approve**."
  - State the result after the action in the same step when the reader needs to check it.
  - Mark optional steps with "Optional:" at the start. Format a single-step procedure as one bullet.
- Use bulleted lists for sets, numbered lists for sequences, and tables for facts the reader compares.

## Formatting

- **Bold** for UI labels exactly as they appear: **Hand off**, **Approve**, **Revoke**.
- `Code font` for commands, flags, file paths, URLs the reader types, and values: `npx @wist/cli`,
  `wist draft --schema`.
- Link text names the destination: "see [Connect Muse](...)". Every link reads correctly out of context.
- Dates use an unambiguous form: `2026-09-28` or "September 28, 2026". American spelling, serial comma.
- Refer to places by name ("the next section", "in **Commands**"), never by position on the screen.
- Every image carries alt text that says what the image shows.

## Wist words

Use these terms exactly, capitalised as shown. Definitions live in `CONTEXT.md`.

| Write | Meaning |
|---|---|
| **Handoff** (noun) | The approved record of a project's goal, progress, decisions, blockers, and next steps. |
| **Hand off** (button, verb) | The action that asks the coding agent to write a Handoff. |
| **Connection link** | The private, expiring URL an assistant uses to read a Handoff. |
| **coding agent** | Claude Code or Codex, where the work happened. |
| **personal assistant** / **assistant** | Muse or another assistant that continues the work. |
| **dashboard** | The local page `wist` opens at `127.0.0.1`. |

"Passport" is an internal record name; keep it out of user-facing text.

## Facts

State only what the code and deployed services do. Check these before writing a claim:

- Commands and flags: `wist --help`, `apps/cli/src/main.ts`.
- Limits and security: `docs/security.md`, `apps/api/src/app.ts`.
- Current status and caveats: the **Status** section of the root `README.md`.

A page is done when every procedure has been followed against the real product or code, every term matches
the table above, and every link resolves.
