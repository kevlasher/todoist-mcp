# Resume Notes

Handoff note for picking this work back up cold. If you don't remember the
last several sessions, start here.

`docs/SPEC.md` is the source of truth for invariants, decisions, and known
defects. This note is a pointer to it, not a substitute.

## 1. Where things stand

- Branch: `remediation/audit-2026-08`.
- Tests: 72/72 passing.
- All six findings in `docs/todoist-mcp-security-review.md` are closed.
- Sessions 1 through 8 are complete. Session 9 is partially complete and
  is the one to resume.
- Five architecture decisions recorded in `docs/SPEC.md` section 4:
  AD-1 (mode selection belongs to the agent layer), AD-2 (URLs defanged,
  not deleted), AD-3 (all redirects refused), AD-4 (the untrusted-content
  notice is unconditional), AD-5 (the agent definition in this repo is an
  example, not the live one). AD-5 was accepted but is NOT yet written
  into the file. See section 5 below.

Before doing anything else, confirm the working tree is clean and that the
Session 9 spec commits actually landed:

    cd /workspace/projects/Todoist-MCP
    git status --short
    git log --oneline -6

The last commit hash known at the time of writing is `adf414a`, the
read-tool framing fix. Commits after it cover the confounded-assertion
removal, the framing tripwire, and two spec commits.

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

There is a second, smaller instance of the same problem. An agent
definition exists at both `.claude/agents/todoist.md` in this repo and
`/workspace/projects/agent-os/.claude/agents/todoist.md`. As of Session 9
the two files are byte-identical and neither has been edited since July
21. AD-5 resolves this: the repo copy becomes a labeled example with
placeholder paths, and the live definition lives in the consuming project.

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
  defects, now in section 10 as D-1 through D-5. Zero markers remain.
- **Claims analysis complete** for `README.md` and the agent definition.
  Findings are in section 6 below.

### Decided but not yet written

These were agreed in the Session 9 chat and have no artifact in the repo
yet. Doing them is the first task on resuming.

- **AD-5** into `docs/SPEC.md` section 4.
- **The example agent definition** replacing `.claude/agents/todoist.md`.
  It launches read-only (omitting `TODOIST_READONLY` entirely, to
  demonstrate the fail-safe default), uses placeholder paths, carries no
  personal identifiers, and includes agent-facing warnings about D-1,
  D-2, and D-3. Full draft text is in the Session 9 chat.
- **`server.json`**, the client-agnostic server description used for
  registry publishing and client discovery. Adding the file was agreed.
  Publishing to the MCP Registry was explicitly deferred. Pull the current
  schema when writing it; it has been revised more than once and the
  naming convention changed.
- **`package.json` version** from `1.0.0` to `0.1.0`. The current number
  claims a stability this does not have while D-1 through D-4 are open.
- **Close the Session 8 open items** in `docs/SPEC.md` section 9. Both are
  resolved but still presented as open. Item 1 (UNTRUSTED_NOTICE scope) is
  answered by AD-4. Item 2 (whether other consumers parse tool output as
  bare JSON) is recorded as an Agent OS handoff and closed here.

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

- Personal deployment paths appear in the credential-storage commands and
  in the agent definition. They do not belong in a published repo.
- The spec's control numbering and the README's control numbering do not
  match. "Control #6" means the nonexistent two-agent confirmation gate in
  one and env-gated read-only in the other. The README never claimed a
  confirmation gate; that claim lived in the security review's list.
- Before publishing, verify the Claude Code subagent frontmatter format is
  still current. The file was written in July and the format is a product
  convention, not a spec.

## 7. Session 10 and beyond

Section 10 of `docs/SPEC.md` holds D-1 through D-4 with fix criteria.
D-1 is the significant one and is the reason section 10 exists: every
count `get-overview` returns is derived from fetches capped at
`TODOIST_MAX_ITEMS`, so an account with more than 200 active tasks gets
wrong counts, and the four `truncated` flags that would signal this are
discarded in favour of an unconditional note.

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
