# Resume Notes

Handoff note for picking this work back up cold. If you don't remember the
last several sessions, start here.

`docs/SPEC.md` is the source of truth for invariants, decisions, and known
defects. This note is a pointer to it, not a substitute.

This file is an internal working document, not published documentation.
The personal deployment paths in section 2 are deliberate and stay; they
help whoever resumes this work find the right directories on this
machine.

## 1. Where things stand

- Branch: `main`, which now matches `remediation/audit-2026-08` and is
  pushed to `origin`.
- Tests: 72/72 passing.
- All six findings in `docs/todoist-mcp-security-review.md` are closed.
- Sessions 1 through 8 are complete. Session 9 is partially complete and
  is the one to resume.
- Five architecture decisions recorded in `docs/SPEC.md` section 4:
  AD-1 (mode selection belongs to the agent layer), AD-2 (URLs defanged,
  not deleted), AD-3 (all redirects refused), AD-4 (the untrusted-content
  notice is unconditional), AD-5 (the agent definition in this repo is an
  example, not the live one). All five are written into the file.

Before doing anything else, confirm the working tree is clean and that the
Session 9 spec commits actually landed:

    cd /workspace/projects/Todoist-MCP
    git status --short
    git log --oneline -6

The last commit hash known at the time of writing is `8d4387f`, which adds
`server.json` and sets the version to `0.1.0`.

## 2. The two copies, and how to tell them apart

There are two directories that both look like "the Todoist MCP server."
They are not the same thing and do not sync automatically.

- `/workspace/projects/Todoist-MCP/` is the git repo. All remediation work
  happens here. Identify it by the presence of `.git`.
- `~/.todoist-mcp/` is the deployed copy the agent actually runs at
  request time. No git history. Identify it by the presence of a `token`
  file.

Rule of thumb: **git means work, token means deployed.**

The deployed copy now runs the remediated code. Only `src/` was copied.
Its stale `scripts/` directory was deleted and is deliberately not
redeployed. Its `README.md` is still the old July version.

Deployment is a manual file copy. Nothing propagates automatically.

There was a second, smaller instance of the same problem. An agent
definition existed at both `.claude/agents/todoist.md` in this repo and
`/workspace/projects/agent-os/.claude/agents/todoist.md`, byte-identical
and unedited since July 21. AD-5 resolves this and is now written into
`docs/SPEC.md` section 4. The repo copy is a labeled example at
`docs/examples/todoist-subagent.md`, with an explanatory
`docs/examples/README.md` beside it; it uses placeholder paths, carries
no personal identifiers, and launches read-only by omitting
`TODOIST_READONLY` entirely rather than setting it to `"true"`.
`.claude/agents/todoist.md` no longer exists in this repo. The live
definition remains in whatever project consumes this server, outside
this repo's scope.

## 3. Deployment procedure

When it's time to ship this branch's work to the running server:

1. Back up the deployed copy:
   `cp -a ~/.todoist-mcp ~/.todoist-mcp.backup-$(date +%Y%m%d)`
2. Copy `src/` from the repo into the deployed copy. Do not touch the
   `token` file. Do not copy `scripts/` or `test-contract/`.
3. Restart the agent and run a real Todoist request through it to verify.
4. **Delete the backup the same day**, once verified. It is deployment
   insurance, not an archive. A stale backup directory containing a live
   token becomes its own hazard.

## 4. Code that touches a live account

Two places in this repo can write to a real Todoist account. Both are
guarded. Know about them before running anything.

- `test-contract/` holds the Session 8 contract tests. They run only when
  `TODOIST_CONTRACT_TEST_TOKEN` is set, and an account guard refuses to
  proceed unless the token opens the designated throwaway account.
- `scripts/live-smoke.js` performs a live write round-trip. Session 8
  retrofitted the same account guard onto it. Before that it wrote to
  whatever account its token opened, with no identity check.

`npm test` runs neither. It is `node --test test/` and is fully offline.

`README.md` still documents `npm run smoke` as something to run against a
real account, with no mention of the guard. That is one of the README
corrections listed below.

## 5. Session 9: what is done and what remains

Objective: reconcile `README.md` and the agent definition with what AD-1
established, and resolve the open items and deferred decisions that gate
publishing.

### Done

