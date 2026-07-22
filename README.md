# todoist-mcp

A purpose-built, local-stdio [Model Context Protocol](https://modelcontextprotocol.io) server for a **single personal Todoist (GTD) account**. It exposes a deliberately narrow tool surface, an env-gated read-only mode, and in-server prompt-injection mitigations.

It was built fresh against the Todoist API v1. It is **not** a fork of any existing server; two proven patterns (SSRF allowlist, token redaction) were reimplemented from `MadLlama25/fastmail-mcp` as reference, everything else is written clean.

---

## Why this exists (and the one hard limitation)

Off-the-shelf Todoist MCP servers were rejected because none offers a credential-level read-only tier reachable from local stdio, and all expose far more surface than personal GTD needs. This server gives a controlled tool set, in-server injection defenses, an env-gated read-only mode, and full auditability.

### Credential constraint — read this first

Todoist's personal API token (`TODOIST_API_KEY`, from **Settings → Integrations → Developer**) is **always full read + write, account-wide**. Todoist has **no scope parameter, flag, or token tier** that narrows a personal token to read-only. Scoped OAuth exists, but only via a registered OAuth app + browser consent flow, which does not fit the per-subagent local-stdio isolation pattern this connection uses.

**Therefore the token can always write.** All read/write separation in this server is enforced **in the server process**, not at the credential layer. On the connection-architecture "enforcement ladder" this is the **server layer** (strong: holds regardless of harness behavior) — but it is softer than a credential-layer guarantee, because the same token, used by a different process, could still write. This is stated plainly, not hidden.

---

## Env-gated read-only mode

The server reads `TODOIST_READONLY` **once, at process startup**, when it registers tools:

| `TODOIST_READONLY` | Mode | Write tools |
| --- | --- | --- |
| unset / empty | **read-only** (fail-safe default) | **not registered — do not exist in the process** |
| `true` / `0` / anything ≠ `false` | read-only | not registered |
| `false` (exact string) | read/write | registered |

When read-only, the write tools are **not registered at all** — they are absent from the process, not merely hidden or rejected. This is **not a runtime toggle**; nothing flips it mid-session. Which mode you get is decided entirely by the launching environment (i.e. which subagent frontmatter launched the process).

### What read-only mode does and does NOT protect against

- **Does:** cap the blast radius of a *data-borne* injection during a read session. If a task or comment contains "delete everything in project X" and the reading process has **no write tools registered**, the injected instruction has nothing to call.
- **Does NOT:** protect against a **compromised orchestrator** that can choose to invoke a write-capable process. Read-only mode is not a defense against orchestrator compromise, and this README does not claim it is.

---

## Tool set

Read tools are registered in **all** modes. Write tools are registered **only** when `TODOIST_READONLY=false`.

### Read tools (all modes)

| Tool | Todoist API v1 endpoint(s) |
| --- | --- |
| `find-tasks` | `GET /tasks` — or `GET /tasks/filter?query=` when a filter `query` is supplied. Also narrows by `project_id` / `section_id` / `label` / `parent_id` / `ids`. |
| `find-tasks-by-date` | `GET /tasks/filter?query=<date filter>` — builds the filter from a `preset` (today / overdue / next7days / nodate / recurring) or a `date` + `comparison` (on / before / after). |
| `find-projects` | `GET /projects` |
| `find-sections` | `GET /sections` (optionally `?project_id=`) |
| `find-labels` | `GET /labels` |
| `find-comments` | `GET /comments?task_id=` **or** `?project_id=` (exactly one required) |
| `get-overview` | Aggregates `GET /projects` + `GET /sections` + `GET /labels` + `GET /tasks` into a compact GTD overview (per-project active-task counts, sections, labels, due-today / overdue counts). |

### Write tools (only when `TODOIST_READONLY=false`)

| Tool | Todoist API v1 endpoint(s) |
| --- | --- |
| `add-tasks` | `POST /tasks` (one call per task; batch input) |
| `update-tasks` | `POST /tasks/{id}` |
| `complete-tasks` | `POST /tasks/{id}/close` |
| `uncomplete-tasks` | `POST /tasks/{id}/reopen` |
| `reschedule-tasks` | `POST /tasks/{id}` with `due_string` / `due_date` / `due_datetime` |
| `add-comments` | `POST /comments` |
| `add-projects` | `POST /projects` |
| `add-sections` | `POST /sections` |
| `add-labels` | `POST /labels` |

### Never implemented / never registered (any mode)

`delete-object` (deletion is a **manual, human-only** operation), `manage-assignments`, `list-workspaces`, `find-project-collaborators`, `get-workspace-insights`, `analyze-project-health`, `get-productivity-stats`, `get-project-activity-stats`, `project-health`, `reorder-objects`, `project-move`, `add-reminders`, `add-filters`, `update-filters`.

There is **no delete tool of any kind.** Removing a task, project, section, or label is done by a human in Todoist directly. Reminders and filters may be added later if adopted; they are deliberately out of scope for now.

---

## In-server injection mitigations

Ingress is the **read path**: untrusted content enters agent context when a tool *reads* task/description/comment/project/section/label text. All of the following are built in:

1. **Content framing** — every untrusted field value is wrapped in explicit `‹UNTRUSTED›…‹/UNTRUSTED›` delimiters marking it as data, not instructions, with a leading notice on every read result. A field cannot forge a closing fence (any embedded fence marker is neutralized).
2. **HTML/markdown stripping** — HTML tags/comments are removed, markdown links/images/emphasis/code markers are defanged, and control characters are stripped, before framing.
3. **Output-size caps** — total text returned by any read tool is bounded (`TODOIST_MAX_OUTPUT_CHARS`, default 50000) and each field is capped (`TODOIST_MAX_FIELD_CHARS`, default 2000); pagination is bounded (`TODOIST_MAX_ITEMS`, default 200). A huge list cannot flood context.
4. **SSRF allowlist** — every outbound request is pinned to `https://api.todoist.com`. Any other host, or non-HTTPS scheme, is rejected before a socket opens.
5. **Token redaction** — the API token is registered as a secret at startup and scrubbed from all logs and error messages; `Bearer …` / `Authorization:` material is also redacted generically. Logs go to **stderr** only (stdout is the MCP transport).
6. **Env-gated read-only registration** — as described above.

> A *full* prompt-injection threat model for this connection is deliberately deferred (a task list is a narrower, lower-stakes blast radius than a mailbox). The six mitigations above are the agreed baseline.

---

## Configuration

All configuration is environment-based and read **once** at startup. See `.env.example`.

| Variable | Default | Meaning |
| --- | --- | --- |
| `TODOIST_API_KEY` | — | The Todoist personal API token. Full read+write (see constraint above). |
| `TODOIST_API_KEY_FILE` | — | Alternative to the above: path to a file whose contents are the token. Used if `TODOIST_API_KEY` is unset. Preferred for deployment (keeps the token out of the agent file and process listing). |
| `TODOIST_READONLY` | *(unset → read-only)* | `false` enables writes; anything else is read-only. |
| `TODOIST_MAX_OUTPUT_CHARS` | `50000` | Whole-response output-size cap per read tool. |
| `TODOIST_MAX_FIELD_CHARS` | `2000` | Per-field truncation cap for untrusted text. |
| `TODOIST_MAX_ITEMS` | `200` | Max items fetched across pagination per read call. |

### Credential storage (deployment)

Follow the M365 / Fastmail file precedent on the host (LegioNix):

- Store the token in a file **owned by `claudecode`**, mode **`0600`**, inside a directory mode **`0700`** — e.g. `/home/claudecode/.todoist-mcp/token`.
- Point the subagent at it with `TODOIST_API_KEY_FILE=/home/claudecode/.todoist-mcp/token`.
- **Never commit a real token.** `.gitignore` excludes `.env`, `*.token`, and `secrets/`.

```bash
install -d -m 0700 -o claudecode -g claudecode /home/claudecode/.todoist-mcp
printf '%s' 'YOUR_TODOIST_TOKEN' > /home/claudecode/.todoist-mcp/token
chmod 0600 /home/claudecode/.todoist-mcp/token
```

---

## Running

```bash
npm install

# read-only (default)
TODOIST_API_KEY=... node src/index.js

# read/write
TODOIST_API_KEY=... TODOIST_READONLY=false node src/index.js
```

The server speaks MCP over **stdio**. It is intended to be launched by a Claude Code subagent via inline `mcpServers` frontmatter — see `.claude/agents/todoist.md`, which follows the `m365-briefing` isolation pattern.

---

## Tests

```bash
npm test                 # offline suite (registration, config, sanitize, redact, client/SSRF, MCP e2e)

# real spawned-process checks (fake token; tools/list makes no network call)
TODOIST_READONLY=true  node scripts/stdio-check.js
TODOIST_READONLY=false node scripts/stdio-check.js

# LIVE write round-trip — needs a real token, hits the real account
TODOIST_API_KEY=... TODOIST_READONLY=false npm run smoke
```

The offline suite covers: excluded tools absent in every mode; read-only vs. read/write registration split (verified both in-process and against a real spawned stdio process); content framing + markup stripping; forged-fence neutralization; per-field and whole-output size caps; token redaction (including on a deliberately triggered error); and the SSRF allowlist rejecting non-`api.todoist.com` hosts and non-HTTPS schemes.

The one acceptance test that **cannot** run offline is the live write round-trip (add + read-back + complete a throwaway task) — run `npm run smoke` with a real token to exercise it.

---

## Layout

```
src/
  index.js      stdio bootstrap; reads config once, connects transport
  server.js     builds the MCP server; env-gated tool registration
  config.js     env parsing; read-only default; token resolution (env or file)
  client.js     Todoist API v1 client; SSRF allowlist; pagination
  sanitize.js   framing + markup stripping + size caps (read-path ingress)
  shape.js      raw API object -> compact, sanitized result object
  redact.js     token/secret redaction
  logger.js     stderr logging (redacted)
  tools/read.js   the 7 read tools
  tools/write.js  the 9 write tools (registered only when writes enabled)
scripts/
  stdio-check.js  list tools from a real spawned process
  live-smoke.js   live write round-trip (needs a real token)
test/             offline test suite
.claude/agents/todoist.md   the read/write subagent (inline mcpServers frontmatter)
```
