# Todoist MCP Server — Specification

Derived from `docs/behavior-inventory.md` (code-level behavior inventory) and
`docs/todoist-mcp-security-review.md` (security review). This document makes
no claims beyond what those two sources support.

---

## Decision log

An index, not a record. Each row names what a session changed and where
the detail lives. The decisions themselves are in section 4, the
requirement-level decisions in section 7, the coverage history in section
8 and the confirmed defects in section 10.

Maintenance: one row per session, added when the session ends.

| Session | What changed | Detail in |
|---|---|---|
| 1–4 | Remediation of the six findings in `docs/todoist-mcp-security-review.md`. All six closed. Original coverage baseline established. Session-level detail is not reconstructible from the documents in this repo. | Security review; section 8 |
| 5 | Coverage rose to 87.28% lines / 84.58% branches / 83.58% functions. Work not otherwise recorded here. | Section 8 |
| 6 | Coverage rose to 89.39% / 86.36% / 85.81%. Work not otherwise recorded here. | Section 8 |
| 7 | Coverage rose to 90.16% / 86.67% / 86.23%. `defangUrl` added, lowering `src/sanitize.js` branch coverage. Work not otherwise recorded here. | Section 8 |
| 8 | Contract-test methodology established, with assertion inversion and request-body verification as mandatory substitutes for the failure-first step. `POST /tasks/{id}` partial-update semantics observed directly against the live API on 2026-08-27, confirming Finding 1's premise. Account guard retrofitted onto `scripts/live-smoke.js`. | Section 9 |
| 9 | AD-4 and AD-5 recorded. Two confounded framing assertions removed and a tripwire added. Invariant 1's framing evidence replaced with a real comparison; Invariant 2's proven capable of failing. Evidence column added to section 5. All ten `[DECISION NEEDED]` items in section 7 resolved. Section 10 opened with D-1 through D-5. Section 6's stale sanitizer marks corrected. Both Session 8 open items closed. Fixture-default collision and the unverified `url` format assumption recorded as scheduled work. | Sections 4, 5, 6, 7, 8, 9, 10 |
| 10 | D-5 fixed by removing the `url` field from tool output, recorded as AD-6. A class search found three raw url sites, not one. The strict-pattern guard recorded earlier the same day was superseded before it was built. D-5 left section 10. Static tripwire `test/no-url-key-in-output.test.js` added. AD-2, Invariant 4 and section 6 updated to match. Coverage recorded for `25c63e1`. D-3 fixed by correcting the `find-tasks` description text only, with no behavior change; decision recorded under R21, and D-3 left section 10. Test `test/find-tasks-query-supersedes-description.test.js` reads that text from `tools/list`. D-1 fixed: `get-overview`'s tasks fetch counts up to a fixed 5000 while its project, section and label lists keep `TODOIST_MAX_ITEMS`; every count carries `is_floor`; orphaned sections and tasks are surfaced. Decision recorded under R24, and D-1 left section 10. R17's bare-array flag fixed alongside it. AD-5's list of example-agent warnings updated. Coverage recorded for `cdd670f`. D-2 decided: `get-overview` stops computing "today" on the server host and asks Todoist's own `today` and `overdue` filters, so the timezone is the Todoist account's own and the server holds none, replacing the open question of how a timezone would be supplied. D-2 fixed that way: the counts mean what Todoist's filters mean, deadline-only tasks included, to match the Todoist app; both filter fetches use the 5000 ceiling, and each count takes `is_floor` from its own fetch. Decision recorded under R24, and D-2 left section 10. Three unreachable fallbacks removed from the D-2 tests to restore that file's branch coverage. AD-5 updated: the example agent now carries no defect warnings. Coverage recorded for `0a5ab95`. | Sections 4, 5, 6, 7, 8, 10 |
| 11 | Independent code review of 2026-09-24 recorded verbatim in `docs/reviews/`. Seven findings reproduced against `04c46ec` and recorded as D-6 through D-12, which gate publication: URL reconstruction and undefanged URL forms, unsanitized and uncapped error results, a throwing numeric entity, dot-segment task ids, read-tool `limit` above `TODOIST_MAX_ITEMS`, an unguarded live script, and two tests that pass while their property is violated. The review's other findings recorded as D-13 through D-22, which do not gate publication. Invariants 1, 2 and 4 marked VIOLATED; 6, 8, 9 and 10 qualified; a VIOLATED status defined. No code or test changes. | Sections 5, 10 |
| 12 | D-12 fixed in `6a99b01`, tests only. `test/client.test.js`'s token test now registers a 40-character token and asserts it is absent from the error message, proven by removing the error detail's redaction in `src/client.js`. The `find-tasks` regression check now requires success and the fixture task before asserting no `url`, proven by a throwing handler. Static check `test/calltool-asserts-iserror.test.js` added for the bug class; it found three more tests in `test/mcp-e2e.test.js`, each now asserting success first. AD-6 Evidence and Invariant 4's citation updated. D-12 left section 10; D-22 scope noted. Coverage recorded for `6a99b01`. | Sections 4, 5, 8, 10 |
| 13 | D-11 fixed: `scripts/live-smoke-date.js` now calls `verifyContractTestAccount` before any request and loads config with `TODOIST_API_KEY` set to the verified contract token and `TODOIST_API_KEY_FILE` removed, as `scripts/live-smoke.js` does. Test-first `e96d3fe`, implementation `9d4bd71`. `test/live-smoke-date-account-guard.test.js` runs the script with `fetch` stubbed, so no request leaves the machine. Static check `test/live-write-paths-guarded.test.js` added for the bug class across `scripts/` and `test-contract/`; it found no other offender, and removing the guard from `scripts/live-smoke.js` turns it red. `README.md` lists three guarded live paths and its Layout block includes the script. D-21's weaknesses left open. D-11 left section 10. Coverage recorded for `9d4bd71`, with a note on child-process coverage. | Sections 8, 10 |
| 14 | D-8 fixed: a numeric entity whose code point is zero, a surrogate (0xD800 to 0xDFFF) or above 0x10FFFF now decodes to U+FFFD through `decodeCodePoint` in `src/sanitize.js`, as the HTML standard does for invalid numeric character references; valid entities decode as before. Decision recorded under R10. Test-first `be91ced`, implementation `bf2124d`. `test/d8-invalid-numeric-entity.test.js` covers hex and decimal forms, the surrogate range, zero, 2^53+1, digit runs past Infinity and the 0x10FFFF / 0x110000 boundary, and shows `find-tasks` returning every task when one carries a bad entity. For the bug class it feeds every shaper hostile text in each framed field, and a static check allows `String.fromCodePoint` in `src/` only inside `decodeCodePoint`; a planted raw call in `src/shape.js` turns it red. It found no other string-input throw. Two wrong-type throws it found, an object text field with no usable `toString` and a `null` item, recorded under D-16 and not fixed. D-8 left section 10. Coverage recorded for `bf2124d`. | Sections 7, 8, 10 |
| 15 | D-9 fixed: every id a tool places in a request path must be one or more ASCII letters or digits, recorded as R30 with its source, Todoist's API v1 reference, checked 2026-09-25. `assertPathId` in `src/client.js` is the single validator. `update-tasks`, `complete-tasks`, `uncomplete-tasks` and `reschedule-tasks` check every id before the first request, so one bad id refuses the whole batch. `request()` also refuses a path that URL parsing would change or that has an empty segment. Test-first `bbbdd0c`, implementation `24b7e06`. `test/d9-path-id.test.js` runs D-9's reproduction inputs and 20 refused forms against each of the four tools. For the bug class, a static check fails on any `request()` or `getPaginated()` path in `src/` that interpolates anything but `assertPathId(...)`; it found the four known sites and no others. The hyphenated ids in two read-tool fixtures were left as they are because they never reach a request path. D-18 updated. D-9 left section 10. Coverage recorded for `24b7e06`. | Sections 6, 7, 8, 10 |

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
- **No two-agent confirmation gate exists.** There is no mechanism anywhere
  in this codebase that pauses a write for human confirmation. A single
  agent process, if configured with `TODOIST_READONLY=false`, can execute a
  write the instant the model emits the tool call. See AD-1 for why this is
  not this codebase's job to build, and what would actually implement it.
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

- The agent definition that launches this server in the consuming project
  sets `TODOIST_READONLY: "false"` in its frontmatter `env` block. Mode is
  therefore fixed per agent definition, not per request.
- Nothing in this codebase, and nothing in the invoking layer as currently
  configured, selects mode based on the content of the user's request. This
  server correctly enforces whichever mode it is started in and has no
  mechanism to change that mode at runtime.
- The intended design is that read-only is the default and write mode is
  used only when the user's own typed request actually calls for a change.
  That intent is not implemented anywhere today.
- Implementing it requires a launching environment that selects between a
  read-only and a write-capable definition per request. That selection is
  configuration in the consuming project, not code in this repository.

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
- This decision governs URLs that appear inside untrusted text fields. It
  never applied to the dedicated `url` field, which is not defanged but
  removed from tool output entirely. See AD-6.

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

