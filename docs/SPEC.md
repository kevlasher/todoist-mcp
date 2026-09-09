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

### AD-2 — URLs in tool output are defanged, not removed

**Decision:**

- URLs in tool output are defanged rather than removed, so a person can
  still read and manually reconstruct a link they saved. Defanging applies
  to all hosts equally; a `todoist.com` allowlist was considered and
  rejected, because any host exemption is a permanent maintenance
  obligation on a security control, and because defanging preserves the
  information the exemption was meant to protect.
- The `url` structural field in `shape.js` is a raw passthrough and was
  never affected by URL removal, contrary to an initial assumption.

### AD-3 — All redirects are refused

**Decision:**

- Any 3xx response from the Todoist API is treated as an error. The fetch
  call passes `redirect: 'manual'` and any 300-399 status throws the same
  `SsrfError` the allowlist check throws. The `Location` header value is
  never read into the error message, because it is attacker-influenced
  content.

**Rationale:**

- A normal Todoist API call does not redirect. A redirect therefore means
  something changed, and failing loudly is more useful than silently
  adapting. Refusing all redirects also makes the rule unconditional, with
  no target-validation logic that could later be wrong.

**Rejected alternative:**

- Following same-host redirects and re-validating the target. Safe in
  principle, since a relative `Location` can only resolve to the same
  origin, but it requires validation logic that must stay correct over time
  and it makes the rule conditional.

IMPORTANT, and this is the point of recording it: if Todoist ever introduces
a redirect on an endpoint this server calls, that endpoint will start
failing with an `SsrfError` mentioning a 3xx status. That is this decision
working as designed, not a bug. The fix at that point is to update the
endpoint path to the new location, not to start following redirects.

### AD-4 — The untrusted-content notice is unconditional

**Decision:**

- `UNTRUSTED_NOTICE` is prepended to every successful tool response, read
  and write alike, in `buildResult`. It is part of the response envelope
  that every tool returns, applied the same way regardless of what the
  response contains, and does not depend on whether the payload contains
  any value that was actually passed through `safeField`.
- Four write tools (`complete-tasks`, `uncomplete-tasks`,
  `reschedule-tasks`, `add-comments`) therefore carry a notice explaining
  fence markers while producing no fenced value. This is accepted, not
  overlooked.

**Rationale:**

- `buildResult` is the single result construction path for all sixteen
  tools, guaranteed by Invariant 12. Keeping the notice unconditional
  there means every response carries it by construction, checkable by
  reading one function, rather than depending on what a given response
  happens to contain.
- On a response containing no fenced value, the notice is vacuously true
  rather than false. It states what the markers mean if present. It does
  not misdescribe the response.

**Rejected alternative:**

- Applying the notice only when the payload contains at least one framed
  value. Rejected on failure mode. A conditional would have to inspect
  the payload to decide, and if that condition were ever wrong, a
  response carrying genuinely attacker-controlled framed text would ship
  without its warning. The current design's failure mode is a redundant
  notice on four low-value responses. Trading a cosmetic failure for a
  silent-absence-of-control failure is the wrong direction, and it adds a
  branch to the one path where the project has deliberately spent effort
  ensuring there are none.

**Accepted cost:**

- A warning that appears on every response, including ones with nothing
  to warn about, gives the model less reason to attend to it. This is a
  plausible cost, not a measured one; there is no instrumentation here
  that would detect it. It is accepted in exchange for the failure mode
  above.
- If that cost later proves to matter, the cheaper remedy is to reduce
  what the four tools echo rather than to make the notice conditional.
  Three of them return only caller-supplied ids and `add-comments`
  returns only a generated id, so none of them needs to echo anything.
  That is a separate question from the notice and is not resolved here.

## 5. Invariants

Each invariant below is a statement that should be mechanically checkable
against the whole codebase (e.g. "no file matching X imports/does Y"), not
about one function. Status reflects the security review and behavior
inventory as of this writing.

**Status** is a claim about the codebase: does the invariant hold right
now. **Evidence** is a separate claim about how that is known. The two
are independent, and an invariant can be true while the evidence for it
is weak. Grades:

- **TESTED** — an automated test fails if this invariant is violated, and
  that test has been proven capable of failing by deliberately
  introducing the violation. Untested-but-passing is not TESTED; a test
  that has only ever been green has not demonstrated it can detect
  anything.
- **INSPECTED** — established by reading the code. True as of the
  reading, but no test would catch a regression.
- **ASSERTED** — carried over from `docs/behavior-inventory.md` or
  `docs/todoist-mcp-security-review.md` and not independently confirmed
  during this remediation.
- **UNGRADED** — the evidence behind this row has not been examined in
  this remediation. The status claim stands; the strength of its support
  is unknown. Grading the remaining rows is tracked work, not a
  publishing gate.

An UNGRADED row is not a weaker row than a TESTED one. It is a row nobody
has checked. Invariant 1 was cited as tested for months while its only
tool-output assertion could not fail, which is why this column exists.

| # | Invariant | Status | Evidence | Citation |
|---|---|---|---|---|
| 1 | Every read-tool response is passed through `safeField`/`stripMarkup` framing before being returned to the caller. | **HOLDS** | **TESTED** (`find-projects`) / **INSPECTED** (six remaining read tools) | `test/mcp-e2e.test.js` — `'read tool output is framed and strips markup; token never leaks'`, which asserts the echoed project name matches exactly what `safeField` produces. Proven capable of failing by replacing `shapeProject`'s `safeField` call with `stripMarkup`, which failed this assertion alone. Proves `find-projects` routes through the framing helper; it does not prove the helper frames correctly, which is `test/sanitize.test.js`'s job. Remaining read tools covered by inspection of the shapers in `src/shape.js`. Behavior inventory §4–5, §8; review "Also checked" §3 |
| 2 | Every write-tool response is passed through the same framing/stripping as read tools before being returned to the caller. | **HOLDS** | **TESTED** (`update-tasks`) / **INSPECTED** (four write tools framing an echoed field) / n/a (four echoing no Todoist-origin text, see AD-4) | `test/mcp-e2e.test.js` — `'write tool echoes framed/stripped/capped content, exactly as a read tool would (update-tasks, Invariant 12/2)'`, specifically its assertion comparing against the exact output `safeField` produces. Not independently proven capable of failing during Session 9; it survived the `shapeProject` break unchanged, which is expected since that break touched only the read path |
| 3 | Every error message that reaches a tool's `isError` response has passed through `redact()`. | **HOLDS** | **UNGRADED** | `test/mcp-e2e.test.js` — `'a plain Error (not TodoistApiError) thrown mid-handler never leaks the registered secret — read tool'` and `'— write tool'` |
| 4 | No tool output contains a URL in re-parseable or clickable form, regardless of the syntax used to embed it in the source text. | **HOLDS** | **UNGRADED** | `test/invariant4-url-embedding.test.js`, `test/invariant4-todoist-allowlist.test.js` — URLs are defanged (scheme broken to `hxxp`/`hxxps`, dots bracketed) rather than deleted, applied uniformly to every host with no allowlist or exemption |
| 5 | Every outbound HTTP request target, including any redirect target, is validated against the SSRF allowlist before the request is sent. | **HOLDS** | **UNGRADED** | `test/invariant5-redirect-ssrf.test.js` — the invariant is now satisfied by refusing all redirects rather than by re-validating redirect targets, so no second URL is ever contacted |
| 6 | No tool-registration path exposes write tools when `TODOIST_READONLY` is not exactly `"false"`. | **HOLDS** | **UNGRADED** | Behavior inventory §1, §7; `test/registration.test.js` |
| 7 | No tool in this server can delete, reorder, reassign, or manage reminders/filters/workspace-analytics objects. | **HOLDS** | **UNGRADED** | Behavior inventory §9; `test/registration.test.js` — forbidden-name list enforced exhaustively |
| 8 | The server exposes write tools if and only if it was started with `TODOIST_READONLY` set to exactly `"false"`; this is decided once at startup, before any Todoist content is read, by not registering those tools at all, and cannot be changed for the lifetime of the running process. | **HOLDS** | **UNGRADED** | `test/registration.test.js` — `'read-only mode registers only the 7 read tools, no writes'`, `'read/write mode registers the full 16-tool set'`; behavior inventory §1, §7. (Per-request mode selection and human confirmation are out of scope for this invariant — see AD-1.) |
| 9 | No log line emitted by `src/logger.js` contains the raw, unredacted API token. | **HOLDS** | **UNGRADED** | Behavior inventory §2–3, §6 (tested); review "Also checked" §3 — logger redacts every line, `client.js` never logs headers/bodies |
| 10 | No error thrown or returned by any tool handler in `src/` contains the raw, unredacted API token, regardless of where the error originates. | **HOLDS** | **UNGRADED** | `test/mcp-e2e.test.js` — `'a registered secret appearing in normal (non-error) API content never leaks — read tool (Invariant 10)'` (covers the success path: the shared result builder applies `redact()` to all outgoing text, not only error text), plus the two plain-Error tests (`'a plain Error (not TodoistApiError) thrown mid-handler never leaks the registered secret — read tool'` / `'— write tool'`, covering the error path) |
| 11 | `API_BASE` / outbound hostname is a fixed literal, never derived from any tool input. | **HOLDS** | **UNGRADED** | Behavior inventory §6; review Finding 5 discussion ("the host is hardcoded... never derived from any tool argument") |
| 12 | No tool result object — success or error, read or write — is constructed anywhere in `src/` except by passing its payload through a single designated result builder shared by all sixteen tools. Tools may pass different payloads to it; there is no second sanitization path. | **HOLDS** | **UNGRADED** | `test/result-builder-shape.test.js` — `'Invariant 12: a tool result object is constructed in exactly one place in src/, never ad hoc per tool'`. The check is by object shape (any `{ content: [{ type: 'text', ... }] }`-shaped literal outside the one designated builder function), not by function name. Verified by deliberately introducing a violating tool and confirming the test caught it at the exact line. |

