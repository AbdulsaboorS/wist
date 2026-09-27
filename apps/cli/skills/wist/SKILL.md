---
name: wist
description: Capture a Handoff of the current repository's work into Wist so another agent or assistant can continue it. Use when the user asks to hand off, pass on, save for later, or continue this work elsewhere.
---

# Capture a Handoff

A Handoff tells the next agent where this work stands. You write the substance; the
`wist` CLI fills in identifiers, repository facts, and timestamps, then screens the
result for credentials. The user reviews and approves it in their local dashboard. You never
approve or share it.

## 1. Gather the current state

Work from evidence, not memory alone:

- `git status`, `git log --oneline -15`, and the current branch
- The task the user has been working on in this session
- Open problems, failing checks, or decisions still pending

## 2. Write the draft

Write it for a capable agent who has never seen this conversation.

- **project.goal**: The lasting purpose of the repository, not today's task.
- **handoff.goal**: What the next agent should accomplish.
- **progress**: Completed, verified facts. Say what passed and how you know.
- **decisions**: Choices already made, each with its rationale, so they are not relitigated.
- **blockers**: What stops progress now, and what would unblock it.
- **nextActions**: Concrete steps in order. The first one should be doable immediately.
- **context**: Pointers such as `docs/architecture.md` or an issue URL, never file contents.
- **capabilities**: Choose from `github-cli`, `claude-code`, `codex-cli` the tools the next agent
  needs. Default: `["github-cli"]`.

Never include secrets, tokens, keys, passwords, environment values, cookies, or private customer
data, even redacted. Capture rejects content that looks like a credential. Set `sensitivity` to
`sensitive` if the work itself is confidential.

Run `wist draft --schema` for the exact JSON shape.

## 3. Submit it

From the repository root:

```sh
wist draft --repo "$(git rev-parse --show-toplevel)" <<'JSON'
{
  "source": "claude-code",
  "project": { "name": "…", "goal": "…" },
  "handoff": {
    "goal": "…",
    "progress": ["…"],
    "decisions": [{ "decision": "…", "rationale": "…" }],
    "blockers": [],
    "nextActions": ["…"],
    "context": [{ "title": "…", "handle": "docs/…", "sensitivity": "internal" }]
  },
  "capabilities": ["github-cli", "claude-code"]
}
JSON
```

Set `source` to your own agent name. If the command rejects the draft, fix the reported field
and retry. Do not work around the credential screen.

## 4. Hand back to the user

Tell the user the draft is ready and that they review, approve, and share it in the dashboard,
which `wist` opens. Summarize the goal and first next action in one or two sentences.