### AD-5 — The agent definition in this repo is an example, not the live one

**Facts, established by direct inspection during Session 9:**

- A Claude Code subagent definition exists at two paths:
  `.claude/agents/todoist.md` in this repository, and
  `/workspace/projects/agent-os/.claude/agents/todoist.md` in the
  consuming project. As of Session 9 the two files were byte-identical
  and neither had been edited since July 21.
- Only the Agent OS copy is loaded by anything. Nothing reads the copy in
  this repository at runtime. Editing it has no runtime effect.
- The repository copy launched write-capable, with
  `TODOIST_READONLY: "false"` in its frontmatter `env` block, and
  contained a personal deployment path and a personal identifier.
- Nothing synchronises the two files. There is no mechanism that would
  detect them diverging, and no marking on either that says which is
  authoritative.

**Decision:**

- The copy in this repository is an example. It lives at
  `docs/examples/todoist-subagent.md`, outside `.claude/agents/`. It uses
  placeholder paths and carries no personal identifiers. The explanation
  of what it is lives beside it in `docs/examples/README.md`, not inside
  the file.
- The definition that actually runs lives in whatever project consumes
  this server. This repository ships the server, not a deployment of it.
- The example launches read-only by omitting `TODOIST_READONLY`
  entirely, rather than by setting it to `"true"`.
- The example is documentation. It is deliberately not kept in sync with
  any live definition, and no process should assume it is.

**Rationale:**

- Two byte-identical copies with no synchronisation is a drift hazard. If
  someone edits either one, the other silently disagrees and nothing
  reports it. This is the same shape of problem as the two server
  directories described in `docs/RESUME.md` section 2, at smaller scale.
  Naming one copy the example removes the ambiguity rather than trying to
  keep the copies equal.
- Omitting `TODOIST_READONLY` demonstrates the fail-safe default that
  R1 and Invariant 8 specify. Setting `"true"` would produce the same
  read-only process but teach the wrong rule: it invites a reader to
  conclude that the value is what makes the process read-only, and
  therefore that unsetting the variable enables writes. The actual rule
  is that writes require the exact string `"false"` and every other
  value, absence included, is read-only. An example is a claim about how
  the thing works, so it should be true in the way it is read, not only
  in its result.
- Personal deployment paths and personal identifiers do not belong in a
  repository intended for publication.
- The example does not live in `.claude/agents/`. Claude Code loads
  subagent definitions from that directory, and its published behavior is
  to skip a file whose opening `---` is not the first line, reading it as
  having no frontmatter, treating it as documentation, and reporting
  nothing in the session. An earlier draft of this example relied on that
  rule: a comment block above the frontmatter made the file inert. Two
  things are wrong with relying on it. Deleting four comment lines
  silently converts the file into a live subagent pointing at placeholder
  paths. And a reader who copies the file as a template, comment
  included, gets a subagent that never loads and is never told why. A
  file outside `.claude/agents/` is inert because of where it is, which
  requires no rule to keep holding.
- The explanation does not live in the file's body either. The body of a
  subagent definition becomes the agent's system prompt, so a reader who
  copies the file would inherit "EXAMPLE ONLY, this file does not run" as
  live instructions to the agent.

**Consequences:**

- AD-1 established that mode selection belongs to the agent layer. AD-5
  is the file-level consequence: the artifact that makes that selection
  is not in this repository, and changing the example does not change any
  running agent's mode.
- The example must remain honest about the server's actual behavior, not
  merely non-personal. It names real environment variables and real tool
  names. It carries no defect warnings at present: its D-1 and D-2
  warnings were removed when those defects were fixed in Session 10.
  When a defect in section 10 affects what an agent should trust in tool
  output, the example carries an agent-facing warning for it. Those
  warnings are part of each defect's fix criteria: when a defect in
  section 10 is fixed, removing its warning from the example is part of
  fixing it.
- The example is read-only, so its body text describes a process with no
  write tools registered. A write-capable definition is not a matter of
  flipping one env value; it needs its own body text, because a read-only
  process registers no write tools at all and the body would otherwise
  describe capabilities that do not exist.
- Verifying the frontmatter format surfaced a constraint this spec had not
  recorded. An inline MCP server declared in subagent frontmatter is
  connected when the subagent starts and disconnected when it finishes,
  while a frontmatter entry that is a bare string naming an
  already-configured server shares the parent session's connection
  instead. The posture described in AD-1 and Invariant 8, where mode is
  fixed for the lifetime of a process, assumes the former. A deployment
  that defines this server in `.mcp.json` and references it by name from
  the frontmatter gets one long-lived process for the whole session, so
  its mode is decided once at session start rather than once per
  invocation. The example uses an inline definition for this reason.
  `README.md` does not state this constraint and must.

**Rejected alternatives:**

- **Delete the repository copy.** Rejected. This server's security
  posture depends on how it is launched, so a worked example of a correct
  launch is load-bearing documentation, not decoration. Deleting it
  leaves a reader to infer the frontmatter shape and the env contract
  from prose.
- **Keep the repository copy as the live definition and have Agent OS
  point at it.** Rejected. It couples the consuming project to a path in
  this one, and the live definition needs real deployment paths and a
  real token location, which are exactly the contents that must not be
  published.

**Resolved, previously open.** Whether the subagent frontmatter format the
example uses is still current was verified against Anthropic's published
Claude Code subagent documentation on 2026-09-15. The format holds:
`mcpServers` takes a list whose entries are either an inline server
definition keyed by server name or a bare string naming an
already-configured server; inline definitions use the same schema as
`.mcp.json` entries and support `stdio`; and both `tools` and
`disallowedTools` accept server-level patterns such as `mcp__todoist__*`.
This is a product convention rather than a specification, so it can change
without notice and should be re-verified before publishing.

### AD-6: The `url` field is removed from tool output, not guarded

**Facts:**

- A live read of the real account's `GET /tasks` and `GET /projects` on
  2026-09-23 returned HTTP 200 for both. The read sampled up to three
  tasks and up to three projects and searched each response for a url
  written as a string. None was found: no url value was returned in the
  sample. A `url` field present with a null value would not have matched,
  so the read does not establish that the field is absent, only that it
  carried no url. This is consistent with section 9's observation of
  `POST /tasks/{id}`, whose 28 returned fields include no `url`. The read
  was performed directly by the operator, outside any test in this
  repository, so section 9's contract-test methodology was not applied
  to it.
- Doist's official TypeScript SDK (`Doist/todoist-api-typescript`,
  checked at commit `19798a3` on 2026-09-23) does not read a url from the
  API. It builds task and project urls client-side from the id and the
  task's title or the project's name, through `getTaskUrl(id, content)`
  and `getProjectUrl(id, name)`. Its own tests expect slugged forms such
  as `https://app.todoist.com/app/task/buy-groceries-12345` and
  `https://app.todoist.com/app/project/work-project-67890`. Task titles
  and project names are attacker-writable under section 2.
- A search of `src/` for fields emitted without `safeField` or
  `defangUrl` found three sites passing a url to the agent raw:
  `shapeTask`, `shapeProject`, and the `add-tasks` echo in
  `src/tools/write.js`. D-5 had named only the first. Given the first
  fact, none of the three emitted a url value at the time.

**Decision:**

- No tool output carries a `url` field. All three sites are removed.
  Anything Todoist later returns under that name is dropped at this
  server rather than passed through.

**Rationale:**

- Removal closes the class instead of guarding one instance of it. A
  guard keeps alive a field for which no url value has been observed and
  whose content-derived form is built from attacker-writable text.
- Nothing a caller receives today is lost, because no url value was
  returned in any response observed.

**Rejected alternative:**

- The strict-pattern guard recorded in D-5's fix criteria earlier on
  2026-09-23, in commit `ded2f24`: pass a url through only if it is
  exactly `https://app.todoist.com/app/task/` followed by ASCII letters or
  digits, and route everything else through `safeField`. Rejected for
  four reasons. It guards a field for which no url value has been
  observed, so its matching branch would not run against the data seen
  so far. It covered only
  `shapeTask`, leaving `shapeProject` and the `add-tasks` echo, which the
  class search found. Covering projects needs a second pattern, and each
  pattern is an allowlist that must stay correct as Todoist's url formats
  change, which they have done more than once: from a query string to
  numeric path ids to alphanumeric ids. And its non-matching
  branch would still hand the agent a framed, defanged copy of
  attacker-derived text, where removal hands it nothing.

**Relation to AD-2:** AD-2 governs URLs inside untrusted text fields,
which are defanged. This decision governs the dedicated `url` field,
which is removed. The two do not overlap.

**Evidence:**

- `test/url-removed-from-tool-output.test.js`: `shapeTask` and
  `shapeProject` emit no `url` key when the input carries a bare-id or
  slugged url, and the `add-tasks` echo carries no `url` key when the
  created object has one. Each case feeds an input that does carry a url,
  since an input without one would pass against the old code.
