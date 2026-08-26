# Todoist MCP Server — Specification

Derived from `docs/behavior-inventory.md` (code-level behavior inventory) and
`docs/todoist-mcp-security-review.md` (security review). This document makes
no claims beyond what those two sources support.

---

## 1. Purpose

This server exposes a single Todoist account to an LLM agent over MCP, as a
fixed set of sixteen tools (seven read, nine write) that wrap a narrow subset
of the Todoist REST API. It exists so an agent can perform ordinary GTD-style
task management — listing, filtering, creating, updating, completing,
rescheduling tasks, projects, sections, labels, and comments — without holding
a wider surface than that, and without ever performing destructive operations
(delete, reorder, assignment, workspace/analytics, reminders, filters), which
remain human-only. It runs local-stdio, in either read-only or read/write
mode selected at process start by an environment variable, so the operating
posture of a given running instance is fixed for its lifetime rather than
negotiated per call.

## 2. Threat Model

Per the security review's scope and findings, this server defends against:

- **Malicious or compromised task content reaching the agent's context and
  causing unintended actions.** Todoist task/project/section/label/comment
  text is written by anyone with access to the account or a shared project —
  a collaborator, a synced third-party integration, or an attacker who gains
  write access to a single object. That text is untrusted input the moment it
  re-enters the agent's context via a tool response. The review's controls #2
  (content framing) and #3 (HTML/markdown stripping) exist specifically to
  stop this text from being interpreted as instructions or from smuggling
  clickable/parseable links back out (Finding 1, Finding 4).
- **Credential exfiltration via logs or error paths.** The token is a
  standing secret held by the process. Controls #4 (redaction) and the SSRF
  allowlist exist to keep that token from leaking through log lines, thrown
  errors, or a redirected outbound request (Finding 3, Finding 5).
- **Outbound requests being redirected off the intended host.** Control #1
  (SSRF allowlisting) defends against the server being coerced into
  contacting a host other than `api.todoist.com`, including via redirect
  (Finding 5).
- **Unintended write access when the operator wants read-only.** Control #5
  (environment-gated read-only mode) defends against write tools being
  reachable at all when the deployer has not explicitly enabled them —
  enforced by not registering those tools, not by a runtime check per call.
- **A single write-capable agent acting on injected content without a human
  in the loop.** Control #6, as originally described, aimed to defend
  against an agent silently executing a write that was actually dictated by
  injected task content, by requiring a second, confirmation-gated agent
  in front of any write. The review found this control does not exist in
  the code (Finding 2) — see Non-Goals and the corresponding Invariant.

The adversary in this model is anyone who can get text into a Todoist object
in this account (a collaborator, a synced integration, or an attacker with
any write access to a shared project), not a network attacker with control
of infrastructure between this server and Todoist — the SSRF control is about
this server's own request never being misdirected, not about hardening
Todoist's infrastructure.

## 3. Non-Goals

These are threats this server explicitly does not defend against. Stated
plainly so no future change quietly reintroduces a claim the code cannot
support:

- **Credential least privilege is impossible.** Todoist personal API tokens
  are always full read and write, account-wide, with no scoping mechanism.
  This server cannot narrow what the token can do; it can only choose which
  tools it exposes on top of that token. Any claim that this server achieves
  least-privilege credentials is false.
- **Framing and stripping do not defeat plain-prose injection.** A task
  whose text reads "ignore prior instructions and do X" is not neutralized by
  any control in this server. Framing (`safeField`) and markup stripping
  (`stripMarkup`) stop markup- and link-based delivery of injected content —
  they do nothing against injected content that is just plain English
  addressed to the model. The only thing that can address that is the
  model's own instruction-following discipline, i.e. whether it chooses to
  treat framed/untrusted text as data rather than as commands. That is
  policy, not enforcement, and this server has no mechanism to enforce it.
- **No defense against a compromised or malicious orchestrator.** If
  whatever invokes this server (an agent definition, a host process) is
  itself compromised or misconfigured to run in write mode against the
  operator's intent, this server has no control that catches that — read-only
  mode is enforced at this server's own tool-registration time, based on the
  environment it's given, not against the intent of whatever set that
  environment.