**On the framing evidence in Invariants 1 and 2.** Until Session 9, both
rows cited assertions that checked only whether `FRAME_OPEN` and
`FRAME_CLOSE` appeared somewhere in the tool output. `UNTRUSTED_NOTICE`
contains both markers in its own explanatory text and is prepended to
every response, so those assertions passed unconditionally and proved
nothing. Invariant 2 was in fact carried by a second, valid assertion the
citation did not name. Invariant 1 had no valid test evidence at that
level until commit `adf414a`. Both confounded assertions were removed, a
valid assertion was added for the read path, and
`test/framing-assertion-shape.test.js` now fails if the idiom reappears.
That tripwire is deliberately narrow: it matches one specific expression
form and does not trace data flow, so a differently phrased variant would
pass it.

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
were previously flagged as needing a decision where the behavior looked
accidental rather than intended. All of them were resolved in Session 9:
each is now either a decision recorded inline, marked **DECIDED, Session
9.**, or a confirmed defect recorded in section 10, marked **Superseded,
Session 9.** with a pointer to its entry there. None remain awaiting
judgment.

### Configuration
- R1. Read-only must be the default; writes enable only when
  `TODOIST_READONLY` is the exact string `"false"` — every other value
  (unset, empty, `"true"`, `"0"`, `"FALSE"`, `"no"`, anything else) must
  resolve to read-only.
- R2. Numeric caps (`TODOIST_MAX_OUTPUT_CHARS`, `TODOIST_MAX_FIELD_CHARS`,
  `TODOIST_MAX_ITEMS`) must fall back to their defaults (50000 / 2000 / 200)
  when unset or unparseable.
- **DECIDED, Session 9.** Numeric caps ≤ 0 keep falling back to their
  defaults, and a warning naming the variable and the rejected value is
  emitted to stderr at startup. Honoring a cap of 0 would produce a
  functionally dead server, so ignoring the value is right; what is
  missing today is that an operator who sets a cap and then sees default
  behavior has no way to learn why. The warning goes to stderr only, per
  R20, and a bad cap value must not prevent startup. Implementation is
  scheduled for a later session.
- R3. `TODOIST_API_KEY` must take priority over `TODOIST_API_KEY_FILE` when
  both are set; file contents must be trimmed before use.
- R4. An unreadable key file must throw a fixed generic message that does
  not include the underlying OS error text or file path.