- `test/no-url-key-in-output.test.js`: static tripwire that fails on any
  `url:` object-literal key in `src/shape.js` or `src/tools/`, reporting
  each site by file and line. Deliberately narrow: shorthand `{ url }`,
  computed keys and spreads of raw API objects are not caught.
- `test/invariant4-todoist-allowlist.test.js`: the `find-tasks`
  regression check requires that the tool succeeded and returned fixture
  task `999` with its framed content, and only then that the task carries
  no `url` key and no task url survives. Until `6a99b01` it asserted
  only the absences, so a tool error satisfied it (D-12). Proven capable
  of failing by replacing the `find-tasks` handler with one that throws:
  the check fails on its success assertion.
- `test/calltool-asserts-iserror.test.js`: static check that fails on
  any test in `test/` that calls `callTool` and never asserts on
  `isError`, so that an error result cannot satisfy a test whose other
  assertions are absences. It also runs its detector on a planted
  absence-only test. A regex over top-level blocks, not an AST parse.
- Test-first commit `4894671`, in which all eight of these checks failed
  on the missing-key assertion and the tripwire reported all three
  sites. Implementation commit `25c63e1`, in which the suite went to 79
  of 79. Before `25c63e1`, the three removals were applied to a scratch
  copy to confirm these tests pass on exactly that change and that the
  tripwire flags nothing else.

## 5. Invariants

Each invariant below is a statement that should be mechanically checkable
against the whole codebase (e.g. "no file matching X imports/does Y"), not
about one function. Status reflects the security review and behavior
inventory as of this writing.

**Status** is a claim about the codebase: does the invariant hold right
now. **HOLDS** means no counterexample is known. **VIOLATED** means a
counterexample has been reproduced; the row names the defect in section 10
that records it and the scope in which the invariant still holds, if any.
A qualified HOLDS names the case it does not cover. **Evidence** is a
separate claim about how that is known. The two
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
| 1 | Every read-tool response is passed through `safeField`/`stripMarkup` framing before being returned to the caller. | **VIOLATED** on error responses (D-7). Holds for success responses. | **TESTED** (`find-projects`) / **INSPECTED** (six remaining read tools) | `test/mcp-e2e.test.js` — `'read tool output is framed and strips markup; token never leaks'`, which asserts the echoed project name matches exactly what `safeField` produces. Proven capable of failing by replacing `shapeProject`'s `safeField` call with `stripMarkup`, which failed this assertion alone. Proves `find-projects` routes through the framing helper; it does not prove the helper frames correctly, which is `test/sanitize.test.js`'s job. Remaining read tools covered by inspection of the shapers in `src/shape.js`. Behavior inventory §4–5, §8; review "Also checked" §3 |
| 2 | Every write-tool response is passed through the same framing/stripping as read tools before being returned to the caller. | **VIOLATED** on error responses (D-7). Holds for success responses. | **TESTED** (`update-tasks`) / **INSPECTED** (four write tools framing an echoed field) / n/a (four echoing no Todoist-origin text, see AD-4) | `test/mcp-e2e.test.js` — `'write tool echoes framed/stripped/capped content, exactly as a read tool would (update-tasks, Invariant 12/2)'`, specifically its assertion comparing against the exact output `safeField` produces. Proven capable of failing during Session 9 by replacing the `update-tasks` handler's `safeField(updated?.content, cfg.maxFieldChars)` call with `stripMarkup(updated?.content)`: the suite went to 71 of 72 with the failure confined to this test, and within it to the `safeField`-comparison assertion alone, while the three surrounding stripping assertions and the read-path framing test all stayed green. Reproducing this break requires widening the module's import to include `stripMarkup`. Without it the handler throws a `ReferenceError` that its own `try`/`catch` converts into an `isError` result, and the test fails on a different assertion for the wrong reason, which would look like confirmation while proving nothing. This assertion does not pin `cfg.maxFieldChars` plumbing; see section 8. |
| 3 | Every error message that reaches a tool's `isError` response has passed through `redact()`. | **HOLDS** | **UNGRADED** | `test/mcp-e2e.test.js` — `'a plain Error (not TodoistApiError) thrown mid-handler never leaks the registered secret — read tool'` and `'— write tool'` |
| 4 | No tool output contains a URL in re-parseable or clickable form, regardless of the syntax used to embed it in the source text. | **VIOLATED** (D-6, D-7). `stripMarkup` reassembles a live `http://` URL from split link syntax and leaves `ftp://`, letter-prefixed `https://` and bare `www.` hosts untouched; error responses carry upstream URLs unstripped. | **UNGRADED** | `test/invariant4-url-embedding.test.js`, `test/invariant4-todoist-allowlist.test.js` — URLs are defanged (scheme broken to `hxxp`/`hxxps`, dots bracketed) rather than deleted, applied uniformly to every host with no allowlist or exemption. The dedicated `url` field is not an exemption: it is removed from tool output entirely (AD-6), covered by `test/url-removed-from-tool-output.test.js` and `test/no-url-key-in-output.test.js`. Those two were watched to fail before the removal, but the defanging tests above have not been graded, so the row stays UNGRADED. The `find-tasks` regression check in `test/invariant4-todoist-allowlist.test.js` requires success and the returned fixture task before asserting the `url` key absent, and fails when the handler throws (fixed in `6a99b01`, D-12). `test/calltool-asserts-iserror.test.js` fails on any test that calls `callTool` without asserting on `isError`. |
| 5 | Every outbound HTTP request target, including any redirect target, is validated against the SSRF allowlist before the request is sent. | **HOLDS** | **UNGRADED** | `test/invariant5-redirect-ssrf.test.js` — the invariant is now satisfied by refusing all redirects rather than by re-validating redirect targets, so no second URL is ever contacted |
| 6 | No tool-registration path exposes write tools when `TODOIST_READONLY` is not exactly `"false"`. | **HOLDS** through the shipped entry point, `src/index.js`, which builds the config with `loadConfig`. Does not cover a direct `createServer` call whose config omits `readOnly`, which registers all nine write tools (D-19). | **UNGRADED** | Behavior inventory §1, §7; `test/registration.test.js` |
| 7 | No tool in this server can delete, reorder, reassign, or manage reminders/filters/workspace-analytics objects. | **HOLDS** | **UNGRADED** | Behavior inventory §9; `test/registration.test.js` — forbidden-name list enforced exhaustively |
| 8 | The server exposes write tools if and only if it was started with `TODOIST_READONLY` set to exactly `"false"`; this is decided once at startup, before any Todoist content is read, by not registering those tools at all, and cannot be changed for the lifetime of the running process. | **HOLDS** through the shipped entry point, `src/index.js`. Does not cover a direct `createServer` call whose config omits `readOnly` (D-19). | **UNGRADED** | `test/registration.test.js` — `'read-only mode registers only the 7 read tools, no writes'`, `'read/write mode registers the full 16-tool set'`; behavior inventory §1, §7. (Per-request mode selection and human confirmation are out of scope for this invariant — see AD-1.) |
| 9 | No log line emitted by `src/logger.js` contains the raw, unredacted API token. | **HOLDS** for tokens of 4 or more characters. `loadConfig` accepts shorter tokens and `registerSecret` never registers them (D-17). | **UNGRADED** | Behavior inventory §2–3, §6 (tested); review "Also checked" §3 — logger redacts every line, `client.js` never logs headers/bodies |
| 10 | No error thrown or returned by any tool handler in `src/` contains the raw, unredacted API token, regardless of where the error originates. | **HOLDS** for tokens of 4 or more characters. A shorter token is accepted by `loadConfig`, never registered, and leaks in an API error (D-17). | **UNGRADED** | `test/mcp-e2e.test.js` — `'a registered secret appearing in normal (non-error) API content never leaks — read tool (Invariant 10)'` (covers the success path: the shared result builder applies `redact()` to all outgoing text, not only error text), plus the two plain-Error tests (`'a plain Error (not TodoistApiError) thrown mid-handler never leaks the registered secret — read tool'` / `'— write tool'`, covering the error path). `test/client.test.js`, `'API error text never leaks the token'`, registers a 40-character token, has the API echo it in a 401 body, and asserts the token is absent from the thrown error's message. Proven capable of failing by replacing `redact(detail)` with `detail` in `src/client.js`'s error message, which failed the token assertion (`6a99b01`, D-12). It tests the client, not a tool handler, and registers the token itself because `createClient` does not (D-17). The other tests cited here have not been graded, so the row stays UNGRADED. |
| 11 | `API_BASE` / outbound hostname is a fixed literal, never derived from any tool input. | **HOLDS** | **UNGRADED** | Behavior inventory §6; review Finding 5 discussion ("the host is hardcoded... never derived from any tool argument") |
| 12 | No tool result object — success or error, read or write — is constructed anywhere in `src/` except by passing its payload through a single designated result builder shared by all sixteen tools. Tools may pass different payloads to it; there is no second sanitization path. | **HOLDS** | **UNGRADED** | `test/result-builder-shape.test.js` — `'Invariant 12: a tool result object is constructed in exactly one place in src/, never ad hoc per tool'`. The check is by object shape (any `{ content: [{ type: 'text', ... }] }`-shaped literal outside the one designated builder function), not by function name. Verified by deliberately introducing a violating tool and confirming the test caught it at the exact line. The invariant holds, but it does not mean every result is sanitized: the builder's error branch only redacts (D-7). The shape check misses `{ content: blocks }`, computed keys and a builder result modified afterwards (D-22). |

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
| `find-tasks` | R | `query`, `project_id`, `section_id`, `label`, `parent_id`, `ids[]`, `limit` | `id`, `content`✅, `description`✅, `project_id`, `section_id`, `parent_id`, `priority`, `labels[]`✅, `due.{date,datetime,timezone,is_recurring}`, `due.string`✅, `deadline`, `is_completed`, `created_at`, `completed_at` |
| `find-tasks-by-date` | R | `preset`, `date`, `comparison`, `limit` | same task fields as `find-tasks`, plus computed `filter` (server-built query string, not echoed) |
| `find-projects` | R | `limit` | `id`, `name`✅, `parent_id`, `is_inbox_project`, `is_favorite`, `is_archived`, `color`, `view_style` |
| `find-sections` | R | `project_id`, `limit` | `id`, `name`✅, `project_id`, `order` |
| `find-labels` | R | `limit` | `id`, `name`✅, `color`, `is_favorite`, `order` |
| `find-comments` | R | `task_id` XOR `project_id`, `limit` | `id`, `content`✅, `task_id`, `project_id`, `posted_at`, `attachment.file_name`✅ (URL/mime/size dropped) |
| `get-overview` | R | *(none)* | In output order: `fetches.{projects,sections,labels,tasks,due_today,overdue}.{fetched,truncated}` (computed); `warnings[]` (computed, present only when a fetch was truncated); `totals.{projects,active_tasks,labels,due_today,overdue}`, each `{count,is_floor}` (computed; `is_floor` is the `truncated` flag of the fetch the count derives from; `due_today` and `overdue` are the counts of Todoist's `today` and `overdue` filters via `GET /tasks/filter`, evaluated in the account's timezone and including tasks with no scheduled date whose deadline is today or past); `tasks_in_unlisted_projects` `{count,is_floor}` (computed); `unmatched_sections[].{project_id,name✅}`; `labels[]` (names✅ only, no ids); `projects[].{id,name✅,is_inbox_project,active_task_count {count,is_floor},sections[] (names✅)}` |
| `add-tasks` | W | `tasks[]`: `content`, `description`, `project_id`, `section_id`, `parent_id`, `labels[]`, `priority`, `due_string`/`due_date`/`due_datetime`, `deadline_date` | `id`, `content`✅ |
| `update-tasks` | W | `tasks[]`: `id`, `content`, `description`, `labels[]`, `priority`, `due_string`/`due_date`/`due_datetime`, `deadline_date` | `id`, `content`✅ (reflects full current API state, not necessarily caller-supplied; `description` and `labels` are returned by the API and discarded rather than echoed) |
| `complete-tasks` | W | `ids[]` | `ids[]` (caller-supplied, echoed back as-is, not from API) |
| `uncomplete-tasks` | W | `ids[]` | `ids[]` (caller-supplied, echoed back as-is, not from API) |
| `reschedule-tasks` | W | `tasks[]`: `id`, one of `due_string`/`due_date`/`due_datetime` | `id` only (caller-supplied; no content/text echoed) |
| `add-comments` | W | `comments[]`: `content`, `task_id` XOR `project_id` | `id` only (no content echoed) |
| `add-projects` | W | `projects[]`: `name`, `parent_id`, `color`, `is_favorite`, `view_style` | `id`, `name`✅ |
| `add-sections` | W | `sections[]`: `name`, `project_id`, `order` | `id`, `name`✅ |
| `add-labels` | W | `labels[]`: `name`, `color`, `is_favorite`, `order` | `id`, `name`✅ |

