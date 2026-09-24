**1–2. Properties, enforcement mechanisms, and ways around them**

Unless explicitly marked **Inference**, the mechanisms below are verified by reading the implementation. “Reproduced” means I also exercised the behavior locally.

1. **Startup defaults to read-only.**

   * **Mechanism:** `isReadOnly()` in `config.js` enables writes only for the exact environment value `TODOIST_READONLY=false`. `index.js:main()` loads configuration once.
   * **Way around:** The explicit `false` setting enables writes, as intended. Separately, a program calling `createServer()` directly with `readOnly` omitted enables writes because the condition is `if (!cfg.readOnly)`. That bypasses `loadConfig()`’s fail-safe default.
   * No MCP input that changes the startup mode was found.

2. **Read-only servers do not register the nine write tools.**

   * **Mechanism:** `createServer()` conditionally calls `registerWriteTools()`.
   * **Way around:** None found through the registered read tools.
   * **Boundary:** The write module is statically imported even in read-only mode, contrary to the comment saying it is never imported. `createClient().request()` has no read-only check and can send writes if called directly. This is a registration boundary, not a credential or HTTP-client restriction.

3. **Certain capabilities have no registered tool.**

   * **Mechanism:** The explicit registrations in `registerReadTools()` and `registerWriteTools()` omit deletion, assignment management, reminders, and the other excluded tools.
   * **Way around:** No registered delete operation was found. The exported HTTP client accepts arbitrary methods and relative paths, and the contract script directly performs `DELETE`.
   * **Boundary:** “No delete tool exists” is supported. “Deletion is necessarily human-only” is not enforced across the supplied code.

4. **Tool inputs have declared types and some value constraints.**

   * **Mechanism:** Zod schemas in the two registration functions declare positive integer limits, priority 1–4, enumerated presets/comparisons, nonempty write arrays, and required strings.
   * **Inference:** Actual rejection before handler execution depends on the absent MCP SDK/Zod versions. The declarations themselves are verified.
   * **Way around broader validation claims:** IDs are arbitrary strings; dates are arbitrary strings; string and batch lengths generally have no upper bound. `reschedule-tasks` requires at least one truthy due field, not exactly one. Multiple conflicting due fields pass the declared refinement.

5. **Comment operations require one target.**

   * **Mechanism:** The `find-comments` and `add-comments` handlers explicitly reject both truthy IDs or neither truthy ID.
   * **Way around:** Empty strings are treated as absent. A supplied empty second ID can remain in an `add-comments` request body.
   * No way to send two nonempty target IDs through those checks was found.
   * **Boundary:** `add-comments` validates each item immediately before writing it. An invalid later item can produce an error after earlier comments have already been created.

6. **Production HTTP requests use HTTPS and the Todoist API hostname.**

   * **Mechanism:** `request()` concatenates `API_BASE` and its path, applies query parameters with `URL.searchParams.set()`, then calls `assertAllowedUrl()`. That function checks `protocol` and `hostname`.
   * **Way around:** No off-host request path through the registered tools was found.
   * **Narrower than the comment:** `assertAllowedUrl('https://u:p@api.todoist.com:8443/x')` succeeds, reproduced locally. It does not enforce port, userinfo, or API path. The normal fixed-base call path does not expose those choices to MCP callers.
   * It does not validate resolved IP addresses or independently establish DNS/TLS integrity.

7. **Production requests do not follow redirects.**

   * **Mechanism:** `request()` uses `redirect: 'manual'`, rejects every 300–399 response, and excludes `Location` from its error.
   * **Way around:** None found in that client path, assuming the runtime honors the fetch option.
   * **Other supplied paths:** `verifyContractTestAccount()` and the direct fetches in `update-task-partial.contract.js` omit this option. The production-client guarantee does not cover those scripts.