- R5. With no usable token from either source, `loadConfig` must throw
  without ever echoing any credential value.
- **Superseded, Session 9.** Confirmed as a defect and scheduled. See
  section 10, D-4. The section 10 entry is broader than this item was: it
  records that the resulting error message names `TODOIST_API_KEY` even
  when the operator configured `TODOIST_API_KEY_FILE`.

### Redaction
- R6. `registerSecret` must ignore non-string values and strings under 4
  characters, never adding them to the scrub set.
- R7. `redact()` must replace every occurrence of every registered secret,
  plus `Bearer <token>`- and `authorization: <value>`-shaped substrings, even
  when the specific token was never registered.
- **DECIDED, Session 9.** Registered secrets keep accumulating in an
  unbounded module-level `Set`, with no unregister mechanism. Never
  removing an entry is the safe direction, because an unregistered secret
  is one that can leak; an unregister mechanism would create a failure
  mode in which a still-live token stops being scrubbed. Unbounded growth
  is only reachable if this process ever holds many tokens over its
  lifetime, which the current single-token design forbids. Reopen this if
  that scope changes.

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
- **DECIDED, Session 9.** This item bundled two questions with different
  answers.

  The design question, whether the unconditional prefix is intended, is
  resolved in AD-4: it is intended and retained. The prefix also turned
  out to be broader than this item described. It is applied to every
  response from all sixteen tools, not to read-tool responses only,
  because `buildResult` is the single construction path for all of them.
  R25 was understated rather than wrong.

  The second half was not a design question. The suspicion that the
  suite's framing assertion could be satisfied by the notice's own text
  was correct, and it was a real defect. `UNTRUSTED_NOTICE` contains the
  literal fence markers in its explanatory text, so two assertions
  checking for marker presence in tool output passed unconditionally.
  Both were removed, a valid assertion was added for the read path, and
  `test/framing-assertion-shape.test.js` now fails if the idiom returns.
  See the note below the Invariants table in section 5.

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
- **DECIDED, Session 9.** The cursor-based path is already correct and must
  not change. The flag is `items.length >= cap && !!cursor`, so exactly-cap
  items with a non-null `next_cursor` reports truncated, and exactly-cap
  items with a null cursor correctly does not — the API is stating there is
  no more data. The original framing of this item misidentified
  where the problem was. The defect is in the bare-array fallback branch,
  which `break`s with no cursor and therefore always reports
  not-truncated, even when the array came back full at the requested page
  limit. Fix scheduled for a later session: that branch must set the flag
  based on whether the array came back at the page limit.

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
- **Superseded, Session 9.** Confirmed as a defect and scheduled. See
  section 10, D-3.
- R22. `find-tasks-by-date` must require at least one of `preset`/`date`,
  throwing `'Provide either preset or date.'` otherwise; `preset` takes
  priority over `date`/`comparison` when both are given.
- **DECIDED, Session 9.** Fix it, scheduled for a later session, and fix it
  as a bug class rather than as one instance. `.default()` followed by
  `.optional()` makes the schema-level default unreachable dead code
  wherever it appears, not just on this field. The later session must
  search every schema in `src/` for that ordering and correct all
  occurrences together.
- R23. `find-comments` must require exactly one of `task_id`/`project_id`,
  throwing otherwise.
- R24. `get-overview` must fetch projects/sections/labels/tasks concurrently
  and fail entirely (no partial results) if any one fetch rejects.
- **Superseded, Session 9.** Confirmed as a defect and scheduled. See
  section 10, D-2.
- **Superseded, Session 9.** Confirmed as a defect and scheduled. See
  section 10, D-1. The section 10 entry is broader than this item was: it
  records the dropped sections as one consequence of a larger root cause,
  capped fetches feeding derived counts, not as an isolated edge case.
- R25. Every tool response, read and write alike, must be prefixed with
  `UNTRUSTED_NOTICE` and size-capped via `capOutput` (see R12). The
  prefix is applied unconditionally in `buildResult` and does not depend
  on whether the payload contains any framed value. See AD-4 for why,
  including the accepted consequence that four write tools carry the
  notice while framing nothing.

### Write tools
- R26. `update-tasks` must send only caller-supplied fields (besides `id`)
  in the request body — partial update semantics, not full-object replace.