✅ = passed through `safeField` (framed, stripped, truncated).

No mark on `id` = a structural field Todoist generates. No endpoint in the
v1 API accepts a caller-supplied id, so nobody who can write task content
can put chosen bytes in this field. Raw passthrough on both paths:
`shapeTask` emits `id` unchanged, and so do the other shapers.

Every id a tool places in a request path must be one or more ASCII
letters or digits (R30). That covers the `id` of `update-tasks` and
`reschedule-tasks` and the `ids[]` of `complete-tasks` and
`uncomplete-tasks`. Any other id is refused before any request, and one
bad id refuses the whole batch. Ids the read tools send as query
parameters, and ids the write tools send in a request body, are not in a
path and are not restricted by R30 (D-18).

No tool's output carries a `url` field. `shapeTask`, `shapeProject` and
the `add-tasks` echo once passed one through raw. All three are removed,
and anything Todoist returns under that name is dropped at this server.
See AD-6.

Finding 1's injection surface is closed. Every echoed field originating
as Todoist-writable text routes through `safeField` on both the read and
the write path. This table previously marked five such fields as
unsanitized; that was accurate to the pre-remediation code and stale as
of Session 9, confirmed by reading `src/tools/write.js`. Section 9's
live-API observation is unaffected: the API does return full current task
state on a partial update, and `update-tasks` now frames the `content` it
echoes and discards the `description` and `labels` it does not need.

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
  newline. A numeric entity whose code point is invalid (zero, a surrogate
  0xD800 to 0xDFFF, or above 0x10FFFF, including digit runs too large for
  a double) decodes to U+FFFD, as the HTML standard does for invalid
  numeric character references; valid numeric entities decode to their
  code point. `stripMarkup` and `safeField` must not throw for any string
  input (D-8, Session 14).
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
- **Done, Session 10.** The bare-array branch now reports truncated when
  the array came back at or above the requested page limit. The cursor
  path is unchanged. Evidence: `test/getpaginated-truncated-flag.test.js`,
  which also pins the cursor path's exact-cap boundary in both directions,
  previously untested. Implementation `cdd670f`, landed with D-1; see R24.
- R30. Every id placed in a request path must be one or more ASCII
  letters or digits (`^[A-Za-z0-9]+$`), checked by `assertPathId` in
  `src/client.js`, the only validator for path ids. Anything else is
  refused before any request is sent, including the empty string, `.`,
  `..`, slashes, backslashes, percent-encoded forms such as `%2e%2e`,
  whitespace, `?`, `#`, hyphens, underscores and non-ASCII digits. The
  refusal names the id's position (`tasks[0].id`, `ids[1]`) and does not
  echo the id. A tool that takes a batch checks every id before its first
  request. Independently, `request()` refuses a composed URL whose
  pathname differs from the path it was given, or that contains an empty
  segment.
- **DECIDED, Session 15.** Source of the pattern: Todoist's API v1
  reference, `developer.todoist.com/api/v1`, checked by the maintainer
  on 2026-09-25. Every example id in it is ASCII letters and digits, for
  example `6Jf8VQXxpwv56VQ7` and `6X7gfV9G7rWm5hW8`, with older numeric
  ids such as `2203306141` also shown. The only hyphenated ids there are
  `temp_id` values for the `/sync` command endpoint, which this server
  does not call. The check was not repeated in the session, because the
  docs site renders client-side (section 9). No live id has been
  recorded here: section 9's observation lists field names only. If
  Todoist issues an id outside this pattern, the four tools refuse it
  with a clear error rather than sending a wrong request, and this rule
  is revisited. Hyphenated ids in two test fixtures
  (`test/d8-invalid-numeric-entity.test.js`,
  `test/get-overview-truncation.test.js`) are invented values in stubbed
  read-tool responses; they never reach a request path and stay as they
  are. Evidence: `test/d9-path-id.test.js`.

### Server lifecycle
- R18. Read tools must register in every mode; write tools must register
  only when `cfg.readOnly` is falsy (config parsing resolves
  `TODOIST_READONLY` to a boolean, so writes register only when that
  boolean is `false`), as an entirely separate registration call (not a
  per-call runtime gate) — so in read-only mode, write tool names are
  absent from the server, not merely disabled.
- R19. The forbidden-tool list (delete, reorder, assignment, workspace/
  analytics, reminders, filters) must never be registered in either mode.
- R20. Config-load failure and any uncaught startup/runtime error must
  write a redacted message to `stderr` (never `stdout`) and exit with code 1.

### Read tools
- R21. `find-tasks` must route a non-empty `query` to `/tasks/filter`; when
  no query is given, `ids[]` must be joined into a comma-separated parameter
  against `/tasks`.