- **Framing evidence corrected.** Two assertions in `test/mcp-e2e.test.js`
  claimed framing occurred by checking that `FRAME_OPEN` and `FRAME_CLOSE`
  appeared in tool output. `UNTRUSTED_NOTICE` contains both markers in its
  own explanatory text and `buildResult` prepends it to every response, so
  both assertions passed unconditionally. The read-tool test now compares
  against the exact string `safeField` produces, verified by replacing
  `shapeProject`'s `safeField` call with `stripMarkup` and confirming it
  was the sole failure. Both confounded assertions were removed.
- **Tripwire added.** `test/framing-assertion-shape.test.js` fails if a
  positive `.includes(FRAME_OPEN)` or `.includes(FRAME_CLOSE)` reappears
  anywhere under `test/`. Deliberately narrow: it matches one expression
  form and does not trace data flow. Verified by planting a matching
  assertion and confirming it fired on that line alone.
- **AD-4 recorded**, plus the R25 correction. The notice applies to all
  sixteen tools, not read tools only. R25 was understated, not wrong.
- **Evidence column added** to the invariants table in section 5, with a
  legend defining TESTED, INSPECTED, ASSERTED, and UNGRADED. Invariants 1
  and 2 are graded. Invariants 3 through 12 are UNGRADED, meaning nobody
  has checked their evidence, not that it is weak. Grading them is tracked
  work and does not gate publishing.
- **All ten remaining `[DECISION NEEDED]` items in section 7 resolved.**
  Six are decided inline. Four were not decisions at all but confirmed
  defects, now in section 10 as D-1 through D-4. Zero markers remain.
  D-5 was also recorded in section 10 during Session 9, but from a
  different source: it came from reading `src/shape.js` directly, not
  from resolving a `[DECISION NEEDED]` item in section 7.
- **Claims analysis complete** for `README.md` and the agent definition.
  Findings are in section 6 below.
- **AD-5 is written into `docs/SPEC.md` section 4.**
- **The example agent definition now lives at
  `docs/examples/todoist-subagent.md` with an explanatory
  `docs/examples/README.md` beside it.** It is no longer at
  `.claude/agents/todoist.md`, which no longer exists in this repo.
- **`server.json` exists at the repo root**, using the 2025-12-11 registry
  schema, named `io.github.kevlasher/todoist-mcp`. Publishing to the MCP
  Registry remains deferred.
- **`package.json` version changed from `1.0.0` to `0.1.0`**, agreeing
  with `server.json`.
- **The Session 8 open items in `docs/SPEC.md` section 9 are closed.**
  Item 1 (`UNTRUSTED_NOTICE` scope) is answered by AD-4. Item 2 (whether
  other consumers parse tool output as bare JSON) is recorded as an
  Agent OS handoff and closed there.

### Remaining

- **Rewrite `README.md`** against the claims list in section 6.
- **Rewrite this file** once the above is done.

## 6. README and agent-definition claims to correct

False:

- The Tests section tells the reader to run `npm run smoke` against their
  real account. The account guard makes this wrong and the guard is not
  mentioned at all.
- The `find-tasks` table row says it "also narrows by" `project_id`,
  `section_id`, `label`, `parent_id`, and `ids`. When `query` is supplied
  those are never sent. This is D-3.
- The credential-constraint section calls server-layer enforcement strong
  because it "holds regardless of harness behavior." It does not, and the
  README contradicts this two sections later. The launching environment
  decides the mode. That is AD-1.
- The `get-overview` row describes per-project and due-today counts
  without qualification. D-1 and D-2 both apply.

Understated, in the same way R25 was:

- The notice is described as leading every read result. It is on every
  result from all sixteen tools.
- Output-size capping is described as applying to read tools. It applies
  to every response.
- Framing is described as read-path only. Write-tool echoed fields are
  framed too (Invariant 2).

Missing:

- AD-3. Nothing says all redirects are refused outright, or that
  endpoints will start failing if Todoist ever introduces one.
- AD-2. Nothing says URLs come back defanged rather than removed.
- `test-contract/` appears nowhere, neither in Tests nor in Layout.
- The Layout block omits `test-contract/` and `docs/`.
- Nothing states that the read-only design assumes each invocation gets
  its own process. A client that launches one long-lived shared server
  gets one mode for the whole session. This is a real constraint on what
  the security posture means and is currently unstated.