8. **Task IDs are encoded before insertion into write paths.**

   * **Mechanism:** `update-tasks`, `complete-tasks`, `uncomplete-tasks`, and `reschedule-tasks` use `encodeURIComponent(id)`.
   * **Way around:** Dot segments survive encoding. For example, `id: '..'` in an update constructs `/api/v1/tasks/..`, which `new URL()` normalizes to `/api/v1/`. Reproduced.
   * This escapes the intended task-resource path while retaining the allowed hostname. Whether the resulting endpoint performs any operation depends on Todoist. I did not establish an unauthorized write or deletion from this behavior.

9. **Missing credentials stop normal startup; token-file read failures suppress filesystem details.**

   * **Mechanism:** `resolveToken()` trims the direct token or file contents, gives the direct token precedence, and replaces file-read errors with a fixed message. `loadConfig()` throws if neither source yields a token.
   * **Way around:** No missing-token bypass through `loadConfig()` was found.
   * **Inference, unsupported by enforcement:** The comments describe a `0600`, specifically owned token file. No ownership, mode, symlink, or file-type check exists. Any readable file with nonempty trimmed contents is accepted.

10. **Registered literal secrets are removed from strings passing through the redactor.**

    * **Mechanism:** `createServer()` calls `registerSecret(cfg.apiKey)`. `redact()` replaces exact registered strings and matches selected Bearer/Authorization forms.
    * **Ways around:**

      * `registerSecret()` ignores strings shorter than four characters, while `loadConfig()` accepts them. The supplied `tok` fixture leaks in an API error, reproduced.
      * Direct `createClient()` use does not register its token.
      * JSON escaping can defeat exact matching. Registering `ab"cd` and returning it in a payload produces `ab\"cd` on the wire, from which the original value is recoverable. Reproduced.
      * `Authorization: Basic abcdefghijklmnop` becomes `Authorization: [REDACTED] abcdefghijklmnop`. The credential remains. Reproduced.
      * Encoded, split, or transformed secrets are outside exact-string matching.
    * Actual Todoist token-format restrictions are not established by this source.

11. **Application logging uses stderr and passes messages through redaction.**

    * **Mechanism:** `logger.js:emit()` redacts messages and serialized metadata, then writes to stderr. `request()` logs method/path, not headers, bodies, or query values. Fatal entry-point messages also call `redact()`.
    * **Way around:** The redaction limitations above apply. Metadata is serialized before redaction, allowing escaped representations to survive.
    * No application logger call writing to stdout was found in `src/`.
    * **Boundary:** This does not cover dependency diagnostics, runtime crashes, process inspection, or the direct `console` calls in the scripts. No logging test establishes those boundaries.

12. **Current registered handlers use one result builder.**

    * **Mechanism:** Success handlers and their catch wrappers call `buildResult()`.
    * **Way around the broader uniform-protection claim:** Its branches enforce different properties:

      * Success: serialize/cap, prepend notice, redact.
      * Error: redact the message and prefix `Error:`.
    * Errors receive no `safeField()`, no untrusted notice, and no output cap. An error containing `<b>OBEY</b> https://evil.example` is emitted with that markup and URL intact, reproduced.
    * SDK-generated validation/protocol errors occur outside these handler wrappers; their treatment cannot be established here.

13. **Selected prose fields are sanitized, and unselected API fields are omitted.**

    * **Mechanism:** `shapeTask()`, `shapeProject()`, `shapeSection()`, `shapeLabel()`, `shapeComment()`, `shapeDue()`, and `frameLabels()` explicitly construct outputs. Write handlers sanitize echoed content/name fields.
    * **Way around:** The selected structural fields are copied without type validation or sanitization. A returned `priority` object or instruction-bearing `due.timezone` survives unchanged. Reproduced with constructed API objects.
    * Whether an account user can cause Todoist to return those malformed values is unknown.
    * No direct pass-through of task/project `url` or attachment URL fields was found.

14. **The sanitizer removes specified markup patterns and ASCII control characters.**

    * **Mechanism:** `stripMarkup()` uses regex replacements for literal comments, tag-shaped strings, inline Markdown links, selected formatting characters, and selected ASCII controls.
    * **Ways around broader “markup-free” claims:**

      * Ordered and hyphenated Markdown lists survive.
      * Unicode bidirectional and other non-ASCII formatting controls survive.
      * Entity-encoded comments are decoded after the sole comment-removal pass, so their comment contents remain.
      * This is a finite sequence of regex transformations, not validation against a renderer grammar.
    * `decodeHtmlEntities()` also throws for out-of-range numeric entities. `&#x110000;` produces `Invalid code point 1114112`, reproduced. One such field can turn an entire read operation into an error.