- **DECIDED, Session 10.** A non-empty `query` still replaces
  `project_id`, `section_id`, `label`, `parent_id` and `ids`: only the
  query is sent to `/tasks/filter`, and the others are not sent. Behavior
  is unchanged. What changed is the text the agent reads. The `find-tasks`
  description and those five fields' `.describe()` text now state that a
  non-empty `query` replaces them; that a project, section or label is
  combined with a query by putting it in the query by name (`#Project`,
  `/Section`, `%label`); and that `parent_id` and `ids` cannot be
  expressed in a query, so `query` must be omitted to filter by them.
  Rejecting the combination as a validation error was considered and
  deferred, because it is a behavior change.
  The query-syntax facts come from Todoist's help article "Introduction to
  filters" (last updated 2026-09-04), checked 2026-09-23: projects,
  sections and labels are selectable by name, not id; there is no syntax
  for the subtasks of a specific parent task (only `subtask` and
  `!subtask`) or for task ids, and the article treats anything it does not
  list as unsupported. The same article says the `@` label syntax is
  planned for retirement by the end of 2026, which is why the description's
  example uses `%next` rather than `@next`.
  Evidence: `test/find-tasks-query-supersedes-description.test.js` reads
  the text from a running server's `tools/list` response over stdio and
  fails if any of the six strings stops saying this. Test-first commits
  `35fb240` and `fc67322`, implementation `3d1f86b`. This was D-3 in
  section 10, confirmed in Session 9.
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
- R24. `get-overview` must fetch projects/sections/labels/tasks and the
  `today` and `overdue` filters concurrently, and fail entirely (no
  partial results) if any one fetch rejects.
- **Superseded, Session 9.** Confirmed as a defect and scheduled. See
  section 10, D-2.
- **DECIDED, Session 10.** Fix for D-1, formerly in section 10. The
  tasks fetch uses a fixed ceiling, `OVERVIEW_MAX_ITEMS = 5000` in
  `src/tools/read.js`, a constant rather than an environment variable.
  Projects, sections and labels keep `TODOIST_MAX_ITEMS`. The split
  follows what each fetch sends to the agent. Tasks are only counted and
  no task text is returned, so counting more of them does not widen the
  untrusted text that reaches the agent. Project, section and label names
  are returned, and they are attacker-writable text, so raising those
  caps would widen it; they keep the cap every other tool uses.

  Every count is `{ count, is_floor }`, where `is_floor` is the
  `truncated` flag of the fetch the count derives from. Below the caps
  counts are exact; above them each affected count is marked as a
  minimum. Per-fetch `{ fetched, truncated }` is reported under
  `fetches`. `warnings` is present only when a fetch was truncated, and
  the unconditional note is removed. Sections whose project is not in the
  projects fetch are listed in `unmatched_sections` instead of being
  dropped. Tasks in such projects had the same problem, counted in the
  total but under no project, and are now counted in
  `tasks_in_unlisted_projects`. Signal keys precede the name lists,
  because `capOutput` truncates from the end. The tool still takes no
  `limit` argument. Its description states the task ceiling, the normal
  cap on lists, and that `is_floor` marks a minimum.

  The R17 bare-array fix landed with this. Without it, a bare array would
  report a full page as complete, and a count derived from it as exact.
  Evidence: `test/get-overview-truncation.test.js`, whose shared guard
  fails if any count's `is_floor` differs from its fetch's `truncated`
  flag, and `test/getpaginated-truncated-flag.test.js`. Test-first commit
  `109f132`, implementation `cdd670f`. This was D-1 in section 10,
  confirmed in Session 9. D-2, "today" computed in UTC, is a different
  root cause and is not affected.
- **DECIDED, Session 10.** Fix for D-2, formerly in section 10.
  `get-overview` no longer computes "today" on the server host.
  `due_today` and `overdue` are the item counts of `GET /tasks/filter`
  with query `today` and query `overdue`, Todoist's own filters,
  evaluated in the Todoist account's timezone. No date comparison against
  the host clock remains and the server holds no timezone, so no
  environment variable or per-request parameter supplies one. Floating
  due dates and datetimes carrying their own timezone are Todoist's to
  resolve, not this server's.

  The counts mean what Todoist's filters mean, including tasks with no
  scheduled date whose deadline is today or past. This is deliberate: the
  overview matches the Todoist app rather than a stricter reading based
  on scheduled dates alone.

  Both filter fetches use `OVERVIEW_MAX_ITEMS`, like the tasks fetch,
  because they are only counted and return no task text. Each is reported
  under `fetches` as `due_today` and `overdue`, and each count takes
  `is_floor` from its own fetch, not from the tasks fetch. A truncated
  filter fetch adds its own warning, and the tasks-fetch warning no
  longer names these two counts. The tool description lists
  `/tasks/filter` among the endpoints it aggregates and says the two
  counts come from Todoist's `today` and `overdue` filters in the
  account's timezone.

  Evidence: the D-2 tests in `test/get-overview-truncation.test.js`. They
  count what the fake API returns for each query regardless of the tasks'
  own dates, assert that exactly the queries `today` and `overdue` are
  sent, and check each filter fetch's `fetches` entry and `is_floor`
  separately, including a truncated filter fetch that marks only its own
  count as a floor. Test-first commits `66926e0` and `ad33081`,
  implementation `0a5ab95`. This was D-2 in section 10, confirmed in
  Session 9.
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

Session 10, at commit `25c63e1` (D-5 fix), measured the same way on Node
v20.20.2:

| | Lines | Branches | Functions |
|---|---|---|---|
| All files | 90.85% | 87.46% | 87.29% |

Line coverage is 0.23 points below the preceding test-first commit
`4894671` (91.08%). The dip is mechanical, not lost coverage: `25c63e1`
deleted three lines that were covered, which lowers covered lines as a
share of the total, while the uncovered lines are the same lines as
before, shifted up. No line lost coverage. Branch and function coverage
are unchanged from `4894671`, and all three figures are above the
post-Session-7 row. `src/tools/write.js` function coverage is unchanged
at 38.46%.

Session 10, at commit `cdd670f` (D-1 and R17 fix), measured the same way
on Node v20.20.2:

| | Lines | Branches | Functions |
|---|---|---|---|
| All files | 94.82% | 89.28% | 91.43% |

All three figures are above the `25c63e1` row. `src/tools/read.js` rose
from 77.40% / 76.92% / 71.43% at the test-first commit `109f132` to
80.82% / 84.62% / 75.00%. `src/tools/write.js` function coverage is
unchanged at 38.46%.

Session 10, at commit `0a5ab95` (D-2 fix), measured the same way on
Node v20.20.2:

| | Lines | Branches | Functions |
|---|---|---|---|
| All files | 95.12% | 90.15% | 92.08% |

All three figures are above the `cdd670f` row, and no file in `src/` or
`test/` is below its figure at `0fce65b`, which matched `cdd670f`.
`src/tools/read.js` rose from 80.82% / 84.62% / 75.00% to 81.40% /
86.84% / 75.00%. The test-first commit `66926e0` dipped to 94.67% /
88.48% / 90.57%: lines in the new tests after their first failing
assertion could not run, and three fallback operators in
`test/get-overview-truncation.test.js` could run only when a test was
already failing, which put that file's branch coverage at 94.87%
against 97.83%. `ad33081` removed the three fallbacks without changing
any expectation, and the file is now at 98.67%. `src/tools/write.js`
function coverage is unchanged at 38.46%.

Session 12, at commit `6a99b01` (D-12 fix), measured the same way on
Node v20.20.2:

| | Lines | Branches | Functions |
|---|---|---|---|
| All files | 95.29% | 90.32% | 92.39% |

All three figures are above the `0a5ab95` row, and no file present at
`4f4547c` changed its figures; the rise comes from the new
`test/calltool-asserts-iserror.test.js`. A first version of that file,
never committed, lowered branches to 90.11% and functions to 91.91%,
because its reporting code ran only when it found an offender. A test
that runs the detector on a planted source now exercises that code.
The commit changes tests only. `src/tools/write.js` function coverage is
unchanged at 38.46%.

Session 13, at commit `9d4bd71` (D-11 fix), measured the same way on
Node v20.20.2:

| | Lines | Branches | Functions |
|---|---|---|---|
| All files | 95.58% | 90.86% | 92.88% |

All three figures are above the `6a99b01` row. No file present at
`193257a` changed its figures; the rise comes from the two new test
files, `test/live-smoke-date-account-guard.test.js` and
`test/live-write-paths-guarded.test.js`. The test-first commit `e96d3fe`
measured 95.58% / 90.84% / 92.54%, also above `6a99b01`: a callback in
the new behavioral test could not run while the assertion before it
failed. The commits change tests and `scripts/` only.
`src/tools/write.js` function coverage is unchanged at 38.46%.

Session 14, at commit `bf2124d` (D-8 fix), measured the same way on
Node v20.20.2:

| | Lines | Branches | Functions |
|---|---|---|---|
| All files | 96.20% | 92.19% | 94.15% |

All three figures are above the `9d4bd71` row, which `cf3e367` matched
(95.58% / 90.86% / 92.88%), and no file present at `cf3e367` lost
coverage. `src/sanitize.js` branches rose from 83.33% to 86.67%, and
`src/shape.js` rose from 84.04% / 43.75% / 75.00% to 100.00% / 84.00% /
100.00%, because the new bug-class test drives every shaper through
every framed field. The test-first commit `be91ced` measured 96.23% /
93.11% / 93.52%: the new test file's offender-reporting paths ran only
while the tests were failing, and the implementation stopped them
running. `src/tools/write.js` function coverage is unchanged at 38.46%.

