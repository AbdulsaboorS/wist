---
title: Security
description: How Wist keeps your work private and your credentials on your computer.
---

Wist shares descriptions of your work, never access to your accounts. This page summarizes how it
protects you. The full model is in
[`docs/security.md` on GitHub](https://github.com/AbdulsaboorS/wist/blob/main/docs/security.md).

## Nothing leaves without your approval

- Your coding agent drafts Handoffs on your computer, and you review them there.
- The dashboard answers only requests from your own computer.
- Only a Handoff you approved reaches the relay, Wist's server at `relay.wist.fyi`, and only when
  you publish or send it.

## No credentials travel

- A Handoff names the tools a project needs. It never contains passwords, tokens, keys, cookies, or
  sign-in files.
- Wist screens every draft for text that looks like a credential and refuses anything suspicious.
- Your assistant signs in to each tool itself, through the tool's official sign-in page.

## You hold the keys

- Your identity is a key pair in the macOS Keychain, so there is no account or password.
- The relay stores the Handoffs you approved and a fingerprint of each Connection token, never the
  token itself.

## Access is scoped and short-lived

- A Connection link reads one project.
- It expires within 24 hours.
- It stops working the moment you revoke it, and revoking deletes the shared content from the relay.

## Report a problem

To report a security issue, open an issue on
[GitHub](https://github.com/AbdulsaboorS/wist/issues). Leave tokens and private project details out
of public issues.