15. **Recognized HTTP(S) strings are defanged.**

    * **Mechanism:** `stripMarkup()` matches a word-boundary HTTP(S) pattern; `defangUrl()` changes `http` and dots. It then removes inline-link syntax.
    * **Ways around, reproduced:**

      * `ht[tp](x)://evil.example/path` becomes **`http://evil.example/path`**. Link removal assembles the URL after the defanging pass.
      * `www.evil.example/path` remains unchanged.
      * `ftp://evil.example/path` remains unchanged.
      * `xhttps://evil.example/path` retains its HTTPS substring because the initial word-boundary requirement fails.
    * Unsanitized success fields and error messages provide additional paths.
    * Consequently, the implementation does not guarantee that output contains no reparsable URLs. Actual clickability additionally depends on the renderer.

16. **Nonempty sanitized fields receive delimiters; exact embedded delimiters are replaced.**

    * **Mechanism:** `safeField()` replaces exact `FRAME_OPEN`/`FRAME_CLOSE` occurrences before wrapping the value. Empty sanitized values return `''`.
    * **Way around:** No escape from the exact-marker replacement inside a completed `safeField()` result was found.
    * **Boundary:** `capOutput()` can later cut away the closing delimiter. Other fields and errors are never fenced.
    * **Inference, not enforcement:** The notice intends to make the model treat content as data. Plain instructions survive sanitization, and no code controls whether a model follows them.

17. **Each sanitized field has a retained-content limit.**

    * **Mechanism:** `safeField()` slices transformed text to `maxFieldChars`, defaulting to 2,000, before appending its truncation marker and delimiters.
    * **Ways around a total-field-size interpretation:** Delimiters and the marker exceed the configured value. The limit counts JavaScript string units, not bytes or model tokens.
    * Unsanitized fields have no per-field cap. Sanitization processes the full input before slicing, so this is not a processing-cost or input-memory bound.

18. **Successful payloads have a retained serialized-prefix limit.**

    * **Mechanism:** `capOutput()` slices the serialized payload to `maxOutputChars`; `buildResult()` then adds the notice and redacts.
    * **Ways around a total-response-size interpretation:**

      * The notice and truncation suffix are additional.
      * Redaction afterward can expand the output.
      * Errors bypass the cap.
      * JSON and field delimiters can be cut mid-value.
    * Reproduced: `maxOutputChars: 30` produced a 310-character successful response with an unterminated field fence.
    * Full serialization occurs before truncation, so it does not bound serialization memory.

19. **Pagination returns at most its effective item cap.**

    * **Mechanism:** `getPaginated()` requests at most 200 items per page, stops when accumulated items reach its cap, and returns `items.slice(0, cap)`.
    * **Ways around broader resource/configuration claims:**

      * Read-tool `limit` replaces `cfg.maxItems`; it is not bounded by it.
      * Overview task/today/overdue fetches explicitly use 5,000 each.
      * Configuration accepts arbitrarily large positive parsed integers.
      * Empty pages with a continuing cursor do not advance the item count. There is no repeated-cursor detection, page-count limit, application timeout, or response-body byte limit.
      * A server can return more than the requested page size; it is read and accumulated before slicing.
      * Write batches have no corresponding item limit.

20. **Pagination and overview attempt to disclose incomplete results.**

    * **Mechanism:** `getPaginated()` returns `truncated`; the overview handler propagates it into `fetches`, `is_floor`, and warnings.
    * **Way around:** With cap 2, a cursor-form response containing three results and `next_cursor: null` returns two items and `truncated: false`. Reproduced.
    * Bare arrays filling the requested page are conservatively called truncated even if actually complete.
    * Overview prefixes its lists with diagnostic fields, but a sufficiently small output cap can truncate those diagnostics too.
    * Counts are not deduplicated or protected against changes between pages. “Floor of unique tasks” therefore also relies on upstream behavior.