- **DECIDED, Session 9.** `ok` must mean more than "no exception". Session 8
  established by direct observation that `POST /tasks/{id}` returns the
  task's full current state, so the handler can compare the fields it sent
  against the fields returned. One known complication: `due_string` is
  natural language that Todoist interprets into a `due` object, so it will
  not compare literally and needs different treatment from fields sent
  verbatim. Design and implementation are scheduled for a later session.
  Section 3 Non-Goals currently states accurately that no such
  verification exists; that statement must be updated when this is
  implemented, not before.
- R27. `reschedule-tasks` must require at least one of `due_string`/
  `due_date`/`due_datetime` per task (currently enforced via Zod `.refine()`,
  not a handler throw — inconsistent with the handler-level checks in
  `find-comments`/`add-comments`, but not necessarily wrong).
- R28. `add-comments` must require exactly one of `task_id`/`project_id` per
  comment.
- **DECIDED, Session 9.** Add partial-success reporting to the multi-item
  write tools (`add-tasks`, `update-tasks`, `reschedule-tasks`,
  `add-comments`). Do not add automatic retry: these writes are not
  idempotent, and if `add-tasks` fails partway the caller often cannot tell
  whether the failing item was created before the error, so retrying risks
  duplicates. `update-tasks` is safer to reapply, but giving retry-safe and
  retry-unsafe tools the same behavior is how subtle data corruption
  happens. The response must report which items succeeded, which failed,
  and which were never attempted, and leave the decision to the agent or
  the human. Rollback remains out of scope and stays disclosed in section 3
  Non-Goals. Implementation is scheduled for a later session.
- R29. Deletion, reordering, assignment, reminders, and filters must never
  be implemented as tools in either mode (see R19).

## 8. Coverage Baseline

Original baseline, measured with `node --test --experimental-test-coverage
test/` on Node v20.20.2:

| | Lines | Branches | Functions |
|---|---|---|---|
| All files | 83.43% | 83.16% | 77.97% |

Post-Session-5, measured the same way:

| | Lines | Branches | Functions |
|---|---|---|---|
| All files | 87.28% | 84.58% | 83.58% |

Post-Session-6, measured the same way:

| | Lines | Branches | Functions |
|---|---|---|---|
| All files | 89.39% | 86.36% | 85.81% |

Post-Session-7, measured the same way:

| | Lines | Branches | Functions |
|---|---|---|---|
| All files | 90.16% | 86.67% | 86.23% |

`src/sanitize.js` branch coverage moved from 87.50% to 83.33%: `defangUrl`
added branches not all of which are exercised, specifically a URL match
containing no dots.

`src/tools/write.js` function coverage is now **38.46%**, up from the
14.29% recorded baseline.

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
- The specific number to watch: `src/tools/write.js` was at **14.29%
  function coverage** in the original baseline, the lowest of any file in
  `src/`. Any change to that file should raise, not lower, this figure.

## 9. Contract Test Methodology

The project's standing rule is that a test is written before its
implementation and watched to fail, then the implementation is written to
make it pass. A test that passes before its implementation exists is a
stop-and-report event, not something to proceed past.

Contract tests are exempt from that rule, because they have no
implementation to write. A contract test asks the live Todoist API a
question and records the answer. Its expected result on first run is green,
and green means the premise under test holds.

Because the failure-first step is what normally proves a test is not
vacuous, contract tests replace it with two mandatory checks. Both must be
performed before a green contract test result is treated as evidence:

1. **Assertion inversion.** Restate the assertion to claim the opposite of
   the premise and run it against the live API. It must go red. A test that
   is green in both directions is not reading the response and proves
   nothing.
2. **Request body verification.** Assert that the outgoing request body
   contains only the fields the test intends to send. If a field the test
   claims not to be sending is present in the request, the API returning
   that field back is trivially expected and confirms nothing about
   partial-update semantics.

Contract tests must live outside the `test/` directory, so that neither
`npm test` (defined as `node --test test/`) nor the PostToolUse hook at
`.claude/hooks/test-on-src-or-test-edit.sh` collects or triggers them. Live
API calls must never fire as a side effect of editing a file.

