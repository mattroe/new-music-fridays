# Developer context for new-music-fridays

This file is for Claude when **editing** the repo. The runtime prompt the scheduled task executes is `SKILL.md` — keep the two distinct.

## What this repo is

A weekly "New Music Friday" digest based on Last.fm listening history, sent every Friday via Resend. See `README.md` for the user-facing overview and the repo's [open issues](https://github.com/mattroe/new-music-fridays/issues) for what's next.

## Wire-up

The scheduled-task runtime needs two pieces of state — both required:

1. **Symlink** at `~/.claude/scheduled-tasks/new-music-fridays → ~/code/new-music-fridays`. This is how the runtime finds `SKILL.md` — it reads the prompt from `~/.claude/scheduled-tasks/<name>/SKILL.md`.
2. **Folder** field on the `new-music-fridays` routine in the Claude Code Desktop Routines UI, set to `/Users/you/code/new-music-fridays` (the real path, not the symlink). This controls cwd at runtime, which determines whether `.claude/settings.local.json` loads, whether `scripts/sum-tokens.sh` finds the session JSONL, and whether relative paths in the prompt resolve correctly. The Folder value persists in `~/Library/Application Support/Claude/claude-code-sessions/<ids>/scheduled-tasks.json` under the `cwd` field — edit there directly (Desktop quit) if the UI refuses to save.

These two are independent. Both must be right. Symlink wrong → "Task file not found." Folder wrong → permission-prompt babysitting, `tokens: null` in meta.json, broken relative paths.

Edits in `~/code/new-music-fridays` are picked up by the next scheduled run. No build step.

## Conventions

- **Forward-looking work lives in GitHub issues, not in the repo.** Open issues at https://github.com/mattroe/new-music-fridays/issues track what's planned next; close them when shipped (the PR description carries the past context). Per-task implementation plans don't live in the repo either — they belong in `~/.claude/plans/` (plan mode) or in the PR description.
- **Behavior should remain stable across refactors.** When changing `SKILL.md`, configs, or templates, the email's structure and recipients should not silently drift. Validation steps in the prompt catch the obvious cases (`from`/`to`/`subject`/template-fill); the rest comes down to careful review.
- **Configuration is data.** Sources, delivery details, and Last.fm parameters live in `config/*` and `templates/*`, not inlined in `SKILL.md`. If you find yourself adding prose to `SKILL.md` that's really a setting, extract it.
- **Model and effort are pinned in `SKILL.md` frontmatter** (`model: opus`, `effort: max`) rather than inherited from `~/.claude/settings.json`. This isolates Friday's run from unrelated settings.json changes and makes the choice visible to anyone reading the repo. Revisit after cost data accumulates (see [#8](https://github.com/mattroe/new-music-fridays/issues/8)).

## Gotchas worth knowing

- **SKILL.md frontmatter and the claude CLI.** SKILL.md starts with a `---`-delimited YAML frontmatter block. The CLI's option parser reads `---` as a flag, so anything that pipes SKILL.md to `claude -p` needs the `--` end-of-options separator first. `scripts/nmf` does this (`exec claude ... -p -- "$(cat SKILL.md)"`); don't undo it. This bit us once after the frontmatter was added in `85a0c48`.
- **`.claude/settings.local.json` is gitignored.** Each clone maintains its own — per-install allow lists shouldn't leak into git, since tool prefixes (especially MCP UUIDs) differ between installs. The committed repo doesn't ship an allow list, so every fresh clone has to approve permissions on first run or pre-populate the file. The local allow list typically covers Last.fm tools, `mcp__resend__send-email`, `Read`/`Write`/`Edit`, `TaskCreate`/`TaskUpdate`, `WebSearch`, `WebFetch` (research fetches source/blog/label pages), and a handful of `Bash(...)` patterns including `Bash(bash scripts/run-state.sh:*)`.
- **Run-state and finalize values come from `scripts/run-state.sh`, not improvised shell.** `SKILL.md` calls `bash scripts/run-state.sh start` / `... finish <epoch>` and parses the `key=value` output. This is deliberate: an inline `echo "...$(date)..."` contains command substitution, which trips the Bash permission gate — interactive "Run now" prompts, an unattended fire silently auto-denies — so any date/env/duration logic must stay inside the allowlisted script. Don't move it back into the prompt.
- **Last.fm MCP prefix varies by registration.** Depending on whether the user added it via `claude mcp add` or via claude.ai's connector UI, tools register under `mcp__lastfm__*`, `mcp__claude_ai_Last_fm__*`, or `mcp__<uuid>__*`. `SKILL.md` matches by function-name suffix so the prompt is robust, but allow lists in `settings.local.json` need the actual prefix(es) present. Worth including both UUID and friendly-name forms if you've seen the server register either way.
- **The CLI binary authenticates separately from Desktop.** First-time `./scripts/nmf` runs fail with `401 Invalid authentication credentials`. Run `claude` interactively once, type `/login`, complete OAuth, exit. The CLI token persists afterwards.

## How to test changes

Three paths:

1. **`./scripts/nmf --fast`** — trimmed Last.fm + stubbed candidates + `[TEST][FAST]` subject prefix. Roughly 2–5 minutes. Sends a real email. Use for plumbing checks (template fill, validation, Resend integration, sum-tokens).
2. **`./scripts/nmf --test`** — full Last.fm + web research + `[TEST]` subject prefix. Same wall time as a real run (5–15 min). Use when changing research logic or rubric.
3. **`./scripts/test-sum-tokens.sh`** — shell-level unit test for `scripts/sum-tokens.sh`'s path-resolution and fallback logic. Fast, deterministic, no external dependencies.

Production mode is reserved for the scheduled Friday fire — `./scripts/nmf` never produces it, regardless of flags.

After a `--fast` or `--test` run, confirm:

1. The email arrives at the expected address from the expected sender
2. The pre-send validation passes (it aborts on `from`/`to`/`subject`/template-fill mismatches)
3. Both `html` and `text` Resend args are populated
4. `runs/<today>/<prefix>meta.json` shows the expected `mode`, `validation_passed: true`, `sent: true`, and a populated `tokens` object (not `null`)