21. **Overview does not output fetched task prose.**

    * **Mechanism:** Its handler uses task objects for lengths and project-ID counts; it does not pass task titles/descriptions into the payload.
    * **Way around:** No task-prose output path in overview was found. Project, section, and label names still enter output through their shaping paths.
    * The full task responses are nevertheless downloaded and parsed.

22. **Two live checks verify a configured account ID before writes.**

    * **Mechanism:** `verifyContractTestAccount()` retrieves `/user` and compares its ID with `TODOIST_CONTRACT_TEST_ACCOUNT_ID`. The contract script and `live-smoke.js` call it first; the latter uses the contract token for subsequent calls.
    * **Way around broader “never personal account” language:** Configure the expected ID and token for the personal account. The guard proves an ID match, not that the account is disposable.
    * `live-smoke-date.js` does not use that guard and accepts ordinary Todoist credentials.
    * The guard normally returns only `id` and `email`; however, it neither sanitizes those fields nor wraps fetch failures with redaction. Its fetch also follows redirects by default.

**3. What the tests establish, and where they can pass vacuously**

The failures below distinguish an individual weak assertion from a gap in the whole suite. A separate unit test sometimes catches what an integration assertion misses.

| Test                                                                                                                                    | Why it can pass; change or violation it would miss                                                                                                                                                                                                                                                                                |
| --------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `client.test.js` — **“API error text never leaks the token”**                                                                           | Checks only `err.status === 401`. The fixture actually leaks `tok` today and the test passes. Removing error redaction would not make this assertion fail.                                                                                                                                                                        |
| `client.test.js` — **“assertAllowedUrl blocks host override attempts in the base path”**                                                | Supplies only `API_BASE + '/tasks'`. There is no override attempt. An always-accepting helper passes this individual test.                                                                                                                                                                                                        |
| `config.test.js` — **“an unreadable key file surfaces a config error without leaking the path contents”**                               | Only matches the expected error phrase. Appending the original exception, including its sensitive path, still passes.                                                                                                                                                                                                             |
| `config.test.js` — **“loadConfig throws without a token and never echoes it”**                                                          | No token is supplied. The non-disclosure claim is not exercised.                                                                                                                                                                                                                                                                  |
| `mcp-e2e.test.js` — **“read tool output is framed and strips markup; token never leaks”**                                               | Expected framing is computed using the same `safeField()` as production. Removing framing from that helper while retaining stripping leaves this integration test satisfied. The token exists in the request header, but not the returned fixture, so disabling result redaction also passes its token assertion.                 |
| `mcp-e2e.test.js` — **“write tool echoes framed/stripped/capped content, exactly as a read tool would (update-tasks, Invariant 12/2)”** | Also computes its oracle with production `safeField()`. Removing framing, removing the helper’s truncation, or breaking its bare-URL handling can affect expected and actual output identically. Independent assertions still catch the particular HTML and inline-link regressions they check.                                   |
| That same write-echo test                                                                                                               | Sets `maxFieldChars: 2000`, exactly the helper default. Dropping the configuration argument or hardcoding 2,000 in the write handler would pass.                                                                                                                                                                                  |
| `mcp-e2e.test.js` — **“read tool enforces the output-size cap on a large list”**                                                        | Asserts only the presence of `output truncated`. Appending that phrase without truncating passes. Its fixture exceeds both 2,000 and the 50,000 default, so ignoring the configured 2,000 cap can also pass.                                                                                                                      |
| `mcp-e2e.test.js` — normal-content secret test and both **“a plain Error … never leaks”** tests                                         | Each manually registers its secret. Removing `createServer()`’s token registration would not be detected by these tests. Their redaction assertions are otherwise exercised with actual secret-bearing output.                                                                                                                    |
| `invariant4-todoist-allowlist.test.js` — **“REGRESSION CHECK: no Todoist task url survives in find-tasks output”**                      | Does not require success or prove the task was returned. Replacing the handler with a generic error or empty result can satisfy the negative assertions.                                                                                                                                                                          |
| `registration.test.js` — all three registration tests                                                                                   | Inspect returned name arrays, not the SDK’s actual registry. Registering an additional tool without recording it in those arrays passes. The MCP read-only listing test independently catches an advertised extra tool when runnable.                                                                                             |
| `mcp-e2e.test.js` — **“client sees write tools only in read/write mode”**                                                               | Checks two write names and total count 16. Replacing a different expected tool with an unwanted tool can pass this particular test.                                                                                                                                                                                               |
| `result-builder-shape.test.js` — **“Invariant 12: a tool result object is constructed in exactly one place…”**                          | Detects a limited object-literal syntax and asserts one file, not one construction point or universal data flow. A handler returning `{ content: blocks }`, using computed properties, or modifying a builder result afterward can bypass it. Removing protections inside `buildResult()` also leaves this structural test green. |
| `no-url-key-in-output.test.js` — **“no object literal … emits a url key”**                                                              | Misses shorthand `{ url }`, computed keys, spreads, `file_url`, and URLs under unrelated keys. Those changes can introduce URLs while the test passes.                                                                                                                                                                            |
| `framing-assertion-shape.test.js` — **“no positive .includes() check against the untrusted-value fence markers appears in test/”**      | Checks test syntax, not framing. It does not catch `text.includes('‹UNTRUSTED›')`, aliases, regex equivalents, or the shared-helper oracle problem. Removing production framing does not affect this test.                                                                                                                        |
| `sanitize.test.js` — **“safeField frames untrusted values in explicit delimiters”**                                                     | Uses the implementation’s exported marker values. Changing both markers to empty strings makes its `startsWith`/`endsWith` assertions vacuous. Other tests may catch that mutation.                                                                                                                                               |
| `sanitize.test.js` — **“safeField enforces the per-field character cap”**                                                               | Requires a truncation marker and total length below 200, not retention of exactly at most 100 content units. A wrong cap such as 150 can pass.                                                                                                                                                                                    |
| `sanitize.test.js` — **“capOutput truncates oversized payloads with a notice”**                                                         | Requires length below 700 for cap 500. Retaining 550 characters plus the current suffix can pass. It does not test `buildResult()`’s final response length.                                                                                                                                                                       |
| Both **“numeric HTML entities are decoded before tag-stripping”** tests                                                                 | Assert absence of tags/entities, not preservation of decoded text or actual pass order. Simply deleting entity sequences could pass without establishing the claimed mechanism.                                                                                                                                                   |
| `get-overview-truncation.test.js` — **“D-1: signal keys precede the name lists so capOutput cuts the lists first”**                     | Establishes key order, but never forces truncation. Disabling capping or cutting diagnostic content under a small cap is not detected.                                                                                                                                                                                            |
| `get-overview-truncation.test.js` — **“D-2: the description says the counts come from Todoist’s filters in the account’s timezone”**    | Checks only for words matching `filter` and `timezone`. Contrary wording containing those words passes. It does not establish API timezone semantics.                                                                                                                                                                             |
| All description assertions in `find-tasks-query-supersedes-description.test.js`                                                         | Exercise published wording, not requests. Changing handler behavior while keeping the descriptions unchanged passes. They are wording tests, not evidence of enforced query scope.                                                                                                                                                |

