# Security requirements

Wist describes powerful access without becoming a credential-transfer system.

## Invariants

- Raw passwords, API keys, OAuth tokens, cookies, keychain entries, and authenticated CLI files never enter a Handoff or Capability declaration.
- The local identity private key never leaves its Runtime or enters Passport data; the relay receives only the public key and signed proofs.
- Each Runtime establishes its own Connection through an official authorization flow or a trusted remote broker.
- Every connector request is authenticated, scoped to a person, and limited to explicitly shared Projects.
- Sharing is previewable, expirable, and revocable.
- Read access is separate from permission to execute consequential actions.
- Stored context records provenance, freshness, and sensitivity metadata.
- TypeSafe credentials and all other server credentials remain server-side.

## Initial threat cases

- A repository contains a secret that looks like ordinary documentation.
- A malicious file asks the capture agent to exfiltrate unrelated context.
- Muse requests a Project that was not shared with its Connection.
- A revoked connector replays an old token.
- A Handoff becomes stale after the repository changes.
- A setup instruction installs a different package than the declared Capability.
- Work and personal Projects are accidentally combined.
- A stolen local identity key is used to publish or revoke shares.
- A malicious web page uses CSRF or DNS rebinding to send requests to the loopback daemon and tries
  to read, publish, or revoke Passport data.

The POC may use fixtures, but production code cannot weaken these invariants to make the demo easier.
