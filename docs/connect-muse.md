# Connect Muse

This guide takes a project you worked on with Claude Code or Codex and lets Muse continue it. It
takes about five minutes the first time. Afterwards, sending Muse a newer Handoff takes two clicks.

## Before you start

- A Mac with Node.js 24 or newer (`node --version`).
- A GitHub repository you worked on with **Claude Code** or **Codex** on this Mac.
- Access to Muse.

## 1. Open the dashboard

```sh
npx wist-cli
```

Your browser opens the dashboard at `127.0.0.1`. It runs only on your computer, and there's no
sign-up.

## 2. Hand off

Your recent projects appear with the coding agent you used and when you last worked on them. Click
**Hand off** next to the one you want.

Wist asks that agent to write a Handoff from a copy of your latest session: the goal,
what's done, the decisions made and why, what's blocking, and the next steps. The copy has no
tools, so nothing in your project changes. This usually takes about a minute.

## 3. Review and approve

The **Share** screen shows exactly what Muse will receive. Read it. If it's right, click **Approve
share**, then **Publish share**.

Before anything is saved or sent, Wist checks for anything that looks like a password,
key, or token and refuses to continue if it finds one.

## 4. Give Muse the link

Click **Reveal Connection URL** and copy it. It looks like
`https://wist-relay.feedback-signal.workers.dev/connect#token=…`.

In Muse, send:

> Continue my project from Wist. Here's my private Connection link: *(paste)*. Save the
> token securely as a private tool, then read the page at the link for how to use it.

Muse stores the token with its secure credential capture, reads the Handoff, and follows the
setup plan. When a tool like GitHub needs you to sign in, Muse asks you to do it through that
tool's official sign-in page. Wist never sends your passwords or keys.

Treat the link like a password. Anyone who has it can read that Handoff until it expires or you
revoke it.

## 5. Keep Muse up to date

After more work, click **Hand off** again, then **Approve Handoff** and **Send to Muse**. Muse keeps
using the same link and sees the newest Handoff the next time it checks.

## 6. Stop sharing

Click **Revoke share**. The Handoff is deleted from the relay immediately, and Muse's next request
fails. You can share again later with a new link.

## Limits today

- A Connection link lasts up to 24 hours. After that, publish again and give Muse the new link.
- The dashboard shows one project at a time: the one you handed off most recently.
- Wist runs on macOS only, because it keeps your keys in the macOS Keychain.

## Troubleshooting

- **No projects listed:** work in a GitHub repository with Claude Code or Codex on this Mac first.
  Projects appear once the agent has a saved session there.
- **"is not installed or not on your PATH":** install that agent, or open the dashboard from a
  terminal where the agent's command works.
- **"did not return a complete Handoff":** click Hand off again. If it keeps failing, open the agent
  and check that it's signed in.
- **Muse says the link is revoked or expired:** publish a new share and give Muse the new link.