### Observed: POST /tasks/{id} partial update semantics

Observed directly against the live Todoist API on 2026-08-27:

- A request to `POST /tasks/{id}` carrying a JSON body of exactly
  `{"priority": 4}` and nothing else received a response containing 28
  top-level fields.
- 27 of those fields were not sent in the request. Full list: `user_id`,
  `id`, `project_id`, `section_id`, `parent_id`, `added_by_uid`,
  `assigned_by_uid`, `responsible_uid`, `labels`, `deadline`, `duration`,
  `is_collapsed`, `checked`, `is_deleted`, `added_at`, `completed_at`,
  `completed_by_uid`, `updated_at`, `due`, `child_order`, `order_key`,
  `content`, `description`, `note_count`, `day_order`, `completed_count`,
  `postponed_count`.
- The returned `content` matched the task's existing content exactly,
  despite `content` never being sent in the request.
- `description` and `labels` also returned. `content`, `description`, and
  `labels` are all attacker-writable text fields, so the echoed surface is
  wider than `content` alone.

**Consequence:** the premise underpinning security review Finding 1 is
confirmed. A caller updating one unrelated field receives the full current
task state back, including attacker-writable text it never sent and did
not ask for.

**Provenance:**

- Verified by `test-contract/update-task-partial.contract.js`, run against
  a dedicated throwaway account, gated by
  `test-contract/account-guard.js`.
- Both of this section's mandatory checks were performed. Request-body
  verification confirmed the outgoing body contained only `priority`.
  Assertion inversion was run as a temporary copy of the test with the
  assertions reversed; it failed as required, confirming the test reads
  the live response and is not vacuous.
- Todoist's published documentation could **not** be retrieved for this
  endpoint's response schema — the docs site renders client-side and did
  not yield schema content. There is therefore no documented claim to
  compare against, and the original source of this premise is
  unestablished. `RESUME.md` described it as having been "read in
  documentation," which could not be substantiated. The premise now rests
  on direct observation rather than on documentation.

### Open items raised during Session 8

These are observations, not decisions. Neither is resolved here.

1. **`UNTRUSTED_NOTICE` scope is under-specified.** R25 states that every
   READ-tool response is prefixed with `UNTRUSTED_NOTICE`. Invariant 2
   states that write-tool responses receive the same framing and stripping
   as read tools, but neither R25 nor Invariant 2 states that the notice
   itself is prefixed to write-tool output. Observed directly during
   Session 8: the `add-tasks` response carried the notice. So either R25 is
   understated or the implemented behavior is broader than the spec
   describes. This is a claims-accuracy question for Session 9 to resolve,
   alongside the README and agent definition reconciliation.
2. **Tool output consumers may hold stale assumptions.** The
   `UNTRUSTED_NOTICE` prefix broke `scripts/live-smoke.js`, which had
   parsed tool output as bare JSON since before remediation. That script
   has been fixed. The open question is whether anything else that
   consumes this server's tool output makes the same assumption. That is
   an Agent OS question, not one this repository can answer, and belongs
   with the other Agent OS items already noted in `docs/RESUME.md`.

## 10. Confirmed Defects, Scheduled

Places where the code does not do what section 7 requires, or where it does
something a caller would not reasonably expect from the tool's own
description. These are distinct from the decisions recorded in section 4 and
from the `DECIDED` entries in section 7: nothing here was chosen. Each was
confirmed by reading the code during Session 9 and is scheduled rather than
resolved.

An entry leaves this section when the defect is fixed and a test exists that
fails if it returns.

### D-1 — `get-overview` reports counts derived from a capped fetch, with no signal

**Confirmed** by reading `src/tools/read.js` during Session 9.

`get-overview` issues four `getPaginated` calls, each independently capped at
`cfg.maxItems` (default 200). Every derived number is computed from those
capped sets:

- each project's `active_task_count`, counted across the tasks fetch
- `totals.due_today` and `totals.overdue`, counted across the same fetch
- `totals.projects`, `totals.active_tasks`, `totals.labels`, each the length
  of its own capped fetch

