# Resume Notes

Handoff note for picking this work back up cold. If you don't remember the
last several sessions, start here.

## 1. Where things stand

- Branch: `remediation/audit-2026-08` (10 commits ahead of `main`).
- Tests: 71/71 passing.
- Coverage: 90.16% lines / 86.67% branches / 86.23% functions.
- All six findings in `docs/todoist-mcp-security-review.md` are closed.
- Read `docs/SPEC.md` for the current status of every invariant and the
  three recorded architecture decisions (AD-1, AD-2, AD-3). That file is
  the source of truth, not this note.

## 2. The two copies, and how to tell them apart

There are two directories that both look like "the Todoist MCP server."
They are not the same thing and do not sync automatically.

- `/workspace/projects/Todoist-MCP/` — the git repo. All remediation work
  happens here. Identify it by the presence of `.git`.
- `~/.todoist-mcp/` — the deployed copy the agent actually runs at
  request time. No git history. Identify it by the presence of a `token`
  file.

Rule of thumb: **git means work, token means deployed.**

The deployed copy is still running the pre-remediation code — none of the
work on this branch has reached it yet. Deployment is a manual file copy
from the repo; nothing propagates automatically.

## 3. Deployment procedure

When it's time to ship this branch's work to the running server:

1. Back up the deployed copy:
   `cp -a ~/.todoist-mcp ~/.todoist-mcp.backup-$(date +%Y%m%d)`
2. Copy `src/` from the repo into the deployed copy. Do not touch the
   `token` file.
3. Restart the agent and run a real Todoist request through it to verify.
4. **Delete the backup the same day**, once verified. It's deployment
   insurance, not an archive — a stale backup directory becomes its own
   hazard.

## 4. Remaining work

- **Session 8 — contract tests.** Verify against the real Todoist API that
  `POST /tasks/{id}` is a partial update whose response returns full
  current task state, including untouched fields. This premise underpins
  security review Finding 1 and has so far only been read in
  documentation, never observed directly. Needs a separate, throwaway
  Todoist account (tokens can't be scoped). Gate these tests behind
  `TODOIST_CONTRACT_TEST_TOKEN`, and include a precondition check that
  asserts the account identity is the test account before making any
  request.
- **Session 9 — claims reconciliation.** `README.md` and the agent
  definition at `/workspace/projects/agent-os/.claude/agents/todoist.md`
  still assert controls that AD-1 corrected (see `docs/SPEC.md` §4).
  This gates publishing.
- **Tracked elsewhere, not in this repo:** per-request read/write mode
  selection (AD-1) belongs to the Agent OS project. Whether two copies of
  this server should exist at all is also an Agent OS question, not one
  this repo can answer.
