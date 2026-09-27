---
title: Hand off a project
description: Ask your coding agent to write a Handoff, then review and approve it.
---

A Handoff records where a project stands so another assistant can continue it. This page shows you
how to create one and approve it.

## Create a Handoff from the dashboard

To create a Handoff, follow these steps:

1. Run `wist` to open the dashboard.
2. Next to the project you want, click **Hand off**.

   Wist asks the coding agent you used, Claude Code or Codex, to write a Handoff from a copy of your
   latest session. The copy has no tools, so nothing in your project changes. This usually takes
   about a minute.

3. Read the Handoff on the **Share** screen. It shows the goal, progress, decisions and their
   reasons, blockers, next actions, and the tools the project needs.
4. If the Handoff is right, click **Approve share**.

Approval stays on your computer. To send the Handoff to an assistant, see
[Connect Muse](/guides/connect-muse/).

## Create a Handoff from your coding agent

You can also ask your coding agent to write a Handoff during a session. The `wist skill` command
prints instructions that any coding agent can follow.

- In Claude Code or Codex, ask: "Run `wist skill` and follow it to hand off this work."

The agent saves a draft with `wist draft`. To review and approve the draft, run `wist`.

## What Wist checks

Before Wist saves a draft or sends a Handoff, it screens the text for anything that looks like a
password, API key, or token. If it finds one, Wist refuses the draft and names the field to fix.

## Next steps

- [Connect Muse](/guides/connect-muse/): share the approved Handoff.
- [What's shared](/concepts/what-is-shared/): see exactly what a Handoff contains.
