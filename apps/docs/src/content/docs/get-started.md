---
title: Get started
description: Install Wist and open the dashboard.
---

This page shows you how to install Wist and open its dashboard on your Mac.

## Requirements

- macOS. Wist keeps your keys in the macOS Keychain.
- Node.js 24 or newer. To check your version, run `node --version`.
- A GitHub repository you worked on with Claude Code or Codex on this Mac.

## Open the dashboard

To try Wist without installing it, run:

```sh
npx @wist/cli
```

Your browser opens the dashboard at `127.0.0.1`. The dashboard runs only on your computer, and there
is no account to create. The first run also creates your key pair in the macOS Keychain.

## Install the command

To install the `wist` command so you and your coding agent can run it anywhere, follow these steps:

1. Install the package:

   ```sh
   npm install -g @wist/cli
   ```

2. Open the dashboard:

   ```sh
   wist
   ```

## What you see

The dashboard lists the projects you recently worked on with Claude Code or Codex, with the agent you
used and when you last worked on each one.

## Next steps

- [Hand off a project](/guides/hand-off/).
- [Connect Muse](/guides/connect-muse/).
