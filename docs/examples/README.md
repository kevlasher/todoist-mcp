# Examples

Documentation, not configuration. Nothing in this directory is loaded by
anything at runtime, and editing a file here has no effect on any running
agent. This repository ships the MCP server. It does not ship a deployment
of it.

## Contents

- `todoist-subagent.md`: a worked example of a Claude Code subagent
  definition that launches this server read-only over stdio.

## About `todoist-subagent.md`

The definition that actually runs lives in whatever project consumes this
server, alongside that project's real paths and its real token location.
Those are exactly the contents that should not be published, which is why
the copy here uses placeholders and why it lives outside `.claude/agents/`.
A file in `docs/examples/` is inert because of where it is, and that
requires no product behavior to keep holding.

The example is worth shipping because this server's security posture is
decided by how it is launched, not by the server alone. A worked example of
a correct launch is load-bearing documentation.

Two things about it are deliberate:

**It launches read-only by omitting `TODOIST_READONLY` entirely,** not by
setting it to `"true"`. The server registers write tools only when that
variable is set to the exact string `false`. Every other value, absence
included, produces a read-only process. Setting `"true"` would give the
same result while teaching the wrong rule, because it invites the reader to
conclude that unsetting the variable enables writes.

**It declares the server inline** rather than referencing one configured
elsewhere. The reason is in the next section.

## Using it as a template

1. Copy the file into your own project's `.claude/agents/` directory, or
   into `~/.claude/agents/` if you want it available in every project.
   Claude Code loads subagent definitions from those two locations. They
   are not equivalent for security purposes; read the next section before
   choosing.
2. Replace both placeholder paths. `args` must point at the `src/index.js`
   of your checkout of this server, and `TODOIST_API_KEY_FILE` at the file
   holding your Todoist API token.
3. Leave `TODOIST_READONLY` absent unless you intend a write-capable
   process. A write-capable definition is not a matter of flipping one
   value: the body text of this example describes a process with no write
   tools registered, and it would be describing capabilities that do not
   exist.

## Two Claude Code behaviors that decide whether it works

Both were verified against Anthropic's published Claude Code subagent
documentation on 2026-09-16. This is a product convention rather than a
specification, so it can change without notice and is worth re-checking.

### The folder has to be trusted first

Claude Code prompts you to trust a folder the first time you run it there.
An inline MCP server declared in an agent file under a project's
`.claude/agents/` directory, or under the `.claude/agents/` of a directory
added with `--add-dir`, loads only after you have trusted the folder that
agent file came from. Until then Claude Code skips every inline server in
that file, and the subagent has no Todoist tools.

Trusting a parent folder does not count. A directory added with
`--add-dir` from outside your workspace's repository needs its own trust
entry, because its agent files do not inherit the workspace's grant.

An agent file in `~/.claude/agents/` is exempt: an inline server there
loads without a trust check on the folder, as does any entry that is a bare
string naming a server you configured elsewhere.

### Inline and by-name behave differently at runtime

An inline server is connected when the subagent starts and disconnected
when it finishes. A frontmatter entry that is a bare string naming an
already-configured server shares the parent session's connection instead.

This is why the example declares the server inline, and it is a real
constraint on what the read-only posture means. The mode of this server is
fixed for the lifetime of a process, decided once at startup. An inline
definition gives each subagent invocation its own process, so the mode is
decided once per invocation. A deployment that instead defines this server
in `.mcp.json` and references it by name gets one long-lived process shared
across the whole session, and its mode is decided once at session start.

## Distributing it inside a plugin will not work

Claude Code ignores the `mcpServers`, `permissionMode` and `hooks`
frontmatter fields when it loads an agent from a plugin. This example sets
`mcpServers`, so a plugin-distributed copy launches with no Todoist server
connected and no tools from it. Copy the file into `.claude/agents/` or
`~/.claude/agents/` instead.

## Keeping the example honest

The example is not merely non-personal. It names real environment variables
and real tool names. When a defect in section 10 of `docs/SPEC.md` affects
what an agent should trust in tool output, the example carries an
agent-facing warning for it. No open defect does, so the example currently
carries no defect warnings. Those warnings are part of each defect's fix
criteria: when a defect is fixed, removing its warning from this example is
part of fixing it.

The example is documentation. It is deliberately not kept in sync with any
live definition, and nothing should assume that it is. See AD-5 in
`docs/SPEC.md` for the full decision.