Session 15, at commit `24b7e06` (D-9 fix), measured the same way on
Node v20.20.2:

| | Lines | Branches | Functions |
|---|---|---|---|
| All files | 96.91% | 92.76% | 95.17% |

All three figures are above the `bf2124d` row, which `32b1560` matched
(96.20% / 92.19% / 94.15%), and no file present at `32b1560` lost
coverage. `src/client.js` rose from 96.47% / 86.96% to 97.12% / 89.47%
lines and branches, and `src/tools/write.js` from 84.11% / 87.50% /
38.46% to 89.76% / 92.31% / 76.47%, because the new tests drive
`complete-tasks`, `uncomplete-tasks` and `reschedule-tasks` for the first
time. The test-first commit `bbbdd0c` measured 96.40% / 91.95% / 94.28%,
with branches below `32b1560`: lines in the new tests after their first
failing assertion could not run. `src/tools/write.js` function coverage
is now **76.47%**.

Child-process coverage. `test/live-smoke-date-account-guard.test.js`
runs `scripts/live-smoke-date.js` as a child process. When
`NODE_V8_COVERAGE` is set, Node's `child_process` copies it into a
child's environment if the key is missing, so deleting it from the
child's environment does not stop the child reporting coverage. A first
version of the test, never committed, merged the script into these
figures at 50.47% lines and pulled All files down to 93.22% / 88.08% /
91.48%. That was a change in what was measured, not coverage lost from
any existing file. The test now points `NODE_V8_COVERAGE` at its own
temporary directory, which it deletes, so these figures cover `src/`
and `test/` only, like every row above. Scripts are not measured. Any
later test that spawns a Node process must do the same, or its row is
not comparable with this one.

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

**DECIDED, Session 9.** A test fixture that sets a configuration value
equal to the implementation's own fallback cannot detect that the value
stopped being plumbed through. Demonstrated during Session 9: the
`update-tasks` framing test in `test/mcp-e2e.test.js` sets
`maxFieldChars: 2000`, and `safeField` falls back to `maxFieldChars ??
2000`, so removing the `cfg.maxFieldChars` argument from the handler's
`safeField` call left the suite green at 72 of 72. Both sides of the
comparison moved together.

Fix it as a bug class, not as one fixture. A later session must audit
every fixture in `test/` for a configured value that collides with the
implementation default, covering at least `maxFieldChars` (2000),
`maxOutputChars` (50000) and `maxItems` (200), and change each colliding
fixture to a value that diverges from its default.

This is a test-evidence defect, not a code defect. The code is correct and
Invariant 2 holds; what is missing is the suite's ability to notice one
specific regression. It is recorded here rather than in section 10, which
holds defects in the code, and it does not gate publishing.

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

### Items raised during Session 8, both closed in Session 9

1. **`UNTRUSTED_NOTICE` scope.** R25 stated that every READ-tool response
   is prefixed with `UNTRUSTED_NOTICE`, while Invariant 2 stated that
   write-tool responses receive the same framing and stripping as read
   tools without saying whether the notice itself reaches write output.
   Observed directly during Session 8: the `add-tasks` response carried
   the notice. **Closed.** R25 was understated, not wrong. The notice is
   prepended unconditionally in `buildResult` to every response from all
   sixteen tools. AD-4 records the decision and its accepted cost; R25 is
   restated to match.
2. **Tool output consumers may hold stale assumptions.** The
   `UNTRUSTED_NOTICE` prefix broke `scripts/live-smoke.js`, which had
   parsed tool output as bare JSON since before remediation. That script
   was fixed in Session 8. **Closed here as an Agent OS handoff.**
   Whether anything else in Agent OS parses this server's tool output as
   bare JSON is not a question this repository can answer and is not a
   gate on work here. It is recorded with the other Agent OS items in
   `docs/RESUME.md`.

## 10. Confirmed Defects, Scheduled

Places where the code does not do what section 7 requires, or where it does
something a caller would not reasonably expect from the tool's own
description, or where a control's correctness rests on an assumption about an
external system that nothing verifies. These are distinct from the decisions recorded in section 4 and
from the `DECIDED` entries in section 7: nothing here was chosen. Each was
confirmed by reading the code during Session 9 and is scheduled rather than
resolved.

An entry leaves this section when the defect is fixed and a test exists that
fails if it returns.

**D-6 onward.** These come from an independent code review dated
2026-09-24, kept verbatim at
`docs/reviews/2026-09-24-independent-code-review.md`. The reviewer was
given `src/`, `test/`, `test-contract/` and `scripts/`, and not this spec,
`README.md` or `docs/RESUME.md`. Unlike D-1 to D-5, some entries here are
defects in tests or in the live scripts, not in `src/`. They are recorded
here because they make a published claim false or leave a gating claim
without evidence. The section 8 fixture-default entry predates this and
stays where it is. Each entry says how it was confirmed: **Reproduced**
means run against a scratch copy of `04c46ec` on 2026-09-24, with the
exact input and output given; **by reading** means established from the
code only; **review only** means taken from the review and not checked
again.

**Publication gate.** D-6 through D-12 gate publication; D-8, D-9, D-11
and D-12 are fixed. D-13 through D-22 do not. While D-6, D-7 or D-10 is
open, `README.md`'s "Known defects" statement "No open defect affects
tool output" is false.

### D-1

Fixed in Session 10 by counting tasks up to a fixed 5000 and marking every count from a truncated fetch as a floor; see section 7, R24. This number is retired, not reused.

### D-2

Fixed in Session 10 by counting `due_today` and `overdue` from Todoist's own `today` and `overdue` filters; see section 7, R24. This number is retired, not reused.

### D-3

Fixed in Session 10 by correcting the `find-tasks` description text; see section 7, R21. This number is retired, not reused.

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

### D-5

Fixed in Session 10 by removing the `url` field from tool output; see AD-6. This number is retired, not reused.

### D-6: Defanging can be undone, and three URL forms are never defanged

**Gates publication.** **Reproduced.** Review property 15.

`stripMarkup` defangs `https?://` matches first and removes inline
Markdown link syntax afterwards, so link removal can join pieces into a
live URL the defanging pass never saw. Separately, the defanging pattern
matches only `http` and `https`, only at a word boundary, and only with a
scheme, so other schemes, a scheme preceded by a letter, and a bare
`www.` host are left alone.

Reproduction, `stripMarkup` input to output:

| Input | Output |
|---|---|
| `ht[tp](x)://evil.example/path` | `http://evil.example/path` |
| `www.evil.example/path` | `www.evil.example/path` |
| `[www.evil.example/path](https://www.evil.example/path)` | `www.evil.example/path` |
| `ftp://evil.example/path` | `ftp://evil.example/path` |
| `xhttps://evil.example/path` | `xhttps://evil.example/path` |

The first output is a live `http://` URL that the sanitizer itself built.
The second and third leave a bare `www.` host with unbracketed dots, the
form `defangUrl`'s own comment calls autolinkable. The review's text gives
the second input as the bare host; the session prompt that delivered the
review carried it as the third, link-wrapped form. Both were run. Every
field that goes through `safeField`, read and write, is affected.

**Claims this makes false:**

- Invariant 4, now **VIOLATED**.
- `README.md`, "Freestanding URL defanging": "nothing clickable or
  re-parseable reaches the agent".
- `README.md`, "Markup stripping": the URL inside a Markdown link "never
  reaches tool output at all". The first input builds its URL out of link
  syntax.
- `src/sanitize.js`, the comment on the defanging pass: it "targets the
  outcome (no re-parseable or autolinkable URL survives)".

**Fix criteria:**

- The final output of `stripMarkup` contains no `scheme://` sequence for
  any scheme and no `www.` host with unbracketed dots. The check runs on
  the output after every pass that can join or reveal text (link removal,
  markup-character removal, control-character removal, whitespace
  collapse), not before them.
- Treated as a bug class: a neutralizing pass that runs before a pass
  that can join or reveal text. D-15's entity-encoded comment is another
  instance (comment removal runs before entity decoding). A test must fail
  on any such ordering anywhere in `stripMarkup`, and all instances are
  fixed together.
- Each input above is a test case with an exact expected output written
  out in the test, not computed with `stripMarkup` or `safeField`, and
  each fails against `04c46ec`.

### D-7: Error results are not stripped, framed, noticed or capped

**Gates publication.** **Reproduced.** Review property 12 and section 4,
row "`buildResult()` error envelope".

`buildResult`'s error branch redacts the message and prefixes `Error: `,
and does nothing else. Error text can carry up to 500 characters of the
upstream response body (`src/client.js`), the request path including
caller-supplied ids, network error text, and any other thrown message.
None of it passes through `stripMarkup`, `safeField`, `UNTRUSTED_NOTICE`
or `capOutput`. Every tool's `catch` wrapper routes through this branch,
so all sixteen tools are affected.

