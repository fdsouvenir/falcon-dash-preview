# Design System: Falcon Dash Work

## 1. Visual Theme & Atmosphere

Falcon Dash Work is the console where a user supervises work carried out by an AI agent. It is a
sibling of Falcon Dash Vault and shares its exact visual language: quiet, dark, information-dense,
flat, and strictly utilitarian. Closer to a database client or an air traffic control strip board
than to a consumer project tracker.

Where Vault's governing emotion is *custody*, Work's is **authority**.

The user does not perform the work and does not author its content. The agent writes every
definition, plan, change, finding, and status transition. The user grants, chooses, answers, and
kills. The interface therefore has two strictly separated registers:

- **Evidence** — everything the agent authored. Rendered for reading and comparison. Inert.
- **Authority** — the small set of actions reserved to the user. Rendered as the only
  interactive controls on the page.

A screen that blurs these two registers has failed. The most common failure mode this system
exists to prevent is an edit affordance appearing beside agent-authored text.

## 2. Color Palette & Roles

Inherited from Falcon Dash Vault and preserved exactly:

- `--canvas: #131315` — page background, deepest surface.
- `--panel: #1b1b1d` — cards, rails, table surfaces, menus.
- `--row-hover: #212124` — row hover only.
- `--border: #353437` — hairlines, dividers, input outlines, table rules.
- `--text: #e5e1e4` — primary reading text.
- `--muted: #aaa9a3` — labels, metadata, timestamps, counts, provenance.
- `--amber: #f7bf59` — the single accent. Reserved for user authority and focus.
- `--danger: #e2564a` — destructive or revoking actions only.
- `--danger-dim: #3a1f1c` — destructive hover/confirm background.
- `--ok: #6fbf87` — completed, achieved, authorized, confirmed.
- `--warn: #d8973c` — drift, staleness, conflict, review required.
- `--agent: #7aa2d6` — agent identity and agent-owned state.

Accent discipline is stricter here than in Vault. **Amber marks user authority and nothing else.**
If a control is amber, the user can act on it. Agent-owned states never take amber; they take
`--agent` or `--muted`. This is the primary way the two registers are told apart at a glance.

Amber does not repeat within a region. A column of rows that all require authorization does not
render eleven amber chips — the bucket header carries the accent, the individual chips stay
`--muted`, and amber returns on the focused or selected row only. An accent that appears on
everything marks nothing.

Status colors map as: `open` → `--muted`; `ready` → `--text`; `in_progress` → `--agent`;
`waiting` → `--warn`; `completed`/`achieved` → `--ok`; `abandoned`/`retracted` → `--muted` at
60% opacity with strikethrough on the title only.

## 3. Typography Rules

- `SPACE_GROTESK` for interface and prose text.
- `SPACE_MONO` for anything stored as an identifier or machine value: object ids, revision
  numbers, version numbers, actor strings, command names, timestamps, hashes, source refs.
- The mono/sans split carries meaning, exactly as in Vault: prose is sans, record data is mono.
- Object titles: 14px, weight 500, `--text`. **Titles are the payload of every row and take
  layout priority over ids, counts, and chips.** A row truncates its metadata before it truncates
  its title, and no list column is narrow enough to cut a title below roughly 40 characters.
- Field labels: 11px, uppercase, letter-spacing 0.06em, `--muted`.
- Metadata, counts, provenance: 12px, `--muted`.
- Long agent-authored prose (`description`, `done_when`, `scope`, `conclusion`) renders as
  Markdown at 13px/1.6 with a 72ch measure. It is body copy, not a form field.

## 4. Component Stylings

- **Attention bucket.** The dashboard's primary unit. A `--panel` column with a 12px uppercase
  header carrying the bucket name and a count. The header of the bucket that requires the user
  carries `--amber`; all other headers are `--muted`. Rows inside are 40px, hairline separated.
  A bucket with zero items collapses to a single `--muted` line, never a card with an empty
  illustration. Buckets are not equal width: a bucket is sized by how much its titles need.

- **Work row.** 40px. Left to right: a 2px status edge in the status color, type glyph, title
  (`--text`, given all remaining space), owning project (`--muted`, truncates first), attention
  chips, and an optional right-aligned mono id fragment that is dropped entirely at narrow widths.
  Hover raises to `--row-hover`. Selection shows a 2px `--amber` left edge.

- **Attention chip.** A 16px `--muted` pill carrying an attention `code` (`authorization_required`,
  `waiting`, `follow_up_due`). Severity is expressed by the row's status edge, not by flooding the
  chip with accent color. Never more than two chips per row; the third becomes `+N`.

- **The authority set.** Exactly nine commands are the user's, and they are the only commands that
  may ever be rendered as a control: `authorize`, `revoke_authorization`, `decide`, `defer`,
  `answer`, `dismiss_ask`, `abandon`, `archive`, `restore`. Every other command in the system
  belongs to the agent and appears only as history. Creating work and placing it in a project or
  area are agent commands: there is no "+ New", no move control, and no picker anywhere in the UI.

