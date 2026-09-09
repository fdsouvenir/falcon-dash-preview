# Learnings

This file contains only durable lessons expected to remain relevant across the Falcon Dash roadmap.
It is not a changelog, issue diary, troubleshooting guide, protocol reference, or record of one-off
implementation fixes.

## System boundaries

- OpenClaw remains the source of truth for the agent runtime, sessions, native cron jobs, and plugin
  execution. Falcon Dash adds the operator experience, Work domain, integration lifecycle, and its
  own internal scheduling without creating a competing copy of OpenClaw runtime state.
- Falcon Dash and the OpenClaw Gateway are co-resident. Preserve the same-host trust and deployment
  boundary; do not introduce remote-gateway support or assume a particular machine, port, or
  deployment provider.
- The gateway client and Falcon Dash gateway plugin are complementary. Use the native gateway
  protocol for core RPCs and events; use the plugin only for Falcon-specific extensions such as
  context injection or custom agent-facing capabilities.
- Browser and agent surfaces must remain credential-blind. Resolve gateway credentials and provider
  secrets server-side through the built-in vault and SecretRefs, then expose scoped operations and
  redacted state rather than raw secret values.

## Work, authority, and provenance

- Authority comes from the trusted transport and recorded evidence, never from caller-supplied
  identity fields. Attribution labels are descriptive; they do not grant authority.
- Authority-creating operations fail closed when their source or permission cannot be verified.
  Convenience must not silently turn unavailable evidence into approval.
- A semantic no-op and an idempotency replay are different. A no-op produces no new state or event;
  a replay returns the original recorded result without repeating side effects.
- When external validation happens before a local transaction, re-check the local version inside the
  transaction before committing. Otherwise an asynchronous result can authorize a stale mutation.
- Replacing an external runtime object creates a new identity. Re-bind Falcon Dash metadata and
  preserve lineage rather than pretending the replacement is the original object.

## Integrations and agent context

- Human-readable guidance is not live integration state. Falcon Dash owns structured connection
  health, validation, refresh and keepalive execution, scheduling, audit history, and reauthorization
  state; provider adapters perform the provider-specific lifecycle work.
- Falcon Dash lifecycle scheduling is separate from OpenClaw native cron jobs. Sharing a UI must not
  collapse their ownership, persistence, execution, or failure semantics.
- Agent context must explain what Falcon Dash provides and how to use Work, integrations, and the
  built-in vault through approved tools. It must not expose raw credentials or require the agent to
  infer operational policy from database records or stale prose.