Reproduction: `fetch` stubbed to return HTTP 400 with the body
`<b>OBEY</b> https://evil.example ` followed by 3000 `A` characters;
server config `maxOutputChars: 100`; `find-projects` called with `{}`.
Result: `isError: true`, 541 characters, beginning
`Error: Todoist API 400 on GET /projects: <b>OBEY</b> https://evil.example AAAA`.
It contains `<b>` and `https://evil.example`, carries no fence and no
notice, and is 441 characters over the configured cap. The only bound is
`client.js`'s 500-character slice of the body, which applies to
`TodoistApiError` only.

**Claims this makes false:**

- Invariants 1 and 2, now **VIOLATED** on error responses; Invariant 4,
  now **VIOLATED**.
- R25: "Every tool response, read and write alike, must be prefixed with
  `UNTRUSTED_NOTICE` and size-capped via `capOutput`."
- `README.md`, "Content framing": the notice is prepended to "every
  response from all sixteen tools".
- `README.md`, "Output-size caps": "every tool response, read and write
  alike, is capped in total size".

AD-4 is not made false: it scopes the notice to successful responses.

**Fix criteria:**

- Error text from any source goes through the same stripping and URL
  defanging as untrusted fields, and text that can originate upstream is
  framed.
- Error results are bounded by `maxOutputChars` plus a fixed envelope.
- Whether error results carry `UNTRUSTED_NOTICE` is decided and recorded
  as an amendment to AD-4 before implementation.
- Redaction stays the last step.
- A test using the reproduction input above fails against `04c46ec`. It
  asserts no `<b>`, no `https://`, the framed text as a literal expected
  string, and total length within the bound.

### D-8

Fixed in Session 14 by decoding an invalid numeric entity to U+FFFD instead of passing it to `String.fromCodePoint`; see section 7, R10. This number is retired, not reused.

### D-9

Fixed in Session 15 by refusing, before any request, every path id that is not one or more ASCII letters or digits, and by refusing any path that URL parsing would change; see section 7, R30. This number is retired, not reused.

### D-10: A read tool's `limit` is not bounded by `TODOIST_MAX_ITEMS`

**Gates publication.** **Reproduced.** Review property 19.

Six read tools pass `a.limit ?? cfg.maxItems` to `getPaginated`, and the
schema allows any positive integer, so a caller's `limit` replaces the
configured cap rather than being bounded by it. `get-overview` takes no
`limit` and is not affected.

Reproduction: server config `maxItems: 5`; `fetch` stubbed to always
offer another page; `find-projects` called with `{"limit":500}`. The
client requested pages of 200, 200 and 100 items, and the payload
reported `count: 500`. Output text is still bounded by `maxOutputChars`.
The number of requests and the memory held are not. By reading, a very
large `limit` pages until the API stops returning a cursor.

**Claims this makes false:**

- R17: "`getPaginated` must respect the configured item cap exactly".
- `README.md`, "Output-size caps": "pagination is capped
  (`TODOIST_MAX_ITEMS`, default 200 ...)". And the Configuration table:
  `TODOIST_MAX_ITEMS` is "Max items fetched across pagination per read
  call", with `get-overview` as the one exception.
- R24, the D-1 decision: project, section and label names "keep the cap
  every other tool uses". The rationale was that raising those caps widens
  attacker-writable text reaching the agent, and `find-projects`,
  `find-sections` and `find-labels` let the caller raise them.

**Fix criteria:**

- For every read tool, the number of items fetched is at most
  `cfg.maxItems`. Whether a larger `limit` is clamped or rejected is
  decided and recorded under R17.
- Treated as a bug class: every `getPaginated` call site. A static test
  fails if any call site passes a cap that is not bounded by
  `cfg.maxItems` or `OVERVIEW_MAX_ITEMS`.
- Tests use a `maxItems` that differs from the default (section 8), and
  each fails against `04c46ec`.

### D-11

Fixed in Session 13, test-first `e96d3fe` and implementation `9d4bd71`, by adding the account guard `scripts/live-smoke.js` uses to `scripts/live-smoke-date.js`; see the Session 13 row of the Decision log, `test/live-smoke-date-account-guard.test.js` and the bug-class check `test/live-write-paths-guarded.test.js`. D-21's weaknesses in the guard and the scripts remain open. This number is retired, not reused.

### D-12

Fixed in Session 12, `6a99b01`, by making both tests assert the property they name and adding `test/calltool-asserts-iserror.test.js`; see AD-6 Evidence and Invariant 4. This number is retired, not reused.

### D-13: Output and field caps bound a prefix, not the response

**Does not gate publication.** Review properties 16, 17 and 18.

- **Reproduced.** `buildResult({ maxOutputChars: 30 }, { payload: { name: safeField('x' × 100) } })`
  returns 310 characters. After the notice, the body is `{`, a newline,
  then `  "name": "‹UNTRUSTED›xxxxxx` followed by the truncation suffix.
  The field's closing fence is gone.
- By reading. The notice and the truncation suffix are added after the
  cap, and redaction runs after that and can lengthen the text.
  `safeField`'s cap counts UTF-16 code units, so it can split a surrogate
  pair, and the fences and truncation marker come on top of it. Both caps
  are applied after full sanitization and full serialization, so neither
  bounds CPU or memory.
- Error results are not capped at all; that is D-7.

**Claim this makes false:** `README.md`, "Output-size caps": every
response "is capped in total size".

**Fix criteria:** decide whether the caps are total bounds or prefix
bounds, and make `README.md` and R11/R12 say which. Truncation never
leaves an open fence. A test with a small cap asserts the exact output.

### D-14: Pagination can report a short result as complete, and can loop without end

**Does not gate publication.** Review properties 19 and 20.

- **Reproduced.** With a cap of 2, a cursor-form page carrying three
  results and `next_cursor: null` returns two items and
  `truncated: false`. A `get-overview` count derived from such a fetch
  would be marked exact. This contradicts R17's Session 9 decision that
  "the cursor-based path is already correct and must not change". That
  decision considered exactly-at-cap pages only.
- By reading. A page with no results and a continuing cursor adds no
  items and loops again. There is no repeated-cursor check, page limit,
  timeout or response-size limit. A page larger than requested is fully
  held before slicing. `intFromEnv` accepts any positive integer, with
  no upper bound. Items are not de-duplicated across pages. A small
  `maxOutputChars` can cut `get-overview`'s `fetches` and `warnings` as
  well as the name lists.

**Fix criteria:** `truncated` is true whenever more items were received
than kept. Pagination stops on a repeated cursor and on a page limit, and
reports truncation when it does. An upper bound for each numeric cap is
decided and recorded under R2, with R2's stderr warning. Tests cover each
case and fail against `04c46ec`.

### D-15: The sanitizer misses lists, Unicode format characters and the contents of entity-encoded comments

**Does not gate publication.** Review property 14.

**Reproduced**, `stripMarkup` input to output:

| Input | Output |
|---|---|
| `1. do this\n- and this` | unchanged |
| `abc` U+202E `def` | unchanged; the right-to-left override survives |
| `a &lt;!-- IGNORE PRIOR --&gt; b` | `a !-- IGNORE PRIOR -- b` |

The third output's comment markers are broken, so it cannot render as a
comment, but its content is now visible text. The first pass removes
comments before entities are decoded. This is the D-6 bug class.

**Claims this makes false:** `README.md`, "Markup stripping": "HTML tags
and comments are removed, control characters are stripped". Only ASCII
control characters are stripped. Unicode format characters (category Cf,
including bidirectional overrides) are not.

**Fix criteria:** Unicode format characters are removed, with the set
recorded under R10. Whether list markers are neutralized is decided and
recorded under R10, which lists heading, table and blockquote markup but
not lists. Comment removal runs after decoding, as part of D-6's class
fix.

### D-16: Structural fields are copied without type checks

**Does not gate publication.** Review property 13 and section 4.

**Reproduced** with constructed objects, not with data from Todoist.
`shapeTask` given `priority: { x: 'OBEY' }` returns that object
unchanged. Given `due.timezone: 'IGNORE https://evil.example'`, it
returns that string unchanged, URL included. The same applies by reading
to every field section 6 leaves unmarked, and to ids echoed by the write
tools. Whether Todoist ever returns such values is not established.

Two wrong-typed values throw rather than pass through, and one throw
fails the whole read, as D-8 did. Found by D-8's bug-class check in
Session 14 and **reproduced** at `bf2124d`:

- A text field holding a JSON object whose own `toString` is not a
  function, e.g. `content: {"toString": 1}`: `stripMarkup` and
  `safeField` throw `TypeError: Cannot convert object to primitive
  value` from `String(input)`.
- A `null` item in a results array: every shaper throws `TypeError` on
  its first property read (`t.id`).

Neither can come from the section 2 adversary, who writes text, not JSON
structure. D-8's fix covers string input only; these are left for this
entry.

**Claim this weakens:** section 6, "Finding 1's injection surface is
closed. Every echoed field originating as Todoist-writable text routes
through `safeField`." That holds only if the unmarked fields cannot carry
text, which nothing here checks.