The requested whole-response fence-substring defect is **not currently present in its simple form**: I found no positive `text.includes(FRAME_OPEN)` or `text.includes(FRAME_CLOSE)` assertion. The notice contains both markers, but the two integration tests instead use `includes(expectedFramed)`. That avoids notice-only satisfaction while introducing the shared-helper problem described above.

The remaining security assertions have these evidence boundaries:

| Tests                                                                                              | What they establish; what remains outside them                                                                                                                                                                                        |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `config.test.js` — token file sourcing; direct-token priority                                      | Exercise resolution using injected file readers. Do not establish real file permissions, ownership, or symlink behavior.                                                                                                              |
| `config.test.js` — read-only default; exact `"false"`                                              | Independently assert the listed environment cases. No vacuity found for those cases. They do not cover direct `createServer()` configuration.                                                                                         |
| `config.test.js` — cap parsing/defaults                                                            | Exercises nondefault `maxItems` and `maxOutputChars`. Never supplies nondefault `TODOIST_MAX_FIELD_CHARS`, so ignoring that variable would pass.                                                                                      |
| `client.test.js` — HTTPS/hostname allowlist                                                        | Independently rejects the listed bad URLs. Does not test ports, credentials, path boundaries, or whether `request()` calls the validator.                                                                                             |
| `client.test.js` — cursor following; item cap                                                      | Exercise their stated examples, including an explicit nondefault cap of four. Do not establish cursor progress, response-size bounds, or a configured ceiling on caller limits.                                                       |
| All nine redirect tests in `invariant5-redirect-ssrf.test.js`                                      | Assert the fetch option, refusal, and request count for their fixtures; relevant cases also reject echoed Location text. No vacuity found for those mocked paths. They do not test real network behavior or the separate scripts.     |
| `redact.test.js` — registered token; unregistered Bearer; Authorization value; error message/stack | Supply actual secret material and independently check its removal. No vacuity found for those examples. Basic authentication, escaped secrets, short registration, and startup wiring remain untested.                                |
| `sanitize.test.js` — HTML/comments; Markdown link/emphasis; forged closing fence; empty inputs     | Exercise the stated examples directly. No vacuity found for those narrow cases. They do not establish full Markdown removal, Unicode handling, all delimiter variants, or model noncompliance with injected instructions.             |
| All ten **“stripMarkup defangs uniformly”** cases                                                  | Check independent output properties and require a defanged marker, preventing an empty-output shortcut. They miss post-defanging URL reconstruction and other schemes/carriers.                                                       |
| All fourteen URL-embedding cases                                                                   | Reject HTTP(S) strings and the selected host patterns for seven carriers through two helpers. Negative-only checks would also accept deletion of all text. They do not exercise the reconstruction input reproduced above.            |
| Four direct D-5 task/project shape cases                                                           | Actually supply a `url` and assert its omission. They establish absence of that key, not absence of URLs under another key.                                                                                                           |
| Two D-5 `add-tasks` echo cases                                                                     | Require success, parse the payload, verify the fixture ID, and then check key absence. They avoid the wrong-result vacuity of the other URL regression test.                                                                          |
| Five R17 pagination tests                                                                          | Exercise cap-seven boundaries independently, including overlong bare arrays. They omit overlong **cursor-form** pages with null cursors, which produce the reproduced false completeness flag.                                        |
| Overview D-1 count, ceiling, truncation, orphan, and note-removal tests                            | Use nondefault `maxItems: 37` and independent expected values. They are not merely comparisons against production helpers. They omit malformed pagination, duplicate items, concurrent account changes, and actual output truncation. |
| Overview D-2 filter count/query/floor tests                                                        | Distinguish filter fixtures from task dates and assert actual requested queries. They establish delegation to those mocked filters, not live timezone behavior.                                                                       |
| MCP **“client sees exactly the read tools in read-only mode”**                                     | Checks the actual advertised list independently. It does not attempt a write invocation or establish account-token restrictions.                                                                                                      |