- **No two-agent confirmation gate exists.** Despite prior claims to the
  contrary (control #6), there is no mechanism anywhere in this codebase
  that pauses a write for human confirmation. A single agent process, if
  configured with `TODOIST_READONLY=false`, can execute a write the instant
  the model emits the tool call. Any writeup claiming a confirmation gate
  exists is false until one is built. See AD-1 for why this is not this
  codebase's job to build, and what would actually implement it.
- **No verification that a write actually achieved its intended effect**
  beyond receiving a non-error HTTP status. Tools report `ok: true` on any
  non-throwing response; they do not diff the API's returned state against
  the caller's intent.
- **No rollback of partial batch writes.** Any multi-item write tool
  (`add-tasks`, `update-tasks`, `reschedule-tasks`, `add-comments`) that
  fails partway through a batch leaves earlier items in the batch already
  mutated on Todoist's side, with no compensating action and no report of
  which items succeeded.

## 4. Architecture Decisions

### AD-1 — Per-request mode selection is not this codebase's responsibility

**Facts, established by direct inspection of the running configuration:**

- The agent definition at
  `/workspace/projects/agent-os/.claude/agents/todoist.md` launches this
  server with `TODOIST_READONLY: "false"` in its frontmatter `env` block.
  Mode is therefore fixed per agent definition, not per request.
- Nothing in this codebase, and nothing in the invoking layer as currently
  configured, selects mode based on the content of the user's request. This
  server correctly enforces whichever mode it is started in and has no
  mechanism to change that mode at runtime.
- The intended design is that read-only is the default and write mode is
  used only when the user's own typed request actually calls for a change.
  That intent is not implemented anywhere today.
- The smallest change that would implement it is two agent definitions —
  one read-only, one write-capable — with routing that picks between them
  based on the request. That routing is configuration in the Agent OS
  project, not code in this repository.

**Decision:**

- No human confirmation gate exists in this codebase, and none is planned
  as code here. A stdio MCP server has no mechanism to pause mid-call for
  human input — it responds to a tool call and returns; there is no
  built-in channel for it to block and wait on a person. Whatever
  confirmation semantics are wanted have to live above this process, in
  whatever invokes it.
- Per-request mode selection (read-only unless the request calls for a
  write) is the responsibility of the invoking agent layer, not of this
  server. This server's job stops at correctly enforcing whatever mode it
  was started in (see Invariant 8). Building the routing described above is
  tracked as separate work outside this repository, in the Agent OS
  project's agent definitions.

## 5. Invariants

Each invariant below is a statement that should be mechanically checkable
against the whole codebase (e.g. "no file matching X imports/does Y"), not
about one function. Status reflects the security review and behavior
inventory as of this writing.

| # | Invariant | Status | Citation |
|---|---|---|---|
| 1 | Every read-tool response is passed through `safeField`/`stripMarkup` framing before being returned to the caller. | **HOLDS** | Behavior inventory §4–5, §8; review "Also checked" §3 |
| 2 | Every write-tool response is passed through the same framing/stripping as read tools before being returned to the caller. | **VIOLATED** | Review Finding 1 — `write.js` never imports `sanitize.js` or `shape.js`; `writeResult` is raw `JSON.stringify`. (This is one observable consequence of Invariant 12 below.) |
| 3 | Every error message that reaches a tool's `isError` response has passed through `redact()`. | **VIOLATED** | Review Finding 3 — both `read.js` and `write.js` catch blocks emit `err.message` directly, unredacted, relying on unenforced upstream discipline. (This is the other observable consequence of Invariant 12 below.) |
| 4 | No tool output contains a URL in re-parseable or clickable form, regardless of the syntax used to embed it in the source text. | **VIOLATED** | Review Finding 4 — reference-style markdown links (`[x][1]` / `[1]: url`) and bare URLs pass through `stripMarkup` unmodified; the current implementation enumerates syntaxes to defang rather than guaranteeing the outcome, which is exactly what let this case through |
| 5 | Every outbound HTTP request target, including any redirect target, is validated against the SSRF allowlist before the request is sent. | **PARTIALLY VIOLATED** | Review Finding 5 — the initial URL is checked, but `fetch()` follows redirects with no re-check of the `Location` target |
| 6 | No tool-registration path exposes write tools when `TODOIST_READONLY` is not exactly `"false"`. | **HOLDS** | Behavior inventory §1, §7; `test/registration.test.js` |
| 7 | No tool in this server can delete, reorder, reassign, or manage reminders/filters/workspace-analytics objects. | **HOLDS** | Behavior inventory §9; `test/registration.test.js` — forbidden-name list enforced exhaustively |
| 8 | The server exposes write tools if and only if it was started with `TODOIST_READONLY` set to exactly `"false"`; this is decided once at startup, before any Todoist content is read, by not registering those tools at all, and cannot be changed for the lifetime of the running process. | **HOLDS** | `test/registration.test.js` — `'read-only mode registers only the 7 read tools, no writes'`, `'read/write mode registers the full 16-tool set'`; behavior inventory §1, §7. (Per-request mode selection and human confirmation are out of scope for this invariant — see AD-1.) |
| 9 | No log line emitted by `src/logger.js` contains the raw, unredacted API token. | **HOLDS** | Behavior inventory §2–3, §6 (tested); review "Also checked" §3 — logger redacts every line, `client.js` never logs headers/bodies |
| 10 | No error thrown or returned by any tool handler in `src/` contains the raw, unredacted API token, regardless of where the error originates. | **VIOLATED** | Review Finding 3 — errors originating outside `client.js` (e.g. a handler-level throw, or a future bug that references `cfg.apiKey` directly) reach the `isError` response with no redaction pass; today's absence of a known leak is an accident of what errors happen to be thrown, not something enforced |
| 11 | `API_BASE` / outbound hostname is a fixed literal, never derived from any tool input. | **HOLDS** | Behavior inventory §6; review Finding 5 discussion ("the host is hardcoded... never derived from any tool argument") |
| 12 | No tool result object — success or error, read or write — is constructed anywhere in `src/` except by passing its payload through a single designated result builder shared by all sixteen tools. Tools may pass different payloads to it; there is no second sanitization path. | **VIOLATED** | Review Findings 1 and 3 — `write.js` builds every result and every error response via its own ad hoc object literals (`writeResult`, and the inline catch-block `{isError, content}` shape), a separate path from the read-tool builder that applies framing, stripping, and redaction. This is the structural, mechanically checkable fact — a static test can grep for result-shaped object literals outside the one designated builder function — of which Invariants 2 and 3 are each one observable symptom. |

## 6. Tool Surface

All sixteen tools. "Echoed" lists fields in the tool's response that
originate from a Todoist API response body (as opposed to fields the tool
itself computed, like counts, or fields the caller supplied verbatim in the
same call and that are not subject to `safeField` framing).

| Tool | R/W | Inputs | Echoed fields (framed via `safeField`?) |
|---|---|---|---|
| `find-tasks` | R | `query`, `project_id`, `section_id`, `label`, `parent_id`, `ids[]`, `limit` | `id`, `content`✅, `description`✅, `project_id`, `section_id`, `parent_id`, `priority`, `labels[]`✅, `due.{date,datetime,timezone,is_recurring}`, `due.string`✅, `deadline`, `is_completed`, `url`, `created_at`, `completed_at` |
| `find-tasks-by-date` | R | `preset`, `date`, `comparison`, `limit` | same task fields as `find-tasks`, plus computed `filter` (server-built query string, not echoed) |
| `find-projects` | R | `limit` | `id`, `name`✅, `parent_id`, `is_inbox_project`, `is_favorite`, `is_archived`, `color`, `view_style`, `url` |
| `find-sections` | R | `project_id`, `limit` | `id`, `name`✅, `project_id`, `order` |
| `find-labels` | R | `limit` | `id`, `name`✅, `color`, `is_favorite`, `order` |
| `find-comments` | R | `task_id` XOR `project_id`, `limit` | `id`, `content`✅, `task_id`, `project_id`, `posted_at`, `attachment.file_name`✅ (URL/mime/size dropped) |
| `get-overview` | R | *(none)* | `projects[].{id,name✅,is_inbox_project,active_task_count,sections[] (names✅)}`, `labels[]` (names✅ only, no ids), `totals.{projects,active_tasks,labels,due_today,overdue}` (all computed) |
| `add-tasks` | W | `tasks[]`: `content`, `description`, `project_id`, `section_id`, `parent_id`, `labels[]`, `priority`, `due_string`/`due_date`/`due_datetime`, `deadline_date` | `id`, `content`❌ (unframed — but self-authored same call, per Finding 1 lower-risk case), `url`❌ |
| `update-tasks` | W | `tasks[]`: `id`, `content`, `description`, `labels[]`, `priority`, `due_string`/`due_date`/`due_datetime`, `deadline_date` | `id`, `content`❌ **(unframed; reflects full current API state, not necessarily caller-supplied — Finding 1's critical case)** |
| `complete-tasks` | W | `ids[]` | `ids[]` (caller-supplied, echoed back as-is, not from API) |
| `uncomplete-tasks` | W | `ids[]` | `ids[]` (caller-supplied, echoed back as-is, not from API) |
| `reschedule-tasks` | W | `tasks[]`: `id`, one of `due_string`/`due_date`/`due_datetime` | `id` only (caller-supplied; no content/text echoed) |
| `add-comments` | W | `comments[]`: `content`, `task_id` XOR `project_id` | `id`❌ only (no content echoed) |
| `add-projects` | W | `projects[]`: `name`, `parent_id`, `color`, `is_favorite`, `view_style` | `id`, `name`❌ (unframed) |
| `add-sections` | W | `sections[]`: `name`, `project_id`, `order` | `id`, `name`❌ (unframed) |
| `add-labels` | W | `labels[]`: `name`, `color`, `is_favorite`, `order` | `id`, `name`❌ (unframed) |

✅ = passed through `safeField` (framed, stripped, truncated).
❌ = **not** passed through any sanitizer — raw `JSON.stringify` per Finding 1.
The ❌ column is the injection surface Finding 1 identifies as critical,
worst on `update-tasks` because that echoed `content` need not be anything
the caller wrote in the same call.

## 7. Behavioral Requirements

Restated from the behavior inventory as requirements to preserve. Items
flagged **[DECISION NEEDED]** look accidental rather than intended and are
called out for your judgment rather than silently kept or dropped.

### Configuration
- R1. Read-only must be the default; writes enable only when
  `TODOIST_READONLY` is the exact string `"false"` — every other value
  (unset, empty, `"true"`, `"0"`, `"FALSE"`, `"no"`, anything else) must
  resolve to read-only.
- R2. Numeric caps (`TODOIST_MAX_OUTPUT_CHARS`, `TODOIST_MAX_FIELD_CHARS`,
  `TODOIST_MAX_ITEMS`) must fall back to their defaults (50000 / 2000 / 200)
  when unset or unparseable.
- **[DECISION NEEDED]** Numeric caps ≤ 0 are silently rejected and fall back
  to the default rather than erroring. This looks like defensive
  fail-safe behavior rather than an accident — worth confirming it's
  intended (silently ignoring an operator's explicit `"0"`/`"-5"` config
  vs. surfacing a config error).
- R3. `TODOIST_API_KEY` must take priority over `TODOIST_API_KEY_FILE` when
  both are set; file contents must be trimmed before use.
- R4. An unreadable key file must throw a fixed generic message that does
  not include the underlying OS error text or file path.
- R5. With no usable token from either source, `loadConfig` must throw
  without ever echoing any credential value.
- **[DECISION NEEDED]** An empty/whitespace-only `TODOIST_API_KEY_FILE`
  content is silently treated as "file doesn't exist" rather than a
  distinct error. Same question for an empty/whitespace-only
  `TODOIST_API_KEY` falling through to check the file instead of erroring
  immediately. Both look like intentional fallback chaining, but neither
  produces a diagnostic distinguishing "not set" from "set to garbage."

### Redaction
- R6. `registerSecret` must ignore non-string values and strings under 4
  characters, never adding them to the scrub set.
- R7. `redact()` must replace every occurrence of every registered secret,
  plus `Bearer <token>`- and `authorization: <value>`-shaped substrings, even
  when the specific token was never registered.
- **[DECISION NEEDED]** Registered secrets accumulate forever in a
  module-level `Set` with no bound and no unregister mechanism. Harmless for
  this single-token server today, but this is the kind of behavior that
  looks accidental (an artifact of "just never remove anything") rather than
  a deliberate design choice, and should be confirmed rather than carried
  forward silently if this server's scope ever grows to handle multiple
  tokens per process.

### Logging
- R8. Every log line must carry an ISO-8601 timestamp and level tag, be
  passed through `redact()`, and be written only to `stderr`, never `stdout`.
- R9. A `meta` object that fails to `JSON.stringify` (e.g. circular
  reference) must log the literal string `'[unserializable meta]'` instead
  of throwing.

### Sanitization
- R10. `stripMarkup` must strip HTML tags/comments, decode-then-defang HTML
  entities, replace markdown links/images with their visible label only
  (discarding the URL), defang code/emphasis/heading/table/blockquote
  markup characters, and strip control characters while preserving tab/
  newline.
- R11. `safeField` must return unframed empty string for empty/whitespace-
  only/markup-only input, must neutralize literal fence-marker strings found
  inside the value (preventing forged fence boundaries), and must truncate
  to `maxFieldChars` with a truncation marker inside the closing fence.
- R12. `capOutput` must truncate oversized payloads to `maxOutputChars` and
  append a notice naming the cap.
- **[DECISION NEEDED]** `UNTRUSTED_NOTICE` is prepended to every read-tool
  response unconditionally, even when that response contains no framed
  field at all. This may be intentional (a constant reminder to the model)
  or accidental noise — worth confirming, especially since the current test
  suite's assertion that framing occurred could in principle be satisfied by
  this notice's own text rather than an actual framed field.

### HTTP client
- R13. `API_BASE` must remain a hardcoded literal (`https://api.todoist.com/api/v1`);
  no config or tool input may ever influence it.
- R14. Every request must be validated by `assertAllowedUrl` (exact-match
  `https://api.todoist.com` only) before being sent.
- R15. The API token must be sent only via the `Authorization: Bearer`
  header, never logged, never included in query-string logging.
- R16. Non-2xx responses must become a `TodoistApiError` carrying `status`
  and a redacted, length-capped (500 char) message; network-level failures
  must be wrapped similarly.
- R17. `getPaginated` must respect the configured item cap exactly (slice
  final results to cap length) and follow `next_cursor` until exhausted or
  capped.
- **[DECISION NEEDED]** `getPaginated`'s `truncated` flag is `false` when the
  item count exactly equals the cap with no further cursor, even though the
  caller has no way to distinguish "this is really all the data" from "this
  happened to land exactly on the cap boundary." This looks like a
  reasonable definition but is an edge case worth confirming rather than
  assuming.

### Server lifecycle
- R18. Read tools must register in every mode; write tools must register
  only when `cfg.readOnly` is falsy, as an entirely separate registration
  call (not a per-call runtime gate) — so in read-only mode, write tool
  names are absent from the server, not merely disabled.
- R19. The forbidden-tool list (delete, reorder, assignment, workspace/
  analytics, reminders, filters) must never be registered in either mode.
- R20. Config-load failure and any uncaught startup/runtime error must
  write a redacted message to `stderr` (never `stdout`) and exit with code 1.

### Read tools
- R21. `find-tasks` must route a non-empty `query` to `/tasks/filter`; when
  no query is given, `ids[]` must be joined into a comma-separated parameter
  against `/tasks`.
- **[DECISION NEEDED]** When `query` is supplied to `find-tasks`, the other
  filter args (`project_id`/`section_id`/`label`/`parent_id`/`ids`) are
  silently ignored rather than combined or rejected. This is easy to miss as
  a caller and looks like it could confuse an agent into believing a
  combined filter was applied when it wasn't — worth deciding whether this
  should instead be a validation error.
- R22. `find-tasks-by-date` must require at least one of `preset`/`date`,
  throwing `'Provide either preset or date.'` otherwise; `preset` takes
  priority over `date`/`comparison` when both are given.
- **[DECISION NEEDED]** `find-tasks-by-date`'s `comparison` field is declared
  as `.enum([...]).default('on').optional()` — the `.optional()` after
  `.default()` makes the schema-level default unreachable dead code; the
  actual default is supplied by the handler's `?? 'on'`. Functionally
  harmless (the fallback still happens), but this is very likely an
  accidental ordering bug in the Zod chain rather than intended, and should
  be fixed or explicitly documented as intentional-but-redundant.
- R23. `find-comments` must require exactly one of `task_id`/`project_id`,
  throwing otherwise.
- R24. `get-overview` must fetch projects/sections/labels/tasks concurrently
  and fail entirely (no partial results) if any one fetch rejects.
- **[DECISION NEEDED]** `get-overview`'s due-today/overdue counts compare
  against UTC "today" on the server host, not the user's local timezone.
  For a user near midnight in a non-UTC zone this will misclassify tasks.
  This is flagged in both source documents as a real behavioral
  concern, not just a hypothetical — worth deciding whether it needs a
  timezone parameter or documented caveat.
- **[DECISION NEEDED]** `get-overview` silently drops any section whose
  `project_id` doesn't match a project in the same result set, with no
  error or note. Likely accidental (an orphaned-data edge case), not a
  deliberate filtering choice.
- R25. Every read-tool response must be prefixed with `UNTRUSTED_NOTICE` and
  size-capped via `capOutput` (see R12, and the DECISION flag above on
  whether the unconditional prefix itself is intended).

### Write tools
- R26. `update-tasks` must send only caller-supplied fields (besides `id`)
  in the request body — partial update semantics, not full-object replace.
- **[DECISION NEEDED]** `update-tasks` reports `ok: true` purely because the
  HTTP call didn't throw, without verifying the response reflects the
  intended change. Combined with Finding 1 (unframed echoed `content`),
  this is a compounding risk, not just a minor gap — worth deciding whether
  `ok` should mean anything more than "no exception."
- R27. `reschedule-tasks` must require at least one of `due_string`/
  `due_date`/`due_datetime` per task (currently enforced via Zod `.refine()`,
  not a handler throw — inconsistent with the handler-level checks in
  `find-comments`/`add-comments`, but not necessarily wrong).
- R28. `add-comments` must require exactly one of `task_id`/`project_id` per
  comment.
- **[DECISION NEEDED]** Multi-item write tools (`add-tasks`, `update-tasks`,
  `reschedule-tasks`, `add-comments`) process items sequentially with no
  rollback on a mid-batch failure, and the error response gives no
  breakdown of which items succeeded before the failure. This is very
  likely an accidental gap (not a deliberate design choice) given how much
  it undermines debuggability of partial failures — flagged for your
  decision on whether partial-success reporting should be added.
- R29. Deletion, reordering, assignment, reminders, and filters must never
  be implemented as tools in either mode (see R19).

## 8. Coverage Baseline

Measured this session with `node --test --experimental-test-coverage test/`
on Node v20.20.2:

| | Lines | Branches | Functions |
|---|---|---|---|
| All files | 83.43% | 83.16% | 77.97% |

Notes:

- This figure includes test files themselves in the denominator (Node
  v20's `--test-coverage-*` flags have no test-file-exclusion option).
  Node 22+ excludes test files from coverage by default, so this number
  will drop — mechanically, not because coverage regressed — the moment
  the runtime is upgraded to 22+. Any future comparison must either stay
  on Node 20 or re-baseline on Node 22+ before treating a delta as real.
- Automated coverage-threshold enforcement (`--test-coverage-lines` and
  friends) requires Node 22.8+ and is therefore **not yet in place** on
  this project's Node 20 runtime. Coverage is currently a measured
  baseline, not a gate.
- The specific number to watch: `src/tools/write.js` is at **14.29%
  function coverage**, the lowest of any file in `src/`. Any change to
  that file should raise, not lower, this figure.