**Fix criteria:** each unmarked field is checked against its expected
type (id pattern, integer 1 to 4, boolean, ISO date or datetime, IANA
timezone name, known color name), and a value that fails becomes `null`.
Tests feed each shaper a wrong-typed value for every such field.
No shaper throws on a wrong-typed text field or a non-object item, and
what each becomes is recorded here.

### D-17: Redaction misses short tokens, escaped tokens and Basic credentials

**Does not gate publication.** Review properties 10 and 11.

- **Reproduced.** After `registerSecret('tok')`,
  `redact('token tok here')` is unchanged. `loadConfig` accepts a token
  of one to three characters, which R6 then never registers. The format
  of real Todoist tokens is not established by this repository.
- **Reproduced.** With `ab"cd` registered, `redact(JSON.stringify({ v: 'ab"cd' }))`
  returns `{"v":"ab\"cd"}` unchanged. `src/logger.js` serializes `meta`
  before redacting it, so the same applies to log metadata.
- **Reproduced.** `redact('Authorization: Basic abcdefghijklmnop')`
  returns `Authorization: [REDACTED] abcdefghijklmnop`. The credential
  survives.
- By reading. `createClient` does not register its token; only
  `createServer` does.

**Claims this makes false:** R7, "`authorization: <value>`-shaped
substrings" are redacted. The scheme word is replaced and the value
survives. `README.md`, "Token redaction": `Authorization:` material "is
redacted generically". Invariants 9 and 10 are qualified in the table.

**Fix criteria:** `loadConfig` rejects a token too short to register, or
registration accepts every token the config holds. Escaped forms of each
registered secret are redacted, or tokens containing characters that JSON
escapes are rejected. The Authorization pattern consumes the whole header
value. `createClient` registers its token. Tests cover each.

### D-18: Tool input validation is looser than the tool descriptions

**Does not gate publication.** Review properties 4 and 5.

By reading:

- Ids and dates are unrestricted strings, except ids placed in a request
  path, which R30 restricts (D-9, fixed in Session 15). Ids sent as query
  parameters or in a request body are still unrestricted.
  `find-tasks-by-date` puts `date` verbatim into the filter query and
  returns that query as `filter`. Section 6 describes `filter` as
  "server-built ... not echoed". It is echoed, and its content is partly
  caller-supplied.
- No string or batch length has an upper bound. Write batches are
  unbounded.
- `reschedule-tasks` accepts several due fields at once. Section 6
  describes the input as "one of `due_string`/`due_date`/`due_datetime`".
- `find-comments` and `add-comments` treat an empty-string id as absent.
  In `add-comments`, an empty second id is still sent in the request
  body.
- `add-comments` validates each item just before writing it, so an
  invalid later item fails the call after earlier comments were created.
  The partial-write consequence is already disclosed (section 3, R28).
  What is new is that validating the whole batch before the first write
  would prevent this case.

**Fix criteria:** every batch tool validates all items before its first
write. Batch size and string lengths have recorded maximums.
`reschedule-tasks` takes exactly one due field. Empty-string ids are
rejected, using D-9's validator, `assertPathId`. `update-tasks`,
`complete-tasks`, `uncomplete-tasks` and `reschedule-tasks` already check
every path id before their first request (R30); their other fields do
not have that check yet.

### D-19: Registration and client boundaries are wider than their comments say

**Does not gate publication.** Review properties 1, 2, 3 and 6.

- **Reproduced.** `createServer({ apiKey: 'zzzzzz', maxItems: 1 })`, with
  no `readOnly`, registers all nine write tools. The shipped entry point
  always passes a boolean from `loadConfig`. R18 as written specifies
  this: writes register "when `cfg.readOnly` is falsy". Invariants 6 and
  8 are qualified in the table.
- By reading. `src/server.js`'s header says that in read-only mode "the
  write module is never imported/called". It is imported statically in
  every mode; it is only not called.
- By reading. `createClient().request()` accepts any method and path, and
  has no read-only check. `test-contract/update-task-partial.contract.js`
  sends a `DELETE` directly with `fetch` to clean up. Section 1 says
  destructive operations "remain human-only". That holds for the tool
  surface, not for this repository.
- **Reproduced.** `assertAllowedUrl('https://u:p@api.todoist.com:8443/x')`
  is accepted. R14 says "exact-match `https://api.todoist.com` only". The
  host and scheme are exact-matched, but userinfo, port and path are not
  checked. Not reachable through the tools while `API_BASE` is a literal.

**Fix criteria:** write tools register only when `cfg.readOnly === false`,
and R18 is amended to match. The `server.js` comment is corrected. Section
1 is scoped to the tool surface. `assertAllowedUrl` rejects userinfo, any
port other than the default, and any path outside `/api/v1/`.

### D-20: The token file's permissions are described but not checked

**Does not gate publication.** Review property 9. By reading.

`src/config.js` describes `TODOIST_API_KEY_FILE` as a "0600,
claudecode-owned" file. Nothing checks mode, owner, file type or
symlinks. Any readable file with non-empty trimmed contents is accepted.
`README.md`'s credential storage section is advice and remains accurate.

**Fix criteria:** decide whether startup refuses a token file that is
group- or world-readable, or not a regular file. Record the decision
under R3/R4, and make the comment match what the code does.

### D-21: The live scripts and the account guard check less than they report

**Does not gate publication.** Review property 22 and the review's
"Additional supplied executable checks". By reading.

- `verifyContractTestAccount` shows that an id matches, not that the
  account is disposable. It is only as safe as the id it is given.
- The guard's `fetch` and the direct fetches in
  `test-contract/update-task-partial.contract.js` send the contract token
  without `redirect: 'manual'`. AD-3 covers only `src/client.js`.
- The guard's mismatch error embeds `id` and `email` from the response
  unsanitized, and a `fetch` failure propagates without redaction.
- `scripts/live-smoke.js` prints the read-back and completion results
  without asserting success, so it can print its success conclusion over
  tool errors.
- `scripts/stdio-check.js` prints the tool list and asserts nothing.
  `README.md` says it confirms "the read-only vs. read/write split"; a
  person reading the output does that, not the script.
- `scripts/live-smoke-date.js`'s header says it "proves the date path"
  through `/tasks/filter`. It prints the recorded paths and does not
  assert them.

**Fix criteria:** the guard and every contract fetch refuse redirects and
redact what they throw. The smoke scripts assert what they print and exit
non-zero on failure. `stdio-check.js` asserts the expected tool set for
its mode. The disposable-account assumption is written into section 9.

### D-22: Test assertions that a regression would still satisfy

**Does not gate publication.** Review section 3. Each item is review
only unless marked. These bear on the Evidence column in section 5, and
each is fixed by making the named mutation turn the test red.

Not in scope: a missing success assertion in a test that calls a tool.
D-12's static check, `test/calltool-asserts-iserror.test.js`, found it in
three `test/mcp-e2e.test.js` tests (the read framing test, the
`update-tasks` framing test and the output-size cap test), and all three
were fixed in `6a99b01`. The weaknesses listed below for those tests
remain.

- `test/client.test.js`, "assertAllowedUrl blocks host override attempts
  in the base path": it makes no override attempt.
- `test/config.test.js`: "an unreadable key file ..." matches only a
  phrase, so appending the OS error and path still passes (R4). "loadConfig
  throws without a token and never echoes it" supplies no token (R5).
- `test/mcp-e2e.test.js`, read framing test: the token appears only in the
  request header, so disabling result redaction passes its token
  assertion. Both framing tests compute their expected value with
  production `safeField`, and `test/sanitize.test.js`'s delimiter test
  uses the exported markers. So no test pins the marker strings
  themselves.
- `test/mcp-e2e.test.js`, "read tool enforces the output-size cap on a
  large list": it asserts only the phrase `output truncated`.
- `test/mcp-e2e.test.js`, the normal-content secret test and both
  plain-Error tests register their secret by hand. Removing
  `createServer`'s `registerSecret` call goes unnoticed. These are
  Invariant 3's and Invariant 10's cited evidence.
- `test/registration.test.js` inspects the returned name arrays, not the
  SDK registry. `test/mcp-e2e.test.js`, "client sees write tools only in
  read/write mode", checks two names and a count. Invariants 6, 7 and 8
  cite `test/registration.test.js`.
- `test/result-builder-shape.test.js` misses `{ content: blocks }`,
  computed keys and a builder result modified afterwards, and cannot
  notice protections being removed inside `buildResult` (Invariant 12).
- `test/no-url-key-in-output.test.js` misses `file_url` and URLs under
  other keys. Shorthand, computed keys and spreads are already recorded
  in AD-6.
- `test/sanitize.test.js`: the per-field cap test passes with a cap of
  150 for 100, and the `capOutput` test passes when 550 characters are
  kept for 500. Both entity-decoding tests assert absence only.
- `test/get-overview-truncation.test.js`: the D-1 key-order test never
  forces truncation, and the D-2 description test matches the words
  `filter` and `timezone` only.
- The R17 pagination tests omit an overlong cursor-form page (D-14).