Additional supplied executable checks:

* **`update-task-partial.contract.js`:** Its request-body check examines the exact object subsequently serialized. That part is not circular with production. However, the script bypasses the MCP implementation entirely. It can pass if production `update-tasks` sends different fields or returns unsanitized content. Also, observing `content` plus `priority` does not prove that the response contains *all* current task state.
* **`scripts/live-smoke.js`:** Prints read and completion results without asserting success or read-back identity. Those calls can return tool errors while the script prints its success conclusion. It does require a parseable task ID from creation.
* **`scripts/stdio-check.js`:** Prints the tool list and exits successfully. It asserts no read-only property.
* **`scripts/live-smoke-date.js`:** Checks tool errors, recorded statuses, task presence, and cleanup. Its claimed routing conclusion is weaker: recorded endpoint paths are printed but not asserted against `/tasks/filter`. It also has no contract-account guard.

There are no supplied assertions covering error framing/capping, unsanitized scalar types, dot-segment IDs, token-file permissions, cursor nonprogress, write-batch bounds, or adversarial model behavior.

**4. Values reaching tool output without `safeField()`**

All successful values below still encounter serialization, whole-payload truncation, and final redaction. Those operations do not validate their type or remove instructions/URLs.

For account influence, **Inference** means the relationship is suggested by field use and naming but requires the Todoist contract to establish actual accepted contents.

