---
title: Connect Muse
description: Give Muse a private Connection link so it can continue your project.
---

This guide shows you how to share an approved Handoff with Muse. It takes about five minutes the
first time.

## Before you begin

- [Approve a Handoff](/guides/hand-off/) for the project.
- Have access to Muse.

## Publish the Handoff

To create a Connection link, follow these steps:

1. On the **Share** screen, click **Publish share**.

   Wist sends only the approved Handoff to the relay and creates a Connection link that expires
   after 24 hours.

2. Click **Reveal Connection URL**, then copy the link. It looks like
   `https://relay.wist.fyi/connect#token=…`.

## Give the link to Muse

To connect Muse, follow these steps:

1. In Muse, send this message, with your link pasted in:

   ```text
   Continue my project from Wist. Here's my private Connection link: <paste>. Save the token
   securely as a private tool, then read the page at the link for how to use it.
   ```

2. When Muse asks you to sign in to a tool such as GitHub, sign in through that tool's official
   sign-in page.

Muse stores the token in its secure credential storage, reads the Handoff, and follows the setup
plan for the project's tools. Wist never sends your passwords or keys.

Treat the link like a password. Anyone who has it can read that Handoff until it expires or you
revoke it.

## Next steps

- [Update or revoke a Connection](/guides/update-and-revoke/).
- [Troubleshooting](/reference/troubleshooting/).