For an account with more than 200 active tasks, these numbers are not
truncated, they are wrong. A project holding 40 active tasks can report 3,
because only 3 of its tasks fell inside the first 200 fetched. Two hundred
active tasks is ordinary for a GTD account, so this is not a large-account
edge case.

`getPaginated` returns a `truncated` flag on each of the four calls.
`get-overview` discards all four. In their place the payload carries a fixed
`note` string stating that counts reflect up to the configured cap and large
accounts may be truncated. That note is emitted unconditionally, so it does
not distinguish a correct overview from a wrong one. A caller cannot tell
which it received.

Two further consequences of the same root cause:

- A section whose `project_id` does not appear in the projects fetch is
  silently dropped from the output. Reachable when the projects fetch itself
  is capped.
- `get-overview`'s input schema is empty, so unlike the other list tools it
  accepts no `limit` and a caller cannot raise the cap for this view.

**Fix criteria:**

- Truncation must be visible per fetch in the response, derived from the
  `truncated` flags rather than from a fixed string.
- Any total or per-project count computed from a truncated fetch must be
  identifiable as a floor rather than an exact count.
- A dropped orphaned section must be surfaced, not silently discarded.
- The unconditional `note` string is removed or replaced by a signal that is
  only present when it applies.
- A test fails if a count derived from a truncated fetch is presented as
  exact.

**Owner:** Session 10. Gates publishing.

### D-2 — `get-overview` computes "today" in UTC on the server host

**Confirmed** by reading `src/tools/read.js` during Session 9. Also flagged
in both source documents.

`due_today` and `overdue` are computed by string-comparing each task's
`due.date` against `new Date().toISOString().slice(0, 10)`, which is always
UTC on the host. For a user in a non-UTC zone, tasks are misclassified near
the date boundary. For a US Eastern user, every evening after 8pm local is
already tomorrow in UTC.

Same tool as D-1 and the same two output fields, but a different root cause.
Fixing one does not fix the other.

**Fix criteria:**

- The timezone used for the comparison is explicit, not inferred from the
  host.
- The response states which timezone was used, so a wrong answer is visibly
  wrong rather than silently wrong.
- Behavior is defined for tasks with a floating due date versus a datetime
  carrying its own timezone.

**Owner:** Session 10 or later. Gates publishing.

### D-3 — `find-tasks` advertises filters it silently discards

**Confirmed** by reading `src/tools/read.js` during Session 9.

When a non-empty `query` is supplied, the handler calls `/tasks/filter` with
only that query. The `project_id`, `section_id`, `label`, `parent_id`, and
`ids` arguments are never placed on the request and never reach Todoist.
They are not combined with the query and their presence alongside it is not
an error.

The tool's own description offers `query` and those five arguments as
alternatives for narrowing the same search, with nothing marking them
mutually exclusive. The consumer misled is the agent, which reads the tool
schema rather than any documentation, so this cannot be corrected in
`README.md` alone.

**Fix criteria:**

- The tool's description and the affected fields' `.describe()` text state
  that `query` supersedes the other filters.
- Whether the combination should instead be rejected as a validation error is
  a separate decision, deliberately not made here. Changing it to an error is
  a behavior change; correcting the description is not.

**Owner:** Session 10. Gates publishing, description text only.

### D-4 — Token-source errors name the wrong variable

**Confirmed** by reading `src/config.js` during Session 9.

`resolveToken` returns an empty string in three distinguishable situations:
neither environment variable set; `TODOIST_API_KEY_FILE` set to a file that
exists but contains only whitespace; `TODOIST_API_KEY` set to whitespace with
no file configured. All three reach the same `loadConfig` throw, whose
message states that `TODOIST_API_KEY` is not set. An operator who configured
a token file correctly, and whose file is empty, is told to set a variable
they deliberately did not use.

A fourth case is already distinct and correct: an unreadable file throws its
own generic message, which per R4 must not include the OS error text or the
path.

**Fix criteria:**

- The three empty-token cases produce distinguishable messages.
- No message includes the file path, file contents, or any part of a token
  value. R4's constraint is unchanged. Naming which variable was consulted is
  not a leak, since the operator supplied it.
- A test fails if any of these messages contains a value read from the
  environment or the file.

**Owner:** Session 10 or later. Does not gate publishing.
