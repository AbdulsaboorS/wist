---
title: For assistant builders
description: How an assistant reads a Wist Connection link.
---

Any assistant that can call an HTTPS API with a bearer token can read a Wist Connection. This page
describes the contract. The same instructions are served to assistants at
`https://relay.wist.fyi/connect`.

## The Connection link

A person gives your assistant a link of this form:

```text
https://relay.wist.fyi/connect#token=<token>
```

The text after `#token=` is a read-only bearer token for the work that person approved. Store it in
secure credential storage, and keep it out of chat.

## Endpoints

Send `Authorization: Bearer <token>` with each request:

| Request | Returns |
|---|---|
| `GET /v1/projects` | The projects shared with this Connection. |
| `GET /v1/projects/{projectId}` | A compact brief with the repository and the current Handoff. |
| `GET /v1/projects/{projectId}/handoff` | Goal, progress, decisions and their reasons, blockers, next actions, and context pointers. |
| `GET /v1/projects/{projectId}/setup-plan` | The tools to install, sign in to, and verify. |

The full OpenAPI contract is at `https://relay.wist.fyi/openapi.json`.

## Continue the work

To continue a person's project, follow these steps:

1. Before each session, fetch the Handoff again. The person may have approved a newer one.
2. Clone the repository at the branch and revision in the brief.
3. Follow the setup plan. For each sign-in step, ask the person to complete the tool's official
   sign-in flow themselves. Ask only for sign-ins, never for passwords, tokens, or keys.
4. Treat recorded decisions as settled unless the person reopens them.
5. Start with the first next action. Ask the person before you push, merge, deploy, or spend money.

## Responses

| Status | Meaning |
|---|---|
| `200` | Success. |
| `401` | The request has no valid bearer token. |
| `410` | The person revoked the Connection or it expired. Stop using it and tell the person. |
