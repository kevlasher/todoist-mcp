# todoist-mcp

A purpose-built, local-stdio [Model Context Protocol](https://modelcontextprotocol.io) server for a single personal Todoist (GTD) account. It exposes a deliberately narrow, fixed set of sixteen tools (seven read, nine write), an env-gated read-only mode, and in-server prompt-injection mitigations.

It is not a fork of any existing server. Two patterns (the SSRF allowlist and token redaction) were reimplemented from `MadLlama25/fastmail-mcp` as reference; everything else is written from scratch against the Todoist API v1.

---

## Why this exists

Off-the-shelf Todoist MCP servers were rejected because none offers a credential-level read-only tier reachable from local stdio, and all expose far more surface than ordinary GTD task management needs (deletion, reordering, assignment, workspace analytics, reminders, filters). This server instead exposes a controlled tool set, an env-gated read-only mode, and a set of in-server injection defenses, all auditable from this one repository.

### Credential constraint — read this first

Todoist's personal API token (`TODOIST_API_KEY`, from **Settings → Integrations → Developer**) is **always full read and write, account-wide**. Todoist has no scope, flag, or token tier that narrows a personal token to read-only. Scoped access exists only via a registered OAuth app and a browser consent flow, which doesn't fit a local-stdio deployment.

**The token itself can always write.** Read/write separation is enforced in this server's own process, not at the credential layer: on startup, the process reads `TODOIST_READONLY` once and decides whether to register any write tools at all (see below). That enforcement is real — a read-only process has no write tools to call, at all — but it holds only for as long as *this particular process* runs in the mode it was given. It does **not** hold regardless of what launches it: whatever starts this server decides which mode a given process gets, and the same token, handed to a different process, or to this server started with `TODOIST_READONLY=false`, can write. Nothing in this codebase can constrain that decision from the inside.

---

## Env-gated read-only mode

The server reads `TODOIST_READONLY` **once, at process startup**, when it registers tools:

| `TODOIST_READONLY` | Mode | Write tools |
| --- | --- | --- |
| unset / empty | **read-only** (fail-safe default) | **not registered — do not exist in the process** |
| `true` / `0` / anything ≠ `false` | read-only | not registered |
| `false` (exact string) | read/write | registered |

When read-only, the write tools are **not registered at all** — they are absent from the process, not merely hidden or rejected. This is not a per-call runtime check; nothing flips it mid-session. Which mode a given process gets is decided entirely by whatever launches it.

### Process lifetime changes what "read-only" means

Because the mode is fixed once, at startup, for the whole life of the process, what that guarantee actually buys you depends on how long the process lives — and that's decided by the MCP client that launches it, not by this server:

- **One process per invocation.** An MCP client that starts a fresh process each time it needs this server — for example, an inline server definition in an agent's frontmatter, connected when that agent starts and disconnected when it finishes — gets a fresh mode decision every time. Read-only unless that specific invocation was explicitly configured otherwise.
- **One long-lived process per session.** An MCP client that instead defines this server once (for example, in `.mcp.json`) and references it by name from multiple places shares a single connection across the whole session. Mode is decided once, at session start, and every call made anywhere in that session — regardless of which later request triggers it — shares that one decision.

The tool-registration guarantee itself is identical either way: a read-only process never has write tools, full stop. What differs is the unit the guarantee applies to. One process per invocation bounds each individual request. One process per session means the read-only default, if that's what was chosen at session start, protects everything in that session — but so does a write-capable choice made at session start, for the rest of the session, regardless of what any individual later request actually needed. Know which shape your deployment has before treating "it's read-only" as a per-request property.

### What read-only mode does and does not protect against

- **Does:** cap the blast radius of a *data-borne* injection during a read-only session. If a task or comment contains "delete everything in project X" and the process reading it has no write tools registered, the injected instruction has nothing to call.
- **Does not:** protect against a compromised or misconfigured **orchestrator** that can choose to invoke a write-capable process instead. Read-only mode is enforced at this server's own startup, based on the environment it's given — not against the intent of whatever set that environment. See "What this server does not defend against" below.

---

## Tool set

Read tools are registered in **all** modes. Write tools are registered **only** when `TODOIST_READONLY=false`.

### Read tools (all modes)

| Tool | Todoist API v1 endpoint(s) |
| --- | --- |
| `find-tasks` | `GET /tasks` — or `GET /tasks/filter?query=` when a filter `query` is supplied. The tool also accepts `project_id` / `section_id` / `label` / `parent_id` / `ids`, but **when `query` is given, none of those are sent to Todoist and have no effect** — nothing errors or warns. See Known defects, D-3. |
| `find-tasks-by-date` | `GET /tasks/filter?query=<date filter>` — builds the filter from a `preset` (today / overdue / next7days / nodate / recurring) or a `date` + `comparison` (on / before / after). |
| `find-projects` | `GET /projects` |
| `find-sections` | `GET /sections` (optionally `?project_id=`) |
| `find-labels` | `GET /labels` |
| `find-comments` | `GET /comments?task_id=` **or** `?project_id=` (exactly one required) |
| `get-overview` | Aggregates `GET /projects` + `GET /sections` + `GET /labels` + `GET /tasks` into a compact overview (per-project active-task counts, sections, labels, due-today / overdue counts). **Every number here is derived from fetches capped at `TODOIST_MAX_ITEMS` (default 200); on an account with more active tasks than that, counts are undercounts, not merely truncated, and nothing in the response tells you which you got.** "Today" is also computed in UTC on the server host, not any particular timezone. See Known defects, D-1 and D-2. This tool also takes no `limit` argument, unlike the other read tools — there's no way to raise its cap per call. |

### Write tools (only when `TODOIST_READONLY=false`)

| Tool | Todoist API v1 endpoint(s) |
| --- | --- |
| `add-tasks` | `POST /tasks` (one call per task; batch input) |
| `update-tasks` | `POST /tasks/{id}` — sends only the fields you supply; Todoist's response echoes the task's full current state regardless |
| `complete-tasks` | `POST /tasks/{id}/close` |
| `uncomplete-tasks` | `POST /tasks/{id}/reopen` |
| `reschedule-tasks` | `POST /tasks/{id}` with `due_string` / `due_date` / `due_datetime` |
| `add-comments` | `POST /comments` |
| `add-projects` | `POST /projects` |
| `add-sections` | `POST /sections` |
| `add-labels` | `POST /labels` |

None of the multi-item write tools retry automatically on partial failure, and none of them verify that a write achieved its intended effect beyond a non-error HTTP response — see "What this server does not defend against" below.

### Never implemented, in any mode

Deletion, reordering, reassignment, and anything touching reminders, filters, or workspace/analytics objects are not implemented as tools, in either mode, and never will be as this server is currently scoped. There is no delete tool of any kind — removing a task, project, section, or label is done by a human in Todoist directly.

---

## In-server injection mitigations

Task, comment, project, section, and label text in Todoist is writable by anyone with access to the account or a shared project — a collaborator, a synced integration, or an attacker with write access to a single object. That text becomes untrusted input the moment a tool reads it back into an agent's context. The following mitigations exist to stop it from being interpreted as instructions or from smuggling a clickable/parseable link back out. None of them are numbered here on purpose — `docs/SPEC.md` numbers the underlying controls differently (its own historical numbering includes a withdrawn control that never existed in code), and reusing bare numbers across the two documents would make them mean different things depending on which one you're reading.

- **Content framing** — every untrusted field value is wrapped in explicit `‹UNTRUSTED›…‹/UNTRUSTED›` delimiters marking it as data, not instructions. A notice explaining what those markers mean is prepended to **every response from all sixteen tools**, read and write alike — not read tools only — applied unconditionally, so its presence alone doesn't tell you whether that particular response actually contains anything framed. A field can't forge its own closing fence; any fence-marker text embedded in the value is neutralized before framing.
- **Markup stripping** — HTML tags and comments are removed, control characters are stripped, and markdown emphasis/code/heading/table/blockquote markup is defanged, before framing. Markdown links and images are handled differently from freestanding URLs: the link or image is replaced by its visible label only, and the URL inside it is **discarded** — it never reaches tool output at all, framed or otherwise.
- **Freestanding URL defanging** — a URL that appears as plain text, not inside markdown link syntax, is **defanged** rather than discarded: its scheme is broken (`hxxps://`) and its dots are bracketed, so a person can still read and manually reconstruct it, but nothing clickable or re-parseable reaches the agent. This applies uniformly to every host; there is no allowlist exemption for any domain. One structural field is a deliberate, narrower exception to all of the above — see Known defects, D-5.
- **Output-size caps** — every tool response, read and write alike, is capped in total size (`TODOIST_MAX_OUTPUT_CHARS`, default 50000), each individual field is capped (`TODOIST_MAX_FIELD_CHARS`, default 2000), and pagination is capped (`TODOIST_MAX_ITEMS`, default 200 — see `get-overview`'s entry above for what that cap means for counts).
- **SSRF allowlist** — every outbound request is validated against a fixed allowlist (`https://api.todoist.com`, exact host, HTTPS only) before it's sent. Any 3xx response from the API is treated as an error and never followed — there is no redirect-target validation logic, because no redirect is ever accepted in the first place. If Todoist ever introduces a redirect on an endpoint this server calls, that endpoint starts failing loudly rather than silently following it somewhere else.
- **Token redaction** — the API token is registered as a secret at startup and scrubbed from all logs and error messages; `Bearer …` / `Authorization:` material is redacted generically even for tokens that were never explicitly registered. Logs go to **stderr** only — stdout is reserved for the MCP transport.
- **Env-gated read-only registration** — as described above.

### What this server does not defend against

These aren't gaps scheduled to close — they're inherent to what a tool-registration-level control can do, stated plainly so nothing above is mistaken for a stronger guarantee than it is. See `docs/SPEC.md` section 3 for the full source list.

- **Least-privilege credentials are not possible.** The token this server holds is always full read/write on the whole account. This server can only choose which tools it exposes on top of that; it cannot narrow what the token itself is able to do.
- **Plain-English prompt injection is not defended against.** Framing and markup stripping stop markup- and link-based delivery of injected instructions. They do nothing against a task or comment that simply says, in plain English, "ignore your previous instructions and do X." Whether an agent acts on that is entirely the model's own instruction-following discipline — this server has no mechanism to enforce it.
- **A compromised or misconfigured orchestrator is not defended against.** Read-only mode is enforced at this server's own startup, based on whatever environment it's given. If the process that launches it is itself compromised, or configured to run write-capable against the operator's actual intent, nothing here catches that.
- **Writes are not verified to have taken effect.** A write tool reports success based on receiving a non-error HTTP response, not by comparing Todoist's returned state against what was actually asked for.
- **Partial batch writes are not rolled back.** A multi-item write (`add-tasks`, `update-tasks`, `reschedule-tasks`, `add-comments`) that fails partway leaves the earlier items in that batch already applied on Todoist's side, with no report of which items succeeded and no automatic retry — retrying a non-idempotent write risks creating duplicates, so none is attempted automatically.

---

## Known defects

Four defects are currently open. Each is qualified above, next to the tool it affects; they're named again here, together, because an agent or operator shouldn't have to go find `docs/SPEC.md` to learn that output can be wrong in these specific, known ways. Full root cause and fix criteria for each live in `docs/SPEC.md` section 10.

- **D-1 — `get-overview` counts can be wrong, not just incomplete.** Derived from fetches capped at `TODOIST_MAX_ITEMS` (default 200); accounts with more active tasks than that get undercounts with no signal distinguishing them from correct ones.
- **D-2 — `get-overview` computes "today" in UTC on the server host,** not in any particular user's timezone, misclassifying tasks near the date boundary.
- **D-3 — `find-tasks` silently discards its other filters when `query` is supplied.** `project_id`, `section_id`, `label`, `parent_id`, and `ids` are accepted alongside `query` but never sent and never take effect.
- **D-5 — a task's `url` field is a raw passthrough,** never framed or defanged like every other untrusted value, on the assumption that Todoist always builds it from the task id alone. Nothing in this server checks that assumption, and Todoist's URL namespace has at least one other form that embeds the task's own, attacker-writable title.

A fifth defect, D-4, is a startup configuration error message that names the wrong environment variable in some cases — it's noted under Configuration below rather than here, since it affects an operator's setup error, not tool output an agent or caller ever sees.

---

## Configuration

All configuration is environment-based and read **once** at startup. See `.env.example`.

| Variable | Default | Meaning |
| --- | --- | --- |
| `TODOIST_API_KEY` | — | The Todoist personal API token. Full read+write (see the credential constraint above). |
| `TODOIST_API_KEY_FILE` | — | Alternative to the above: path to a file whose contents are the token. Used if `TODOIST_API_KEY` is unset. Preferred for deployment — it keeps the token out of the process environment and any process listing. |
| `TODOIST_READONLY` | *(unset → read-only)* | `false` enables writes; anything else is read-only. |
| `TODOIST_MAX_OUTPUT_CHARS` | `50000` | Whole-response output-size cap per tool call. |
| `TODOIST_MAX_FIELD_CHARS` | `2000` | Per-field truncation cap for untrusted text. |
| `TODOIST_MAX_ITEMS` | `200` | Max items fetched across pagination per read call (affects `get-overview` accuracy — see D-1). |

If token resolution fails, the resulting error currently names `TODOIST_API_KEY` even in cases where you configured `TODOIST_API_KEY_FILE` instead and it was the problem (for example, an empty token file). Check both variables if you hit this. (`docs/SPEC.md` section 10, D-4.)

### Credential storage

- Store the token in a file with restrictive permissions — mode `0600`, inside a directory mode `0700` — rather than passing it as a bare environment variable where a process listing or a careless log line could catch it.
- Point `TODOIST_API_KEY_FILE` at that file.
- **Never commit a real token.** `.gitignore` excludes `.env`, `*.token`, and `secrets/`.

```bash
install -d -m 0700 /path/to/token/dir
printf '%s' 'YOUR_TODOIST_TOKEN' > /path/to/token/dir/token
chmod 0600 /path/to/token/dir/token
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

The server speaks MCP over **stdio**. Running it directly like this is mainly for local testing — in practice it's meant to be launched by an MCP client, most commonly declared inline in a Claude Code subagent's `mcpServers` frontmatter so each invocation gets its own process (see "Process lifetime" above for why that matters).

`docs/examples/todoist-subagent.md` is a worked, placeholder-path example of that launch, read-only by default. `docs/examples/README.md` explains how to adapt it and the two Claude Code runtime behaviors — folder-trust gating and inline-vs-by-name connection lifetime — that determine whether it actually connects.

---

## Tests

```bash
npm test                 # offline suite — registration, config, sanitize, redact, client/SSRF, MCP e2e
```

`npm test` runs `node --test test/` and never touches the network.

Two further layers do touch a live account, and both are guarded against writing to the wrong one:

```bash
# real spawned-process checks (fake token; tools/list makes no network call)
TODOIST_READONLY=true  node scripts/stdio-check.js
TODOIST_READONLY=false node scripts/stdio-check.js

# live write round-trip against a real account
TODOIST_API_KEY=... TODOIST_READONLY=false npm run smoke
```

`npm run smoke` (`scripts/live-smoke.js`) performs a real add / read-back / complete round-trip. It checks the supplied token against a designated account before writing anything and refuses to run against any other account — point it at a throwaway or test account's token, never a production one.

`test-contract/` holds a separate suite that asks the live Todoist API direct questions about its own behavior (for example, exactly which fields `POST /tasks/{id}` returns on a partial update), rather than testing this server's own code. It runs only when `TODOIST_CONTRACT_TEST_TOKEN` is set, is account-guarded the same way as the smoke script, and is deliberately excluded from `npm test` and from any test-on-save hook, so a live API call never fires as a side effect of editing a file.

---

## Versioning and publication status

This is version `0.1.0`. `server.json` at the repo root describes the server for the MCP Registry, using the registry's own server schema. Publishing to the registry itself is deferred.

---

## Layout

```
src/
  index.js        stdio bootstrap; reads config once, connects transport
  server.js       builds the MCP server; env-gated tool registration
  config.js       env parsing; read-only default; token resolution (env or file)
  client.js       Todoist API v1 client; SSRF allowlist; redirect refusal; pagination
  sanitize.js     framing + markup stripping + URL defanging + size caps
  shape.js        raw API object -> compact, sanitized result object
  redact.js       token/secret redaction
  logger.js       stderr logging (redacted)
  tools/read.js   the 7 read tools
  tools/write.js  the 9 write tools (registered only when writes are enabled)
scripts/
  stdio-check.js  list tools from a real spawned process
  live-smoke.js   live write round-trip (needs a real token; account-guarded)
test/             offline test suite
test-contract/    live-API contract tests (token-gated, account-guarded, excluded from npm test)
docs/
  SPEC.md         source of truth for invariants, decisions, and known defects
  examples/       a worked, placeholder-path example of launching this server as a
                   Claude Code subagent, and the README explaining how to adapt it
server.json       MCP Registry server descriptor
```