- **Authority block.** The only interactive cluster on a detail page, and at most one per page.
  A `--panel` region with a 1px `--amber` top rule, a plain-language statement of what the user is
  being asked to grant or choose, the required inputs, and one primary amber control. It always
  sits below the evidence it depends on, never above it — the user reads before acting. Where the
  schema requires a rationale, conditions, or sources, those fields are part of the block and the
  primary control stays disabled until they are supplied.

- **Option card.** Used only inside a decision's authority block. One card per option: label,
  summary, risks, tradeoffs. The agent's recommended option carries a `--agent` "Recommended" tag
  and its rationale; the recommendation is displayed as advice, never pre-selected.

- **Drift badge.** A `--warn` mono badge reading `pinned @rev N · current @rev M`. Appears on any
  artifact whose pinned definition no longer matches the object's current definition revision, and
  on any dependency whose pins no longer match. Drift is the system's most important derived state:
  it must never be silent, and any surface that lists drifted work gives those titles full width.

- **Evidence rail.** A right-hand 360px column on detail pages holding sources, artifacts, linked
  work, and provenance. Sources render as: `kind` badge, `label`, mono `ref`, and `captured_at`.
  Anything with a locator or snapshot reference is a link; anything without one is plain text and
  must not be styled as a link.

- **Provenance line.** A single 12px mono `--muted` line: `actor · command · timestamp`. Appears
  under every artifact and every history entry. This is how the user knows who wrote what.

- **History strip.** The event log rendered as a vertical list of provenance lines with an
  expandable version diff. Immutable, and visually flat — no timeline ornaments, no avatars, no
  connecting spines.

- **Confidence marker.** For findings and answers: `tentative` / `supported` / `confirmed`
  rendered as a three-segment mono meter in `--muted` / `--warn` / `--ok`. Never a percentage.

- **Keyboard hint bar.** A 24px `--muted` mono strip pinned to the bottom of list and board
  surfaces, naming the navigation, inspect, and authority shortcuts. This product is operated by
  keyboard first.

- **Empty and error states.** One line of `--muted` prose plus at most one action. Never an
  illustration.

## 5. Layout Principles

- **Dashboard:** a full-width bucket board. Attention buckets are the organizing unit, ordered by
  who is blocked: user first, then drift, then agent, then external, then informational. No hero,
  no summary tiles, no charts.
- **Detail pages:** two columns — a fluid evidence column and a fixed 360px evidence rail. The
  authority block spans the evidence column at its natural position in the reading order.
- **List pages:** a 240px area rail, a fluid list. Same skeleton as Vault's group rail so the two
  modules feel like one product.
- Vertical rhythm is 4px. Row padding 8px/12px. Section gaps 16px. No gap exceeds 24px.
- Content is left-aligned to a 16px gutter and never bleeds past the viewport edge.
- Density target: at least 14 work rows visible at 900px viewport height without scrolling.
- On narrow viewports the evidence rail stacks beneath the evidence column and the area rail
  becomes a horizontal scrolling strip. Neither compresses below readable width. A board with more
  buckets than fit scrolls horizontally rather than shrinking every column past its title measure.

## 6. Motion & Interaction

- Row hover is instant. Authority block reveal is 120ms ease-out. Nothing else animates.
- Every authority action carries the object's expected version. If the stored version has moved,
  the UI shows a conflict banner offering reload — never a silent failure, never an automatic retry.
- Irreversible authority actions require the user to type the object title to confirm, matching
  Vault's destructive pattern. Recorded-but-reversible actions such as deciding, answering, and
  deferring do not, because they can be superseded.
- Warnings returned by a command are surfaced inline on the object immediately after the action,
  not as a toast.

## 7. Anti-Patterns / Constraints

- **Never render an edit affordance on agent-authored content.** No pencil icon, no inline editing,
  no hover-to-edit, no "add" button beside a title, description, completion criterion, plan, scope,
  risk, rollback, acceptance, conclusion, or success condition. These are the agent's to write and
  the user's to read. The user changes them by asking the agent.
- **Never expose an agent-only command as a control.** Creating work, placing it in a project or
  area, starting it, marking it ready, parking it, resuming it, completing it, revising a
  definition or plan, associating, linking dependencies, and assigning have no buttons. They
  appear only as history. Anything outside the nine-command authority set is agent-owned.
- **Never a drag-and-drop board.** Status is the result of a semantic command with a reason and a
  version check, not a drag target. A kanban column that can be dragged into is a lie about this
  system.
- No progress bar as a project's primary signal. Status *mix* across a project's children is the
  honest health indicator; a percentage implies a precision the model does not carry.
- No invented fields. No priority, no due date, no story points, no assignee avatars, no labels —
  none of these exist in the schema.
- No burndown charts, velocity, or cycle-time widgets.
- No cards-in-cards. No drop shadows. No gradients. No rounded corners above 8px.
- No marketing language, no illustrations, no onboarding hero.
- Never show a recommendation as a pre-selected radio button; the user must choose.
- Never hide the consequence of not deciding. A decision screen that shows options without showing
  the cost of not choosing is incomplete.
- Sample and documentation content is neutral and generic. No real user names, private projects,
  credentials, hostnames, or personal data appears in any screen.
