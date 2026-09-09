# Reliability Guide

This document captures recurring reliability concerns in Falcon Dash.

## Think in States

Most Falcon Dash surfaces are realtime or environment-dependent. Design and test for:

- loading
- ready
- empty
- error
- disconnected
- stale or partially hydrated data

If a screen only looks correct in the happy path, it is incomplete.

## Shell and Viewport Reliability

- Verify desktop inside `AppShell`.
- Verify narrow viewports inside `MobileShell`; this is current responsive behavior, not the future
  v6 dedicated mobile product.
- Check `100dvh` and safe-area behavior on narrow devices.
- Check long-content overflow for logs, markdown, tables, and inspectors.

## Gateway and Event Reliability

- Separate UI bugs from missing RPC data, stale snapshots, and event wiring issues.
- When possible, put state semantics in stores or utilities before encoding them in components.
- Reconnection and delayed hydration are normal conditions, not edge cases.
- The browser reconnects to Falcon Dash SSE, not directly to OpenClaw. A new ready snapshot must
  replace stale gateway-derived state after reconnect.
- Work SSE is an invalidation channel. Canonical Work state and durable history remain in SQLite and
  the Event Log even when a browser misses an event.
- Gateway runtime failures must not mutate local Work lifecycle into a convenient placeholder.

## Operational Clarity

- Status colors should communicate state, not decoration.
- Alerts, approvals, remediation actions, and blocking states should remain visible.
- Avoid hiding critical operator actions behind ornamental layouts or weak contrast.

## Preferred Evidence

When diagnosing a reliability issue, prefer:

1. store state
2. event logs
3. request and response shape
4. UI rendering

That order usually identifies the real fault faster than tweaking markup first.
