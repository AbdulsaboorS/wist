# Wist

Wist keeps a Passport: the portable representation of a person's projects, working context, capabilities, and destination-specific readiness across AI assistants and computers.

## Language

**Passport**:
The durable, user-controlled record that makes work and capabilities portable across assistants and runtimes.
_Avoid_: Agent wallet, profile, backup

**Project**:
A continuing body of work with a goal, repository or artifacts, conventions, and accumulated decisions.
_Avoid_: Workspace, job

**Handoff**:
A scoped snapshot of a Project's current goal, progress, decisions, blockers, and next actions for another agent to continue.
_Avoid_: Transcript, memory dump, summary

**Share**:
The relay's copy of one Project's latest approved Handoff. Destinations read it through Connections; approving a newer Handoff updates it in place, and revoking it removes its content.
_Avoid_: Upload, sync, publication record

**Capability**:
A declared ability the person expects an agent to use, such as a CLI, skill, MCP server, model, or connected service.
_Avoid_: Tool when referring to the broader portable concept

**Runtime**:
A computer or isolated environment where an agent can access Projects and prepare Capabilities.
_Avoid_: Machine, device, VM when the distinction is irrelevant

**Connection**:
A scoped, revocable authorization that makes a Capability usable in one Runtime without exposing its credential to the agent. For Passport retrieval, a Destination Assistant proves its Connection with the issued capability token.
_Avoid_: Credential, secret, login

**Readiness**:
An evidence-backed assessment of whether one Capability is declared, installed, authorized, and usable in one Runtime.
_Avoid_: Availability when referring to destination-specific setup state

**Setup Plan**:
A portable declaration of what a Runtime must install, configure, authorize, and verify before it can continue a Project.
_Avoid_: Script, environment dump

**Connector**:
An integration through which a destination assistant can retrieve authorized Passport data and report readiness.
_Avoid_: Plugin, adapter when referring to the user-facing integration

**Source Agent**:
The coding agent that contributes current Project context and Capability declarations to a Passport.
_Avoid_: Origin agent, sender

**Destination Assistant**:
The personal assistant or agent receiving a Handoff and preparing a Runtime to continue the Project.
_Avoid_: Target agent, receiver
