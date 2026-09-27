---
title: What's shared
description: What a Handoff contains, what leaves your computer, and what stays.
---

A Handoff describes your work. It never carries your credentials. This page lists what an assistant
receives and what stays on your computer.

## What a Handoff contains

| Field | What it holds |
|---|---|
| Goal | What the next agent should accomplish. |
| Progress | Completed, verified work. |
| Decisions | Choices already made, each with its reason. |
| Blockers | What stops progress, and what would unblock it. |
| Next actions | Concrete steps in order. |
| Context | Pointers such as `docs/architecture.md` or an issue URL, never file contents. |
| Tools | The tools the project needs, such as GitHub CLI, Claude Code, or Codex CLI. |

With the Handoff, your assistant also receives a short project brief with the repository, branch, and
revision, and a setup plan that lists how to install, sign in to, and verify each tool.

## What leaves your computer

Only a Handoff you approved, and only when you click **Publish share** or **Send to Muse**.

Wist sends it to the relay, Wist's server at `relay.wist.fyi`. The relay holds the Handoff so your
assistant can read it while your computer is off. It stores only Handoffs you approved, deletes
them when you revoke access, and never receives your keys or sign-ins.

## What stays on your computer

- Your key pair, in the macOS Keychain.
- Your sign-ins to GitHub, Claude Code, Codex, and every other tool.
- Your coding agent sessions and your project files.
- Drafts you haven't approved.

## Sign-ins happen on the assistant's side

A Handoff names the tools a project needs. Your assistant then asks you to sign in to each one
through the tool's official sign-in page. Wist never copies a password, token, or key from your
computer to the assistant.