| Output path                                                               | Unsanitized values                                                          | Can the Todoist account user influence contents?                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `shapeTask()`                                                             | `id`                                                                        | **Inference:** Server-assigned; arbitrary user-selected contents are not established.                                                                                                                                                                              |
| `shapeTask()`                                                             | `project_id`, `section_id`, `parent_id`                                     | **Inference:** User can influence relationships and therefore which IDs appear. Arbitrary ID text is not established.                                                                                                                                              |
| `shapeTask()`                                                             | `priority`                                                                  | User input is forwarded by add/update tools, constrained there to 1–4. API response validation is absent.                                                                                                                                                          |
| `shapeTask()`                                                             | `due.date`, `due.datetime`, `due.timezone`, `due.is_recurring`              | User can submit scheduling strings/dates through these tools. **Inference:** Todoist derives or validates returned values. Arbitrary returned text is not ruled out locally.                                                                                       |
| `shapeTask()`                                                             | `deadline` from `deadline.date`                                             | User can submit `deadline_date`. Returned format depends on Todoist.                                                                                                                                                                                               |
| `shapeTask()`                                                             | `is_completed` from `is_completed` or `checked`                             | User can influence completion through the provided tools. Returned boolean typing is assumed.                                                                                                                                                                      |
| `shapeTask()`                                                             | `created_at`/`added_at`, `completed_at`                                     | **Inference:** Actions influence event timing; server-generated timestamp contents are not arbitrarily user-writable.                                                                                                                                              |
| `shapeProject()`                                                          | `id`, `parent_id`                                                           | **Inference:** Generated identity; selectable relationship. No response-type validation.                                                                                                                                                                           |
| `shapeProject()`                                                          | `is_inbox_project`/`inbox_project`, `is_favorite`, `is_archived`            | `is_favorite` is supplied through this server. **Inference:** Other values depend on account state and Todoist actions.                                                                                                                                            |
| `shapeProject()`                                                          | `color`, `view_style`                                                       | Both are forwarded by `add-projects`. Local input constrains `view_style` to `list`/`board`, but accepts any string for `color`. Upstream acceptance is unknown.                                                                                                   |
| `shapeSection()`                                                          | `id`, `project_id`, `order` from `section_order`/`order`                    | Project and order are caller-supplied on creation. **Inference:** Identity is generated; returned representations are API-controlled.                                                                                                                              |
| `shapeLabel()`                                                            | `id`, `color`, `is_favorite`, `order`                                       | The latter three are accepted on creation. Color is an unrestricted input string locally. **Inference:** ID is generated.                                                                                                                                          |
| `shapeComment()`                                                          | `id`, `task_id`, `project_id`, `posted_at`/`posted`                         | Caller controls target selection. **Inference:** Identity and timestamps are server-generated.                                                                                                                                                                     |
| `find-tasks-by-date`                                                      | `filter`                                                                    | Contains caller-controlled `date` verbatim inside a query, or a fixed preset. An account user who can call MCP can directly supply it; stored account text alone has no automatic path into this argument. Success echo depends on API acceptance.                 |
| `add-tasks`, `add-comments`, `add-projects`, `add-sections`, `add-labels` | Returned object `id`                                                        | **Inference:** Generated by Todoist. No validation prevents a malformed response from returning arbitrary text or an object.                                                                                                                                       |
| `update-tasks`, `reschedule-tasks`                                        | Caller-supplied `id`                                                        | Directly controlled by the MCP caller. Echo occurs after the API request succeeds. This is not proof an account user can choose actual Todoist IDs.                                                                                                                |
| `complete-tasks`, `uncomplete-tasks`                                      | Caller-supplied `ids[]`                                                     | Same distinction: unrestricted strings locally, but success depends on upstream handling.                                                                                                                                                                          |
| `get-overview` projects                                                   | `id`, `is_inbox_project`                                                    | Same influence as the corresponding project fields.                                                                                                                                                                                                                |
| `get-overview.unmatched_sections[]`                                       | `project_id`                                                                | **Inference:** User influences section placement; arbitrary ID contents are not established.                                                                                                                                                                       |
| Read results and overview                                                 | Counts, fetched counts, `truncated`, `is_floor`                             | Users influence counts by changing account contents. These are locally derived numbers/flags, not copied prose. Their accuracy depends on pagination behavior.                                                                                                     |
| Write results                                                             | `created`, `updated`, `completed`, `reopened`, `rescheduled`, `added`, `ok` | Locally generated numbers/booleans. Callers influence batch sizes and whether operations succeed.                                                                                                                                                                  |
| Overview                                                                  | Warning strings                                                             | Fixed application prose with derived numbers. Account contents can trigger them and affect numbers, not directly replace the prose.                                                                                                                                |
| `buildResult()` success envelope                                          | Notice, JSON keys, content type, truncation suffix                          | Application constants; the configured cap contributes to the suffix. No normal account-content control.                                                                                                                                                            |
| `buildResult()` error envelope                                            | Error message                                                               | May contain up to 500 characters of upstream error-body text, request path, network/runtime error text, or fixed validation text. MCP callers influence IDs in paths. Whether Todoist reflects account text into errors is unknown. No sanitizing path is applied. |
| Tool registration metadata                                                | Tool names, titles, descriptions, schema descriptions                       | Static application text. No account-content influence found.                                                                                                                                                                                                       |
| SDK-generated protocol/validation output                                  | Unknown                                                                     | Cannot inventory without the dependency implementation/version. It does not necessarily pass through `buildResult()`.                                                                                                                                              |

