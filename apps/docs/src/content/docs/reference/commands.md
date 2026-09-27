---
title: Commands
description: The wist commands for people and coding agents.
---

Run these commands with `wist` after you [install the command](/get-started/#install-the-command), or
with `npx @wist/cli` in its place.

| Command | What it does |
|---|---|
| `wist` | Starts the dashboard and opens it in your browser. |
| `wist serve` | Starts the dashboard without opening a browser. |
| `wist skill` | Prints instructions any coding agent can follow to write a Handoff. |
| `wist draft --schema` | Prints the JSON format a coding agent writes. |
| `wist draft --repo <path>` | Saves a Handoff that a coding agent wrote, read as JSON from standard input, as a draft for the repository at `<path>`. |

## Example: save a draft from a script

This example saves a draft for the current repository. The dashboard then shows it for review:

```sh
wist draft --repo "$(git rev-parse --show-toplevel)" <<'JSON'
{
  "source": "claude-code",
  "project": { "name": "my-app", "goal": "A weekly budgeting app." },
  "handoff": {
    "goal": "Ship recurring expenses.",
    "progress": ["Added the expenses table and migration; tests pass."],
    "decisions": [{ "decision": "Store amounts in cents.", "rationale": "Avoids rounding errors." }],
    "blockers": [],
    "nextActions": ["Add the recurring-expense form."],
    "context": [{ "title": "Schema", "handle": "docs/schema.md", "sensitivity": "internal" }]
  },
  "capabilities": ["github-cli", "claude-code"]
}
JSON
```

The `capabilities` field lists the tools the next agent needs. Choose from `github-cli`,
`claude-code`, and `codex-cli`.
