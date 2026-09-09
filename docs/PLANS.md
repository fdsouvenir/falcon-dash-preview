# Plans Guide

This document defines how execution plans should be written and maintained for Falcon Dash work.

## Purpose

Plans are working specs. A good plan makes the next execution pass obvious and verifiable.

## What a Good Plan Contains

- the user-visible goal
- the relevant routes, components, stores, or server modules
- the expected behavior after the change
- the intended validation path
- any environment dependency or live-gateway prerequisite

## Write Plans at the Right Level

- Do not write vague steps like "fix UI" or "update backend".
- Do not explode straightforward work into low-signal micro-steps.
- Name the real surface and the proof you expect to run.

## Good Step Shapes

- Update approval queue store mapping and add unit coverage for the new state.
- Refine mobile settings navigation layout and verify in desktop and mobile shells.
- Add Playwright coverage for the disconnected gateway banner on the settings route.

## Completion Standard

A plan is not complete until it includes:

- what changed
- what was run
- what could not be run, if anything
- any manual rerun notes needed for live-gateway behavior