Also:

- Personal deployment paths appear in the credential-storage commands in
  `README.md` and in the example agent definition. Both are published, so
  the paths do not belong there. This does not apply to `docs/RESUME.md`,
  which is an internal working document, not published documentation (see
  the note at the top of that file).
- The spec's control numbering and the README's control numbering do not
  match. "Control #6" means the nonexistent two-agent confirmation gate in
  one and env-gated read-only in the other. The README never claimed a
  confirmation gate; that claim lived in the security review's list.
- The Claude Code subagent frontmatter format has been verified, not left
  as an open task. The frontmatter schema itself (`mcpServers` list
  entries, inline vs. bare-string form, `tools`/`disallowedTools`
  server-level patterns) was checked against Anthropic's published
  subagent documentation on 2026-09-15 (AD-5, `docs/SPEC.md`). The two
  runtime behaviors the example depends on — folder-trust gating on
  inline servers, and inline vs. by-name connection lifetime — were
  checked the following day, 2026-09-16 (`docs/examples/README.md`). Both
  are product conventions rather than a specification, so either can
  change without notice and is worth re-checking again before
  publishing.

## 7. Session 10 and beyond

Section 10 of `docs/SPEC.md` holds D-1 through D-5 with fix criteria.
D-1 is the significant one and is the reason section 10 exists: every
count `get-overview` returns is derived from fetches capped at
`TODOIST_MAX_ITEMS`, so an account with more than 200 active tasks gets
wrong counts, and the four `truncated` flags that would signal this are
discarded in favour of an unconditional note. D-2 carries an open
decision that must be made before it can be fixed: how the timezone used
for "today" is supplied is not decided — an environment variable read
once at startup and a per-request parameter have different consequences
for a long-lived shared process. D-5 is a dependency risk, not a live
defect: the `url` passthrough exemption is safe only while Todoist
returns a url built from the task id alone, and nothing in this server
checks that assumption or would catch it if Todoist began returning a
content-derived slugged form instead.

Also scheduled, recorded as DECIDED entries in section 7 rather than as
defects:

- `getPaginated`'s bare-array fallback branch always reports
  not-truncated. The cursor path is correct and must not change.
- The Zod `.default()` before `.optional()` ordering, to be fixed as a bug
  class across every schema in `src/`, not as a single instance.
- A stderr warning when a numeric cap is rejected and the default is used.
- Verification that `update-tasks` achieved its intended change, using the
  full task state Session 8 confirmed the API returns. `due_string` needs
  different handling, since Todoist interprets it.
- Partial-success reporting on multi-item writes. No automatic retry:
  these writes are not idempotent and retrying risks duplicates.

Also scheduled, but recorded as a DECIDED entry at the end of
`docs/SPEC.md` section 8, not section 7, because it is a test-evidence
defect rather than a code defect:

- The fixture-default collision audit. A test fixture that sets a
  configuration value equal to the implementation's own fallback cannot
  detect that the value stopped being plumbed through — demonstrated when
  a fixture setting `maxFieldChars: 2000` stayed green even after the
  handler's `cfg.maxFieldChars` argument was removed, because `safeField`
  falls back to the same 2000. A later session must audit every fixture
  in `test/` for a configured value that collides with its implementation
  default (`maxFieldChars` 2000, `maxOutputChars` 50000, `maxItems` 200)
  and change each colliding fixture to a value that diverges from its
  default.

Tracked elsewhere, not in this repo: per-request read/write mode selection
(AD-1), whether two copies of this server should exist, and whether
anything else in Agent OS parses this server's output as bare JSON.

## 8. Method

Unchanged, and worth restating because it is what caught the vacuous
assertion:

- Tests first, in a separate prompt from implementation.
- A test that passes before its implementation exists is a stop-and-report
  event.
- A test that passes on its first run is unverified. Break the code it
  depends on and confirm it goes red for the right reason.
- Verify every static or structural test by deliberately introducing the
  violation it exists to catch.
- Fix bug classes, not instances.
- One session per objective, ended deliberately.
- Decisions get recorded in `docs/SPEC.md`, not left in chat.
- Review the spec, not diffs.

A post-edit hook runs the full suite on any change to `src/` or `test/`.
It does not fire on `docs/`.