The copied fields are not constrained to the scalar types their names imply. If an upstream JSON value is an object or array, it can carry nested arbitrary text through the same output path.

The prose paths that **do** use `safeField()` are task content/description/labels/due string, project/section/label names, comment content/attachment filename, and echoed write content/names. Task/project URLs and attachment URL/type metadata are omitted.

**5. What cannot be determined from this code alone**

* **Which unsanitized API fields actually accept arbitrary user-controlled text.** Needed: the relevant Todoist response/validation contract or controlled observations for IDs, colors, dates, timezones, flags, and error reflection.
* **Whether the constructed dot-segment paths cause an unintended operation.** Needed: Todoist’s handling of those normalized endpoints, trailing slashes, methods, and bodies.
* **Actual SDK input enforcement, unknown-property handling, and error output.** Needed: the deployed package manifest, lockfile, SDK/Zod versions, and runtime version.
* **Whether a host model follows instructions inside fenced content, errors, or structural fields.** Needed: the host’s instructions, tool-consumption behavior, and adversarial executions. String delimiters alone do not establish that property.
* **Whether surviving URL forms become clickable or trigger retrieval.** Needed: the actual renderer, URL recognizer, and agent browsing/tool policy.
* **Whether read-only invocation is protected from another write-capable process or direct token use.** Needed: launch configuration, credential access, filesystem permissions, and available execution capabilities.
* **Actual credential scope and account isolation.** Needed: token permissions and identity mapping. The production server performs no account-ID check.
* **Real network confinement.** Needed: runtime fetch behavior, proxy configuration, DNS/TLS trust, and network controls.
* **Operational resource limits.** Needed: process/container limits, client concurrency and cancellation, upstream size limits, and any external timeout/rate controls.
* **Whether live contract checks have ever passed against the deployed version.** Needed: their execution results. Their presence in the archive is not evidence of execution.
* **Atomicity or recovery after partial writes.** The code shows sequential writes without rollback or idempotency keys. Determining retry consequences requires upstream idempotency behavior and the host’s retry policy.
