---
title: Troubleshooting
description: Fixes for common problems.
---

## No projects are listed

Projects appear once Claude Code or Codex has a saved session in a GitHub repository on this Mac.

- Work in the repository with your coding agent, then reopen the dashboard.

## "is not installed or not on your PATH"

Wist runs your coding agent's command to write the Handoff.

- Install that agent, or start `wist` from a terminal where the agent's command works.

## "did not return a complete Handoff"

- Click **Hand off** again. If it keeps failing, open the agent and check that it's signed in.

## The draft is refused as a possible credential

Wist found text that looks like a password, API key, or token.

- Remove that text from the named field, then save the draft again.

## Muse says the link is revoked or expired

- Publish the Handoff again and give Muse the new link.

## `npx @wist/cli` fails on another operating system

Wist runs on macOS only, because it stores your keys in the macOS Keychain.
