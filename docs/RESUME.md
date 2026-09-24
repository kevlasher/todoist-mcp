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
- Tests: 101/101 passing, under Node 20 (see section 8).
- All six findings in `docs/todoist-mcp-security-review.md` are closed.
- Sessions 1 through 9 are complete. **Resume at Session 10** — see
  section 7.
- Six architecture decisions recorded in `docs/SPEC.md` section 4:
  AD-1 (mode selection belongs to the agent layer), AD-2 (URLs defanged,
  not deleted), AD-3 (all redirects refused), AD-4 (the untrusted-content
  notice is unconditional), AD-5 (the agent definition in this repo is an
  example, not the live one), AD-6 (the `url` field is removed from tool
  output, not guarded). All six are written into the file.

Before doing anything else, confirm you're actually caught up rather than
resuming stale state. A pinned commit hash drifts the moment anyone
commits, so check content instead of a hash:

    cd /workspace/projects/Todoist-MCP
    git status --short

- `git status --short` should print nothing.
- `docs/SPEC.md`'s Decision log (top of the file) should have a row for
  Session 9. If it doesn't, the Session 9 commits haven't landed on this
  branch.
- Section 5 below should read "Session 9: closed." If it instead lists
  open "Remaining" work, you're looking at an older copy of this file.
- Section 6 below should read as a closure note, a few sentences, not an
  itemized claims list. If it's an itemized list, the README rewrite this
  file assumes happened hasn't happened on this branch.

Any of those failing means: stop, reconcile with `origin`, and don't trust
the rest of this file until they pass.

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
redeployed. Its `README.md` is stale, still the old July version, and
that is deliberate: nothing reads it, it isn't published, and no future
session should treat updating it as work.

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

`README.md` now documents `npm run smoke`'s account guard correctly, and
covers `test-contract/` in both its Tests section and its Layout block.
That was open work as of Session 9; it closed when README.md was
rewritten (see section 5).

## 5. Session 9: closed

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
- **All eleven `[DECISION NEEDED]` items in section 7 resolved.** Seven
  were decided inline. Four were not decisions at all but confirmed
  defects, now in section 10 as D-1 through D-4. Zero markers remain.
  (An earlier version of this note said "ten" and "six" — recounted
  directly against the pre-Session-9 commit; the correct totals are eleven
  and seven.) D-5 was also recorded in section 10 during Session 9, but
  from a different source: it came from reading `src/shape.js` directly,
  not from resolving a `[DECISION NEEDED]` item in section 7.
- **Claims analysis complete** for `README.md` and the agent definition.
  The claims list itself has since been retired — see section 6.
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
- **`README.md` rewritten** against the claims list that was in section 6,
  and merged (PR #1: `b376373`, `45dc2af`; follow-up fixes in PR #2:
  `b9c570b`). Verified directly against the live file: every False,
  Understated, Missing, and Also item the claims list raised is addressed
  in the current README.
- **This file rewritten** to close out Session 9 and hand off cleanly to
  Session 10.

Both items previously listed under "Remaining" are done. Session 9 has no
open items.

## 6. README and agent-definition claims — resolved

Session 9 produced a claims list here (False / Understated / Missing /
Also-broken items found by comparing `README.md` and the agent definition
against `docs/SPEC.md`). That list was the direct input to the README
rewrite referenced in section 5. It has been verified, item by item,
against the current `README.md` and found fully addressed: nothing on it
describes the published README any longer.

The itemized list is deliberately not kept here. A stale claims list that
still reads like an open defect report is worse than no list — it invites
a future reader to mistake pre-rewrite README text for current text. If
README drift is suspected later, re-diff `README.md` against `docs/SPEC.md`
directly; don't try to revive this one.

## 7. Session 10 and beyond

Section 10 of `docs/SPEC.md` holds D-2 and D-4 with fix criteria.
They don't all gate publishing:

- **Gates publishing:** D-2.
- **Does not gate publishing:** D-4.

**D-5: done, Session 10.** The `url` field is removed from tool output
rather than guarded, recorded as AD-6 in `docs/SPEC.md` section 4. D-5
has left section 10; a one-line pointer to AD-6 keeps the number from
being reused. Test-first commit `4894671`, implementation `25c63e1`. The
scope described in earlier versions of this section, a structural-format
check in `shapeTask`, was superseded before it was built; see AD-6's
rejected alternative.

**D-3: done, Session 10.** Description text only, no behavior change. A
non-empty `query` still replaces `project_id`, `section_id`, `label`,
`parent_id` and `ids`; the `find-tasks` description and those five
fields' descriptions now say so, say to combine a project, section or
label by putting it in the query by name (`#Project`, `/Section`,
`%label`), and say `parent_id` and `ids` cannot be expressed in a query.
Rejecting the combination as an error was deferred as a behavior change.
Decision recorded under R21 in `docs/SPEC.md` section 7; D-3 has left
section 10. Test-first commits `35fb240` and `fc67322`, implementation
`3d1f86b`.

**D-1: done, Session 10.** `get-overview`'s tasks fetch counts up to a
fixed `OVERVIEW_MAX_ITEMS = 5000`; its project, section and label lists
keep `TODOIST_MAX_ITEMS`, because their names are attacker-writable text
that reaches the agent, while tasks are only counted. Every count is
`{ count, is_floor }`, per-fetch truncation is reported, `warnings`
appear only when something was truncated, and orphaned sections and
tasks are surfaced instead of dropped. Decision recorded under R24 in
`docs/SPEC.md` section 7; D-1 has left section 10. Test-first commit
`109f132`, implementation `cdd670f`.

D-2 is next and is now the only gating defect: `due_today` and `overdue`
are computed against UTC "today" on the server host. The approach is
decided and recorded in `docs/SPEC.md` section 10, D-2, under **DECIDED,
Session 10**: ask Todoist's own `today` and `overdue` filters, so the
timezone is the Todoist account's own, with the two new fetches carrying
the same `is_floor` and truncation signals as the other four.
The D-1 tests in `test/get-overview-truncation.test.js` use a fake API
that serves only `/projects`, `/sections`, `/labels` and `/tasks`, and
throws on any other path. Once `get-overview` queries `/tasks/filter`,
that fake must answer it too, or every D-1 test will fail for a fixture
reason rather than a behavior one.

D-4 does not gate publishing: token-source error messages name the wrong
environment variable in some cases (an operator who configured
`TODOIST_API_KEY_FILE` correctly, with an empty file, is told to set
`TODOIST_API_KEY` instead). Worth doing alongside the others in Session 10
since it's already scoped, but nothing blocks on it.

Also scheduled, recorded as DECIDED entries in section 7 rather than as
defects:

- **Done, Session 10.** `getPaginated`'s bare-array fallback now reports
  truncated when the array fills the requested page limit. The cursor path
  is unchanged. Landed with D-1 in `cdd670f`; see R17.
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

**Run the suite under Node 20.** Cloud sessions default to Node 22,
where `npm test` (`node --test test/`) fails before loading any test,
with `Cannot find module '.../test'`, because Node 22 treats the
directory argument as a module path. The post-edit hook runs on that
default, so in a cloud session it reports a failure after every edit to
`src/` or `test/` whatever the tests would do: treat its output as a
false failure. Run the suite with Node 20 first on `PATH` instead, for
example `PATH=/opt/node20/bin:$PATH npm test`, until the tracked Node
upgrade lands. Coverage baselines in `docs/SPEC.md` section 8 are also
Node 20 figures.
