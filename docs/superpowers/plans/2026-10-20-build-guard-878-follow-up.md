# Build guard: #878's follow-up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the gaps that a security review and four verifiers found in the session hook's `build` deny arm, which #878 (CB1b of the claude-binary-lifecycle programme) shipped. After this PR, a child session cannot do any of these by the plausible routes this plan lists:
- install, update, upgrade or respawn Claude Code;
- write into its build directory or onto its launcher;
- write the files the W3 launcher and roll will trust, or the deny file the hook itself reads.

**Architecture:** One file of code changes: `ccd/session-hook.sh`'s `APPROVAL_FORBIDDEN_JQ`, in its deny mode only. That means `bmatch`, the deny arm's edit-tool branch, the deny arm's jq arguments, the prefilter and the header comment above it.

These stay byte-identical:
- class mode: `BUILD`, `WR`, `fmatch` and the class-mode call;
- `approvalguard.ts` and the guard corpus;
- `childDenyRules`, `install-session-hooks.sh` and the children's deny file.

Keeping class mode identical keeps it equal to the classifier over the guard corpus. Keeping the deny file identical leaves every child's recorded deny digest valid. Changed bytes would make every live child answer `409 deny-not-engaged` to `POST /api/approvals` until it respawns.

Children run with permissions bypassed, so the hook's deny arm is the guard that binds them. The deny file's rules do bind in bypass mode too: the coordinator-first-routing rig, row 3a, measured that on 2.1.296 to 2.1.302. But as prefix rules they miss:
- a flag before the verb;
- a path head (row 3c);
- `upgrade`;
- and, unmeasured, `bash -c` strings.

This is one PR, and it is fleet-only. The hook reaches each home through `ccrc update`'s install spine; there is no server or PWA change.

**Tech Stack:** bash (floor 4.4), jq 1.7 (Oniguruma), vitest.

**Spec:** `docs/superpowers/specs/2026-10-18-claude-binary-lifecycle-design.md` §7.6, with the W1 plan's CB1b and its D-5696, D-5993 and D-5994 (`docs/superpowers/plans/2026-10-19-claude-binary-lifecycle-w1-observe.md`). This plan lands as `docs/superpowers/plans/2026-10-20-build-guard-878-follow-up.md`.

## Global Constraints

- **Deny mode only.** Change nothing that class mode reads. `session-hook-approval-deny.test.ts`'s parity case, which holds the hook's class mode equal to `approvalClass` over the guard corpus, stays green and unchanged. These files stay byte-identical to main:
  - `server/src/coord/approvalguard.ts`
  - `server/test/fixtures/approvals/guard-corpus.json`
  - `shared/api.ts`
  - `ccd/install-session-hooks.sh`
  - the children's deny file
- **Files:**
  - `ccd/session-hook.sh`;
  - `server/test/session-hook-approval-deny.test.ts`, with new cases only;
  - `CLAUDE.md`, the SAFETY bullet on builds (:103-111);
  - `docs/superpowers/plans/2026-10-19-claude-binary-lifecycle-w1-observe.md`, pointer sentences on D-5993 and D-5994 only;
  - this plan.

  A worker who finds another file unavoidable stops and asks.
- **Lines another PR owns.** #722, the public-tree scrub, rewrites these lines:
  - `server/test/session-hook-approval-deny.test.ts:266`;
  - four comment lines of `ccd/session-hook.sh`: :466, :2411, :2500 and :2518 on main 36d0a92c1.

  Edit none of them. If #722 lands first, merge main and re-measure.
- **Bounded, and never an error.**
  - Every repetition this PR adds is bounded. An unbounded separator pattern such as `/(?:\.?/)*` made jq abort with "retry-limit-in-match over". `afw` is then empty, and the deny arm FAILS OPEN.
  - Every segment-scanning arm first passes one whole-command test of its anchor: `test(BUILDX)`, the trust paths, `find`, `xargs`, the `cd` target, `@anthropic-ai/claude-code`. That keeps a many-segment command no slower than on main.
  - Pin it. Run the deny program directly, through the test's jq helper, on each adversarial input:
    - a 40 KB run of `claude -a ` with no verb at the end;
    - `upstream-a -a ` repeated, with Task 4's file;
    - `~/.local/share/` followed by `./` repeated;
    - `cd ~/.local/ && ` repeated.

    jq must exit 0 within 1 s on the first three. The fourth must be no slower than main's measured time on the same input.
- **Print mode stays allowed.** A word that is exactly `-p` or `--print`, or starts with `--print=`, before the verb means print mode, and the verb is a prompt. Measured on 2.1.304 by which usage line `claude <flags> update --help` prints.
- **Fixture HOMEs only.**
  - Drive the hook as `session-hook-approval-deny.test.ts` does: a fixture HOME, a `.child` row, the payload on stdin. The harness payload carries no `transcript_path`, which is what makes the prefilter pins mean something.
  - Never run claude, an installer, ccd or the hook against the live HOME.
  - Never fetch an installer.
  - Never run `claude -- update` or `claude --bg update`, even with `--help`: both run the subcommand.
- **Neutral names.** Use `upstream-a`, `lane-a`, `claude-a` and `/home/u`. No lane, account, host or project names.
- **No line citations in code or test comments.** `citations.test.ts` caps them at its BASELINE. Cite symbols instead: `session-hook.sh#APPROVAL_FORBIDDEN_JQ`.
- **Numbers.**
  - This plan defines D-6063, D-6064, D-6065 and D-6066, and no other. The coordinator issued them for run 697.
  - Define each in the same PR that adds the W1-plan and CLAUDE.md references.
  - They amend D-5993 and D-5994 by a pointer sentence, never by rewriting those entries.
  - Do not use 5757 or 5758, and do not touch the programme ledger's R5 or either "Issued and unused" line.
- **Your own commands.** As a child, your own Bash commands are judged by the INSTALLED hook. A command that merely mentions `claude update` is denied: a grep, an echo, or a commit message written with `-m`. Commit with `git commit -F <file>`, search with the Grep tool, and never disable or bypass the guard.
- **jq traps** the prototype hit:
  - Bind the deny-file names once, before the main expression (`(...) as $ups | …`). Never re-parse the file per regex call.
  - Inside `any($names[]; …)`, `.` is the name. Capture `. as $c` first, or an arm silently never fires.
- **Starting point.** A checker's measured prototype of Tasks 1-4 is `hook-prototype.diff`, in the coordinator's evidence directory named in your brief. Its pin tables are there too. Read them. Do not copy them blind: this plan adds forms the prototype did not build.

## Review Focus

1. **False denies on ordinary commands.** These must stay allowed:
   - `npm install`, `npm update`, `git log --grep install`, `pip install -r requirements.txt`, `apt update`;
   - `claude --version`, `claude -p "how do I update"`, `claude mcp list`, `claude doctor`, `ccrc install --help`;
   - reads of the build paths: `ls`, `cat`, `du`, `sha256sum`, `readlink -f`, `ls ~/.local/share/claude/*`;
   - `find <versions> -maxdepth 1 -type f`, `cd <versions> && ls -la`, `cd ~/.local/bin && cp /tmp/x ccd-helper`;
   - `cp /tmp/x ~/.local/bin/claude.bak`, `cp /tmp/x ~/.local/bin/claude-a`, `install -m 755 tool ~/.local/bin/mytool`, `mkdir -p ~/.local/share/myapp`.
2. **Accepted false denies.** These are the measured costs, all in the safe direction. Name them in the PR body:
   - `claude -c "please update tests"` and `claude --model opus "update the docs"`: a flag's value swallows the first prompt word once quotes are removed;
   - `claude --debug update` and `claude --add-dir /tmp update`;
   - `node --version && ls <versions>` and an interpreter reading the build directory (the interpreter arm);
   - `cd <versions> && ls > /tmp/list.txt` (the `cd` arm);
   - mentions of `claude upgrade` or `claude respawn` (pre-existing in kind).
3. **Print mode.** `-p`/`--print` anywhere before the verb.
4. **Time and errors.** A long or adversarial command must not stall the hook or make jq fail.
5. **Class parity and the deny digest.** Both unchanged, measured by sha256 over the corpus outputs and the generated deny files.

---

### Task 1: the CLI arm (D-6063)

**Files:** `ccd/session-hook.sh` (`bmatch`, the prefilter, the header comment above it); `server/test/session-hook-approval-deny.test.ts` (new cases).

Deny, in deny mode, as `build` ("installing or updating a Claude Code build"):
- **Flags before the verb.** Any of these heads, then up to 8 flags, then `install`, `update` or `upgrade`:
  - a `claude…` head;
  - a `~/.local/bin/<id>` launcher head;
  - an expansion head (the `EXPV` arm).

  Each flag is a word starting with `-`, `--` included. It may take at most one following value that does not start with `-` (`--model opus`, `--settings x`, `--resume abc`). A print-mode word stops the match.

  Claude Code 2.1.304 runs the subcommand for:
  - `--verbose`, `-c`, `-pc`, `-cp`, `-d api`, `-n x`;
  - `--model opus`, `--model=opus`, `--resume abc`, `--settings f`, `--permission-mode default`;
  - `--`.

  `--debug update` and `--add-dir /tmp update` do not run it. Denying them is an accepted cost.
- **`upgrade`.** Claude Code's alias of `update`.
- **`respawn`**, right after the head with no flag between. It restarts a background session onto the current build, and a roll is never a session's act (§7.6). With a flag first, `respawn` does not run.
- **The build run by its own path.** A head of `/.local/share/claude/versions/<X.Y.Z>`, in any separator spelling (Task 2's `SEPP`), followed by flags and a verb. So are these:
  - `$CLAUDE_CODE_EXECPATH` or `${CLAUDE_CODE_EXECPATH}`, quoted or not;
  - after a `cd` into the versions directory, a head of `./<X.Y.Z>` or a bare `X.Y.Z` word.
- **Package runners.** `npx`, `bunx`, `pnpm dlx`, `yarn dlx`, `npm exec` or `pnpm exec`, of `@anthropic-ai/claude-code` with or without an `@<version>` suffix, followed by flags (`--` included) and a verb.
- **The official installer.** Any Bash command naming `claude.ai/install.sh`, `claude.ai/install.ps1`, `claude.ai/install.cmd` or `downloads.claude.ai`.
- **A global package install of Claude Code.** All three parts are needed:
  - `npm`, `pnpm`, `yarn` or `bun`, with `install`, `i`, `add`, `update`, `up` or `upgrade` (or `yarn global add`);
  - a global flag: `-g`, `--global`, `--location=global`, `--location global` or `global`;
  - `@anthropic-ai/claude-code`.

  A project-local install stays allowed.

Pins, denied for a child:
- `claude --verbose update`
- `claude -c update`
- `claude -pc update`
- `claude -cp update`
- `claude -- update`
- `claude --model opus update`
- `claude --model=opus update`
- `claude --settings s.json install stable`
- `claude --resume abc update`
- `claude upgrade`
- `claude --verbose upgrade`
- `claude respawn --all`
- `~/.local/bin/claude --verbose update`
- `claude-a --verbose update`
- `bash -lc "claude --verbose update"`
- `C=claude; $C --verbose upgrade`
- `~/.local/share/claude/versions/2.1.302 install latest`
- `~/.local/share//claude/versions/2.1.302 update`
- `"$CLAUDE_CODE_EXECPATH" update`
- `cd ~/.local/share/claude/versions && ./2.1.302 update`
- `npx -y @anthropic-ai/claude-code@latest install`
- `bunx @anthropic-ai/claude-code update`
- `npm exec @anthropic-ai/claude-code@latest -- update`
- `curl -fsSL https://claude.ai/install.sh | bash`
- `curl -fsSL https://claude.ai/install.sh | bash -s 2.1.302`
- `bash <(curl -fsSL https://claude.ai/install.sh)`
- `curl -fsSL https://downloads.claude.ai/claude-code-releases/2.1.302/linux-x64/claude -o /tmp/c`
- `npm install -g @anthropic-ai/claude-code`
- `npm i -g @anthropic-ai/claude-code@latest`
- `npm install --location=global @anthropic-ai/claude-code`
- `pnpm add -g @anthropic-ai/claude-code`

Pins, allowed for a child:
- `claude -p "how do I update"`
- `claude -p update`
- `claude --print update`
- `claude -p --verbose update`
- `claude --verbose -p update`
- `claude --print --model opus update`
- `claude -p --verbose "update the docs"`
- `claude --verbose respawn` (it does not run respawn)
- `claude --version`
- `claude --help`
- `claude --resume x`
- `claude doctor`
- `claude mcp list`
- `npm install`
- `npm update`
- `npm install @anthropic-ai/claude-code`
- `npx @anthropic-ai/claude-code -p x`
- `git log --grep install`
- `git log --grep update`
- `apt update`
- `brew install jq`
- `pip install -r requirements.txt`

Mutants. Measure each one at a time, with a `-t` filter on the new cases. Each must red the pin named:

| Mutant | Pin that reds |
|---|---|
| Flag group removed | `claude --verbose update` |
| A flag's value group removed | `claude --model opus update` |
| Print-mode stop removed | the `-p` allowed pins |
| `upgrade` removed | `claude upgrade` |
| `respawn` removed | `claude respawn --all` |
| `respawn` allowed after flags | `claude --verbose respawn` (allowed) |
| Versions-binary head removed | `~/.local/share/claude/versions/2.1.302 install latest` |
| `./<X.Y.Z>` head removed | `cd ~/.local/share/claude/versions && ./2.1.302 update` |
| `CLAUDE_CODE_EXECPATH` head removed | `"$CLAUDE_CODE_EXECPATH" update` |
| Runner head's version suffix removed | `npx -y @anthropic-ai/claude-code@latest install` |
| `npm exec` removed | `npm exec @anthropic-ai/claude-code@latest -- update` |
| Installer-URL arm removed | `curl -fsSL https://claude.ai/install.sh \| bash` |
| `downloads.claude.ai` removed | the `downloads.claude.ai` pin |
| Global-install arm removed | `npm install -g @anthropic-ai/claude-code` |
| Global-flag condition removed | `npm install @anthropic-ai/claude-code` (allowed) |
| `--location=global` removed | its pin |
| The `{0,8}` bound removed | the timing pin |

Define D-6063 in this plan's Deviations found. Add one sentence to D-5994 in the W1 plan: "Amended by D-6063 (`docs/superpowers/plans/2026-10-20-build-guard-878-follow-up.md`): a flag before the verb is admitted except a print-mode word; and `upgrade`, `respawn`, the build run by its path, the package runners, the official installer and a global package install are denied."

### Task 2: build-path writes (D-6064)

**Files:** `ccd/session-hook.sh` (`bmatch`, the deny arm's edit-tool branch, the prefilter, the header comment); `server/test/session-hook-approval-deny.test.ts`.

Define, for deny mode only:
- **`SEPP`**: a path separator in any spelling (`/`, `//`, `/./` and runs of them), bounded at 8 repeats.
- **`BUILDX`**: the build directory and the launcher, in any `SEPP` spelling.
  - The directory is `.local/share/claude/versions`, with nothing after the name.
  - The bare `.local/share/claude` directory counts too, when it is followed by optional separators and then:
    - the end, a space, or a shell metacharacter (`;&|()<>`, backtick, quotes); or
    - a last path segment holding a glob character `*`, `?`, `[` or `{` (`claude/*`, `claude/v*`, `claude/{versions,x}`).
  - So `versions-old/…` and `claude-code-cache` are other names.
  - The launcher is `.local/bin/claude`, with nothing after the name.
  - It has an absolute or home-anchored form (`/`, `~`, `$HOME`, `${HOME}`, quoted or not), and a relative form, `.local/…`, at the start of a word.
- **`BWR`**: the writer heads.
  - `WR`'s heads, plus `install`, `dd`, `rsync`, `tar`, `unzip`, `chmod`, `chown`, `touch`, `mkdir`, `curl`, `wget`, `unlink`, `shred` and `patch`, each word-bounded.
  - `>` and `>>` count, with or without a leading digit, and so do `&>` and `>|`.
  - They do not count when the target is `/dev/null`, or when `>&` is followed by a digit or `-` (`2>&1`, `>&2`, `>&-`).
  - `WR` itself stays unchanged.
- **The segment split** for these arms does not split a redirection operator. `>|`, `>&` and `&>` stay in one segment with their target.

Deny, as `build` ("a write to a Claude Code build or its launcher"):
- **A writer and the path in one segment.** A `BWR` head and `BUILDX` in the same segment, head first. This replaces the `WR`/`BUILD` arm in `bmatch` only; class mode keeps its own.
- **`find`.** `find` with `BUILDX` and an action (`-delete`, `-exec`, `-execdir`, `-ok` or `-okdir`) in the same segment.
- **`xargs`.** `BUILDX`, then `| xargs` with a `BWR` head, in one pipeline.
- **An interpreter that names the path.** A word-bounded `python[0-9.]*`, `node`, `perl`, `ruby`, `bun` or `deno` anywhere in the command, together with `BUILDX` anywhere in it. This covers the whole command, because a `;` inside `-c` code splits segments.
- **`cd`, then a write.** `cd` or `pushd`, with up to two flags (`-P`, `-L`, `-e`), also inside `( … )`. The operand may carry a leading `./`, and each operand ends at a word end. One arm per row:

  | `cd` target | Then |
  |---|---|
  | `.local/share/claude/versions` or `.local/share/claude` | any `BWR` head later in the command |
  | `.local/share` | a `BWR` head with operand `claude` or `claude/…` |
  | `.local` | a `BWR` head with operand `share/claude…` or `bin/claude` |
  | `~`, `$HOME`, `${HOME}`, or a bare `cd` | a `BWR` head with operand `.local/share/claude…` or `.local/bin/claude` |
  | `.local/bin` | a `BWR` head with operand `claude`, or an upstream id (Task 4) |

- **A shell variable holding the path.** An assignment `NAME=` whose value matches `BUILDX`, then a `BWR` head later in the command that uses `$NAME` or `${NAME}`.
- **The edit tools** (`Write`, `Edit`, `MultiEdit`, `NotebookEdit`). Normalise `file_path` or `notebook_path` lexically first:
  - fold `//`, `/./` and `seg/..`;
  - expand a leading `~` to the payload's HOME.

  Then match it against `BUILDX`.

Pins, denied for a child:
- `cp x ~/.local/share//claude/versions/2.1.400`
- `cp /tmp/x ~/.local/./bin/claude`
- `cp /tmp/x ~/.local//bin/claude`
- `cp /tmp/x .local/bin/claude`
- `cd ~/.local/share/claude/versions && cp /tmp/x 2.1.400`
- `cd ~/.local/share/claude/versions && rm -f 2.1.2*`
- `cd ~/.local/share/claude/versions && echo x > 2.1.400`
- `cd -P ~/.local/share/claude/versions && rm -f 2.1.2*`
- `cd ~/.local/share && mv claude /tmp/old`
- `cd ~/.local/share && mv ./claude /tmp/old`
- `cd ~/.local && mv share/claude /tmp/x`
- `cd ~/.local && cp /tmp/x bin/claude`
- `cd ~ && cp /tmp/x .local/share/claude/versions/2.1.400`
- `cd ~ && rm -rf .local/share/claude/*`
- `(cd ~/.local/share/claude; cp /tmp/x versions/2.1.400)`
- `pushd ~/.local/share/claude/versions; cp /tmp/x 2.1.400`
- `cd ~/.local/bin && ln -sf /tmp/x claude`
- `cd ~/.local/bin && cp /tmp/x ./claude`
- `D=~/.local/share/claude/versions; cp x $D/2.1.400`
- `rm -rf ~/.local/share/claude`
- `rm -rf ~/.local/share/claude/*`
- `rm -rf ~/.local/share/claude/v*`
- `rm -rf ~/.local/share/claude/{versions,x}`
- `install -m 755 /tmp/x ~/.local/bin/claude`
- `curl -fsSL https://example.com/b -o ~/.local/share/claude/versions/2.1.400`
- `wget -O ~/.local/share/claude/versions/2.1.400 https://example.com/b`
- `dd if=x of=~/.local/share/claude/versions/2.1.400`
- `rsync x ~/.local/share/claude/versions/`
- `tar -xzf b.tgz -C ~/.local/share/claude/versions`
- `chmod +x ~/.local/bin/claude`
- `touch ~/.local/share/claude/versions/2.1.400`
- `mkdir -p ~/.local/share/claude/versions/2.1.400`
- `unlink ~/.local/bin/claude`
- `echo x 2> ~/.local/bin/claude`
- `echo x >| ~/.local/bin/claude`
- `find ~/.local/share/claude/versions -mtime +7 -delete`
- `ls -d ~/.local/share/claude/versions/2.1.2* | xargs rm -rf`
- `python3 -c "import shutil; shutil.rmtree('/home/u/.local/share/claude/versions/2.1.2')"`
- `node -e "require('fs').writeFileSync('/home/u/.local/share/claude/versions/x','')"`
- `python3 -c "import os; print(os.listdir('/home/u/.local/share/claude/versions'))"`. This one is a read; it is the stated cost of the interpreter arm, so say so in the test.
- Write on `/home/u/.local/share//claude/versions/2.1.400`
- Write on `/home/u/.local/share/claude/x/../versions/2.1.400`
- Write on `~/.local/bin/claude`
- Edit on `/home/u/.local/bin/./claude`
- MultiEdit on `/home/u/.local/share/claude//versions/x`
- NotebookEdit on `/home/u/.local/share/claude/versions/../versions/x.ipynb`

Pins, allowed for a child: every read and near-name in Review Focus 1, plus these.
- `find ~/.local/share/claude/versions -maxdepth 1 -type f`
- `cd ~/.local/share/claude/versions && ls -la`
- `cd ~/.local/share/claude/versions && ls 2>/dev/null`
- `cd ~/.local/share/claude/versions && ls 2>&1 | head`
- `cd ~/.local/share/claude/versions && ls >&2`
- `cd ~/.local/share/claude/versions && ls > /dev/null`
- `cd ~/.local/share && mkdir myapp`
- `cd ~/.local/share && rm -rf claude-code-cache`
- `cd ~ && rm -rf claude`
- `cd ~ && cp /tmp/x .local/share/myapp/`
- `cd ~/.local/bin && ls -la`
- `cd ~/.local/bin && cp /tmp/x ccd-helper`
- `cd ~/project && mkdir -p claude/versions && cp x claude/versions/`
- `cp /tmp/x ~/.local/share/claude-code-cache/x`
- `rm -rf ~/.local/share/claude-code-cache`
- `cp /tmp/x ~/.local/share/claude/versions-old/2.1.302`
- `curl -fsSL https://example.com/b -o /tmp/x && tar -xzf /tmp/x -C /tmp/out`
- `mkdir -p ~/.local/share/myapp && cp x ~/.local/share/myapp/`
- `chmod +x scripts/install.sh`
- `python3 -c "print(1)"`
- Write on `/home/u/docs/local/share/claude/versions.md`
- Write on `/home/u/.local/share/claude/versions-old/x`

Mutants:
- `SEPP` back to `/`;
- `BUILDX`'s relative form removed (`cp /tmp/x .local/bin/claude`);
- the bare-directory alternative removed;
- the glob tail removed (`rm -rf ~/.local/share/claude/v*`);
- `BWR` back to `WR`;
- the digit-redirect case exempted (`echo x 2> ~/.local/bin/claude`);
- the `>|` case removed;
- the `/dev/null` and `>&N` exemptions removed (`ls 2>/dev/null` and `ls 2>&1 | head`, allowed);
- the `find` arm removed, and the `find` arm without its action condition (`-maxdepth`, allowed);
- the `xargs` arm removed;
- the interpreter arm removed;
- one mutant per `cd` row, each removing that row and redding its own pin;
- each `cd` row accepting any operand (`cd ~/.local/share && mkdir myapp` and `cd ~ && rm -rf claude`, allowed);
- the `./` operand form removed;
- `cd` flags removed (`cd -P …`);
- the variable arm removed;
- the edit-tool normalisation removed.

**Residuals.** State them in D-6064 and in the PR body:
- a symlink into the build directory;
- a `$VAR` fragment of the path (`.../$V/...`, `${XDG_DATA_HOME:-…}`);
- case variants;
- `..` inside Bash text: only edit-tool paths are normalised, so `cp x ~/.local/share/claude/foo/../versions/2.1.400` is allowed;
- nine or more repeated separators, and nine or more flags before the verb;
- script files, `eval`, stdin, and an interpreter that does not name the path.

Until W3 adopts the launcher, today's launcher serves the highest build present, so a stray build would be served at the next spawn. After adoption, the launcher serves only a smoked build: that is the backstop.

Define D-6064. Add one sentence to D-5994: "Amended by D-6064 (`docs/superpowers/plans/2026-10-20-build-guard-878-follow-up.md`): build writes are matched in any separator spelling, by more writers, through `find`, `xargs`, interpreters, `cd` and variables, and edit-tool paths are normalised first; D-6064 names what stays open."

### Task 3: the files the launcher, the roll and the hook trust (D-6065)

**Files:** `ccd/session-hook.sh`; `server/test/session-hook-approval-deny.test.ts`.

Spec §7.6 says the registry-path pattern covers `~/.ccrc/claude-*` and `$REG/claude-roll-*`. That holds for the classifier and the hook's class mode (`fmatch`'s registry-path rule), not for the deny arm. So for a child these files are open today. After W3 they are what the launcher and the roll trust.

After Task 4, the hook also trusts the deny file. A child that could overwrite it could switch Task 4 off.

Define `TRUST`, in any `SEPP` spelling:
- `/.ccrc/claude-<name>`
- `/.cc-sessions/claude-roll-<name>`
- `/.cc-sessions/<id>.claude-canary`
- `/.cc-sessions/<id>.claude-build`
- `/.cc-sessions/.claude-roll.lock`
- `/.cc-sessions/child-deny.settings.json`
- `/.cc-sessions/<id>.deny-settings`

Deny, as `build` ("a write to a file the Claude Code launcher, roll or guard trusts"):
- a `BWR` head with a `TRUST` path in the same segment;
- `cd` to `.ccrc` or `.cc-sessions`, then a `BWR` head whose operand is one of those names;
- an edit tool on a `TRUST` path, after Task 2's normalisation.

Pins, denied:
- `echo 2.1.999 >> ~/.ccrc/claude-smoked`
- `echo "anthropic 2.1.999" > ~/.ccrc/claude-target`
- `rm ~/.ccrc/claude-halted`
- `touch ~/.cc-sessions/claude-roll-live`
- `cp /tmp/x ~/.ccrc//claude-target`
- `cd ~/.ccrc && echo x > claude-smoked`
- `echo pass > ~/.cc-sessions/lane-a-project-a.claude-canary`
- `cp /tmp/x ~/.cc-sessions/child-deny.settings.json`
- `echo 0 > ~/.cc-sessions/lane-a-project-a.deny-settings`
- Write on `/home/u/.ccrc/claude-target`
- Edit on `/home/u/.cc-sessions/child-deny.settings.json`

Pins, allowed:
- `cat ~/.ccrc/claude-target`
- `ls ~/.cc-sessions/`
- `sha256sum ~/.ccrc/claude-smoked`
- `cat ~/.cc-sessions/child-deny.settings.json`
- `cp /tmp/x ~/.ccrc/other-file`

Mutants: the Bash arm removed; the `cd` arm removed; the edit-tool arm removed; each `TRUST` alternative removed, each redding its own pin.

Define D-6065. In D-6065, say that §7.6's registry sentence now holds for children through the hook's deny arm, and that the deny file and the digests recorded against it are protected because Task 4 reads the file.

### Task 4: the upstream id, read from the deny file (D-6066)

**Files:** `ccd/session-hook.sh` (the deny arm's jq call, `bmatch`, the edit-tool branch, the prefilter); `server/test/session-hook-approval-deny.test.ts`.

The deny file is `$REG/child-deny.settings.json`, written by `install-session-hooks.sh` from `childDenyRules`. It is the per-box product that names the roster's upstream id. Today the hook reads it only in the PermissionRequest arm (`_hook_approval_wait`). There it compares the file's sha256 with the child's recorded `$REG/<id>.deny-settings`, and it reads the file only when it is a regular file and not a symlink. Task 4 adds a second read, in the PreToolUse deny arm.

In the deny arm only:
- When the file is a regular file and not a symlink, pass it to jq as `--rawfile deny <file>`. Read it as `$ARGS.named.deny // ""`, so the class-mode call and the test helper's own jq call still compile.
- Parse it with `try`.
- Take every `<p>` for which `permissions.deny` holds BOTH `Bash(<p> install:*)` and `Bash(<p> update:*)` (the pair `childDenyRules` emits for a Claude Code head), unique, minus `claude`. Every deny file also holds `Bash(ccrc update:*)` alone, so a single-verb capture would make `ccrc` a Claude Code head on every box.
- When the list is empty, every arm below is a never-matching `(?!)`.

With those names, deny, as `build`:
- a head of the bare name, then Task 1's flags and verb;
- writes onto `.local/bin/<name>`, with nothing after the name, by Task 2's writers and arms (`cd ~/.local/bin` included) and by the edit tools.

A missing, non-regular, symlinked or unparsable deny file leaves the arm as on main.

The fixture: build the deny file by running the real `ccd/install-session-hooks.sh --homes` in a fixture HOME whose `~/.ccrc/accounts.sh` holds `CCRC_UPSTREAM=upstream-a`. Copy the invocation and environment that `install-session-hooks.test.ts` uses into the new test; do not import from it or edit it.

Pins, denied:
- `upstream-a update`
- `upstream-a install 2.1.302`
- `upstream-a --verbose upgrade`
- `FOO=1 upstream-a update`
- `env upstream-a update`
- `true; upstream-a update`
- `bash -c "upstream-a install 2.1.302"`
- `cd ~/.local/bin && ./upstream-a update`
- `cp /tmp/x ~/.local/bin/upstream-a`
- `echo x > "$HOME/.local/bin/upstream-a"`
- `cd ~/.local/bin && ln -sf /tmp/x upstream-a`
- `cd ~/.local/bin && cp /tmp/x ./upstream-a`
- Write and Edit on `/home/u/.local/bin/upstream-a`

Pins, allowed:
- `upstream-a --version`
- `upstream-a -p "update the changelog"`
- `upstream-ab update`
- `cp /tmp/x ~/.local/bin/upstream-a.bak`
- `cat ~/.local/bin/upstream-a`
- with the DEFAULT roster's deny file: `ccrc install --help`, `ccrc upgrade --help` and `cp /tmp/x ~/.local/bin/ccrc` get no "Claude Code build" reason

Regression: with no deny file, or a symlinked one, `upstream-a update` is allowed, and `claude update` and `ccd ws-rm x` are still denied.

Parity: for every `<p>` the generated file pairs, `<p> install`, `<p> update`, `~/.local/bin/<p> install` and `~/.local/bin/<p> update` are denied.

Mutants:
- the `--rawfile` argument dropped;
- the pair condition loosened to either verb (the `ccrc` pins, allowed);
- the bare-name head dropped;
- the launcher-write arm dropped;
- the edit-tool arm dropped;
- the launcher's look-ahead without `.` (`upstream-a.bak`, allowed);
- the symlink check dropped (the symlinked-file regression);
- the prefilter's standalone verbs reverted (`upstream-a update` in the neutral harness).

Define D-6066. Add one sentence to D-5993: "Amended by D-6066 (`docs/superpowers/plans/2026-10-20-build-guard-878-follow-up.md`): the hook's deny arm reads the upstream id from the deny file, so a child's bare `<upstream id> install|update` and its writes onto `~/.local/bin/<upstream id>` are denied. The classifier side stays open: a write onto that launcher is `escalate`, not `forbidden`. No W3 task carries the roster reader that would close it. CB3f places the launcher; CB3e has no such step."

### The prefilter (Tasks 1-4)

Every deny pin must reach jq in the neutral harness. The checker's measured starting point is below. Change the header comment above it to say what each term admits.

    [[ "$apf" == *ccd* || "$apf" == *ccrc* || "$apf" == *approval* || "$apf" == *.cc-sessions* \
       || "$apf" == *install* || "$apf" == *update* || "$apf" == *upgrade* || "$apf" == *respawn* \
       || "$apf" == *anthropic-ai/claude-code* || "$apf" == *.local* || "$apf" == *downloads.claude.ai* ]] || apf=""

The cost: every child Bash call naming `install` or `update` forks one jq. In production that already happens, because a real payload's `transcript_path` names `.claude…`. Each term needs a mutant that reds a pin. Drop any term that cannot red.

### Task 5: text

- **CLAUDE.md, the SAFETY bullet on builds (:103-111).**
  - Say what the deny arm now covers (Tasks 1-4) and what stays open (D-6064's residuals).
  - Correct "a top-level session's prompt for them escalates to the operator". A `ccd`-spawned top-level session runs with permissions bypassed too: both spawn lines pass the bypass flag. So these commands raise no permission prompt there, and nothing denies them. The deny file and the hook's deny arm are children's only.
- **D-5994.** After its sentence "a rule only the classifier and the deny file hold never fires for them", add: "(The deny file's rules do bind in bypass mode, measured by the coordinator-first-routing rig, row 3a, on 2.1.296 to 2.1.302. But as prefix rules they miss a flag before the verb, a path head (row 3c) and `upgrade`. The hook's arm is the guard that covers those.)"
- **The PR body** carries:
  - each D-number's one-line summary;
  - the residuals;
  - the accepted false denies (Review Focus 2);
  - the operator questions below.

  The questions are the operator's to answer, not this PR's.
  - Top-level sessions. Spec invariant 11 says these acts are "denied to sessions and children". The routing spec's children-only ruling (§6.6: "Top-level sessions keep today's settings") leaves a top-level session undenied. Options: (a) extend the `build` deny to top-level sessions; (b) amend invariant 11 and CLAUDE.md to children only.
  - Should every rostered wrapper be covered, not only the upstream id? A wrapper whose id does not start with `claude` (D-5994's named residual) is not covered today. `~/.ccrc/accounts.sh` already carries the wrapper ids, so this would not need the deny file to change.
  - Two pre-existing risks this PR does not change:
    - the deny arm fails open whenever jq fails or the hook times out;
    - a 40 KB run of `$( ` takes about 84 s on main.

## Deviations found

D-6063, D-6064, D-6065 and D-6066 are defined here, one entry each, in the order of Tasks 1-4. Use the bullet form `- **D-<n>** — \`<slug>\` (Task N): …`, which `deviation-refs.test.ts`'s `ENTRY` regex reads; it needs the em dash. Each entry names its pins, its mutants and the commit that defines it.

- **D-6063** — `build-cli-arm-flags-and-heads` (Task 1): the hook's deny arm (`bmatch`, deny mode only) denies Claude Code's `install`, `update` and `upgrade` after up to eight flags (`CFLAGS`: a word starting with `-`, `--` included, with at most one value not starting with `-`), stopped by a print-mode word (`-p`, `--print`, `--print=…`), under these heads: a `claude…` name, a `~/.local/bin/<id>` launcher in any separator spelling, a `$VAR`/`${…}`/`$(…)`/backtick head in a command that names `claude`, the build run by its path (`…/.local/share/claude/versions/X.Y.Z`, `$CLAUDE_CODE_EXECPATH`, and `./X.Y.Z` or a bare `X.Y.Z` word after a `cd` into the versions directory), and a package runner (`npx`, `bunx`, `pnpm dlx`, `yarn dlx`, `npm exec`, `pnpm exec`) of `@anthropic-ai/claude-code` with or without `@<version>`. `respawn` is denied right after the head only, where Claude Code 2.1.304 runs it. Any command naming `claude.ai/install.{sh,ps1,cmd}` or `downloads.claude.ai` is denied, and so is a global `npm`/`pnpm`/`yarn`/`bun` install of `@anthropic-ai/claude-code` (`-g`, `--global`, `--location=global`, `global`); a project-local install stays allowed. The prefilter admits `install`, `update`, `upgrade` and `respawn` each on its own, plus `anthropic-ai/claude-code` and `downloads.claude.ai` (and, since the follow-ups below, `downloads.claude.ai` and `claude.ai/install` in any case). Pins: the 32 denied and 22 allowed commands of `session-hook-approval-deny.test.ts`'s "build guard D-6063" block, a subagent-thread case, a top-level case, and the timing pin (a 40 KB run of `claude -a ` with no verb, under 1 s). On main 31 of the denied pins and the subagent case were red (`bunx @anthropic-ai/claude-code update` was already denied through `claude-code`). Mutants, each measured red on its own pin with `-t "D-6063"`: the flag group, the flag's value group, the print-mode stop, `upgrade`, `respawn`, `respawn` after flags, the versions-binary head, the `./X.Y.Z` head, the `CLAUDE_CODE_EXECPATH` head, the runner's version suffix, `npm exec`, the installer URL, `downloads.claude.ai`, the global-install arm, its global-flag condition, `--location=global`, the `{0,8}` bound (the timing pin), and each new prefilter term (`install`, `update`, `upgrade`, `respawn`, `anthropic-ai/claude-code`, `downloads.claude.ai`). Accepted false denies: a flag's value swallowing a prompt's first word (`claude -c "please update tests"`, `claude --model opus "update the docs"`), and `claude --debug update` and `claude --add-dir /tmp update`, which Claude Code does not run as the subcommand. Defined in c06c31775 (Task 1). Widened in 6bc7bf735 after an automated security review of Task 1, each in the safe direction and each pinned in the "D-6063, review hardening" block: the build run by its path is any entry under `versions/`, a glob included, not only `X.Y.Z` (`…/versions/2.1.30* update`, `./2.1.3?? update` after a `cd` there); a global install also takes npm's verb aliases (`in` … `isntall`, `udpate`), `--prefix` to a directory that names `.local`, where the launcher lives (a project-local `--prefix ./vendor` or `--prefix /work/app` stays allowed; narrowed after the whole-branch review) and an `npm_config_global=` or `npm_config_location=` assignment in any case; and the installer's hosts match in any case, in the program (`test(…; "i")`) and in the prefilter (`${apf,,}`). Ten of the block's pins were red on the Task 4 tip (`./next install` and `npm add --global` were already denied); each widening's mutant was measured red on its own pin. Not changed, as the plan rules (measured on 2.1.304): a print-mode word still stops the flags, and `respawn` still counts right after the head only. A build path followed by the word `install`, `update` or `upgrade` anywhere in a command is denied, the head being unanchored (`ls <versions>/2.1.302 update`), an accepted false deny. After the whole-branch review a verb may not run on into a file name (`VEND`: `NW`, and not followed by `.` or `/`), where `NW` alone let `install.json`, `update.json`, `install.sh` and `update/` count after a flag (`claude --settings install.json -p x`, `grep -rn claude -A3 install.sh`); four allowed pins, red under `NW` alone. A first version ended the verb only at the end, a space or a shell metacharacter; an automated security review found that it let an expansion that may be empty run on from the verb (`claude update${U}`, `install$X`, `update$(true)`, `upgrade{,}`), which bash runs as the verb, so the rule excludes only `.` and `/`; four denied pins, red under that first version. Also accepted, disclosed by that review: the `~/.local/bin/<id>` launcher head is any id, so another tool's launcher with a verb after flags is denied (`~/.local/bin/pipx upgrade black`, `~/.local/bin/poetry --no-ansi install`; `~/.local/bin/<id> install` was denied on main), and a mention of the installer's URL is denied (`echo 'see https://claude.ai/install.sh'`). Open, of the stdin kind (D-6064's residuals): a verb fed to a head through `xargs` (`echo update | xargs claude`, `xargs claude < args`), measured allowed in a 49-spelling coverage pass whose other 47 (command prefixes, groups, tabs, `-t`/`--target-directory`, a leading redirection) are denied.
- **D-6064** — `build-writes-any-spelling-and-route` (Task 2): in deny mode only, a write to the build directory or the launcher is matched as `BUILDX`: `.local/share/claude/versions` with nothing after the name, the bare `.local/share/claude` directory (then optional separators and the end, a space or a shell metacharacter) or a last segment under it holding `*`, `?`, `[` or `{`, and `.local/bin/claude` with nothing after the name; each in any separator spelling (`SEPP`: `/`, `//`, `/./` and runs of them, at most eight), absolute, home-anchored or relative at the start of a word. The writers are `BWR`: `WR`'s heads plus `install`, `dd`, `rsync`, `tar`, `unzip`, `chmod`, `chown`, `touch`, `mkdir`, `curl`, `wget`, `unlink`, `shred` and `patch`, and `>`/`>>` with or without a leading digit, `&>` and `>|`, but not a redirection to `/dev/null` nor `>&` followed by a digit or `-`; these arms split segments without splitting a redirection operator (`SEG`). Denied: a `BWR` head before `BUILDX` in one segment (this replaces `WR`/`BUILD` in `bmatch` only; class mode keeps its own); `find` with `BUILDX` and an action (`-delete`, `-exec`, `-execdir`, `-ok`, `-okdir`); `BUILDX` then `| xargs` with a writer; a word-bounded `python…`, `node`, `perl`, `ruby`, `bun` or `deno` anywhere in a command that names `BUILDX` anywhere; a `cd` or `pushd` (up to two of `-P`, `-L`, `-e`, inside `( … )` too) into the build directory, `.local/share`, `.local`, the home directory or `.local/bin`, each row with its own operand rule (a `./` prefix admitted); an assignment whose value is `BUILDX` and a later writer that uses the variable; and an edit tool on a path that matches `BUILDX` once `//`, `/./` and `seg/..` are folded and a leading `~` is expanded. Every segment-scanning arm first tests its anchor on the whole command, so on the 43 KB `cd ~/.local/ && ` input deny mode took 10.8 s where main's took 13.0 s (class mode 4.7 s), and a 40 KB run of `./` separators takes 0.1 s. Pins: the 45 denied Bash commands and six edit-tool calls, the 41 allowed commands and two allowed Writes of the "build guard D-6064" block, a subagent and a top-level case, a residual case, and two timing pins. Mutants, each measured red on its own pin with `-t "D-6064"`: `SEPP` back to `/`; the relative form; the bare-directory alternative; the glob tail; `BWR` back to `WR`; the digit-redirect exemption; the `>|` split; the `/dev/null` and `>&N` exemptions; the `find` arm and its action condition; the `xargs` arm; the interpreter arm; each of the five `cd` rows; each of the `.local/share`, `.local`, home and `.local/bin` rows accepting any operand; the `./` operand; the `cd` flags; the variable arm; the edit-tool normalisation; and the prefilter's `.local` term. The edit-tool normalisation reds on the `x/../versions` Write only (the NotebookEdit pin's `versions/../versions` still names `versions` whole), and the home row accepting any operand reds on `cd ~ && cp /tmp/x .local/share/myapp/` (its other allowed pin never reaches jq). The `cd` rows' tail gate is measured but not pinned: without it the 40 KB `cd <versions> && ` input took 7.65 s where main took 5.52 s and this branch 5.84 s, a margin inside the box's load noise, and the 43 KB pin stays green without it (13.2 s against main's 12.7 s). Residuals, open by design: a symlink into the build directory; a `$VAR` fragment of the path (`.../$V/...`, `${XDG_DATA_HOME:-…}`); case variants; `..` inside Bash text, since only edit-tool paths are normalised (`cp x ~/.local/share/claude/foo/../versions/2.1.400` is allowed, pinned as a known gap); nine or more repeated separators, and nine or more flags before the verb; script files, `eval`, stdin, and an interpreter that does not name the path. Added after the regex and cost review lens, which measured each at b4e065431 (left for the review run; a safety classifier stopped this session's work on them): a redirection with no space before a relative or after-`cd` operand (`cd ~/.local/bin && cat x >claude`, `2>claude`, `cd ~/.ccrc && echo x >claude-a`); `cd --` and a trailing `/.` on the `cd` directory (`cd -- ~/.local/bin`, `cd ~/.local/bin/.`); a glob in the launcher's name (`~/.local/bin/claud[e]`) or below the build directory's first level (`~/.local/share/claude/v*/1.0.0`); `find`'s file-writing actions (`-fprint`, `-fprint0`, `-fprintf`, `-fls`); `|&` before `xargs`; a path assigned by a command substitution or a `for` loop variable; a variable name of 65 characters or more; a permission or ACL change of a trusted file (`setfacl`), which the arm does not treat as a write; and a FIFO swapped in for the deny file, which blocks the hook's read until its timeout, which fails open (D-6066). Added after an automated security review of the pushed branch, measured allowed at 1ddfa8cc6 and left for the review run on the same ruling: a glob in a directory component above the protected name (`~/.local/sh*re/claude/versions/…`, `~/.local/b?n/claude`, `~/.cc-s*/child-deny.settings.json`); and a copy of the build made by a reader and then run under another name, which no head matches (`cat <versions>/X > /tmp/c && /tmp/c update`; a writer such as `cp` out of the build directory is denied). Until W3 adopts the launcher, today's launcher serves the highest build present, so a stray build would be served at the next spawn; after adoption it serves only a smoked build, which is the backstop. Accepted false denies: an interpreter that only reads the build directory (`node --version && ls <versions>`, the `os.listdir` pin), and a write after a `cd` into the build directory that lands elsewhere (`cd <versions> && ls > /tmp/list.txt`). Defined in 9ae4c25b7 (Task 2). Corrected in fb7a1e96a, after an automated security review of Task 2: `hbt` and `hb1` test the writer on the text BEFORE the target, so a `>` whose target is the tail ends that text, and the end-of-text exemption the checker's prototype carried (`(?!SP{0,8}$)`, meant for a `2>&1` left dangling by a `&` split) let `echo x > .local/bin/claude`, `cd ~/.local/bin && echo x > claude`, `cd ~ && echo x > .local/bin/claude` and `D=…; echo x > $D/2.1.400` through. `SEG` never splits a redirection, so that exemption is dropped: only a `/dev/null` target and `>&` followed by a digit or `-` are not writes. The four commands are pins, measured red before the fix; restoring the exemption reds three of them, and the `/dev/null` and `>&N` mutants were re-measured red. Widened again in 90e22def2 after automated security reviews of Tasks 2 and 3, in the safe direction, pinned in the "D-6064 and D-6065, review hardening" block: a writer in a segment that names `.local`, `.local/share` or `.local/bin` as a bare target directory and the name `claude` or an upstream id as a path component (`cp -r /tmp/claude ~/.local/share/`, `install -t ~/.local/bin /tmp/claude`); after a `cd`, the name counts as a path component of an operand after the writer, not only as a bare word (`cd ~/.local/bin && cp /tmp/claude .`): on the `.local/share` and `.local` rows any component (`cp -r ~/src/claude/assets myapp/` is denied there), on the `.local/bin` row the last one; which makes the plan's separate `./` operand form a case of it; and the variable arm, which scanned every segment once per assigned name and so took minutes on 40 KB of assignments (past the hook's timeout, which fails open), now scans once with an alternation of the names and denies outright above 16 build-path assignments, fail-closed (counted as assignments, not distinct names: a further review found that seventeen assignments of one name filled the window before `unique`, so an eighteenth name's writer went unread; pinned, and the mutant that counts after `unique` reds it); on that 40 KB input it takes 3.7 s where main's deny program takes 4.1 s, pinned at most 3.5 times class mode. The `find`, `xargs`, interpreter and variable arms became `findw`, `xargsw`, `INTERP` and `varw`, shared with D-6065, and their mutants were re-measured red on this block's pins. More accepted false denies: a write naming `claude` as a component next to a bare `.local` directory that lands elsewhere (`ls ~/.local/bin > /tmp/claude`), and after a `cd` a write whose operand ends in `/claude` elsewhere. Still open: an archive extracted into a parent directory whose name does not say `claude` (`tar -xzf b.tgz -C ~/.local/share`). Accepted false denies the whole-branch review measured, all in the safe direction: copying or archiving OUT of the build directory, since a writer and the path share a segment (`tar -czf /tmp/b.tgz ~/.local/share/claude`, `cp -r ~/.local/share/claude /tmp/inspect`, `rsync -a ~/.local/share/claude/ /tmp/backup/`, `dd if=<versions>/2.1.302 … | xxd`, `find <versions> -type f -exec sha256sum {} +`, `ls -d <versions>/* | xargs du -sh > /tmp/sizes.txt`); a fixture tree with the same layout under another root (`mkdir -p /tmp/fx/.local/share/claude/versions`), since the match is not anchored to HOME; a mention after a writer word (`echo "install dir: ~/.local/share/claude/versions"`, `grep -rn 'mkdir -p ~/.local/share/claude/versions' docs/`); and a later `cd` does not reset the build-directory row (`cd <versions>; cd ~/project && npm test > /tmp/log 2>&1`).
- **D-6065** — `build-trusted-files` (Task 3): spec §7.6's registry-path sentence (the pattern covers `~/.ccrc/claude-*` and `$REG/claude-roll-*`) held for the classifier and the hook's class mode (`fmatch`'s registry-path rule) but not for the deny arm, so for a child these files were open. In deny mode only, `TRUST` names, in any separator spelling: `/.ccrc/claude-<name>`, `/.cc-sessions/claude-roll-<name>`, `/.cc-sessions/<id>.claude-canary`, `/.cc-sessions/<id>.claude-build`, `/.cc-sessions/.claude-roll.lock`, `/.cc-sessions/child-deny.settings.json` and `/.cc-sessions/<id>.deny-settings`. Denied as "a write to a file the Claude Code launcher, roll or guard trusts": a `BWR` head before a `TRUST` path in one segment; a `cd` into `.ccrc` or `.cc-sessions`, then a writer whose operand is one of those names; and an edit tool on a `TRUST` path after Task 2's normalisation. So §7.6's registry sentence now holds for children through the hook's deny arm, and the deny file and the digests recorded against it (`$REG/<id>.deny-settings`) are protected, which matters because Task 4's arm reads that file. `/.cc-sessions/claude-roll-<name>` also matches every registry file of a session whose id starts `claude-roll-`, the safe direction. The prefilter admits `.cc-sessions` (`~/.ccrc`'s files are admitted by `ccrc`). Pins: the 12 denied commands, three denied edit-tool calls and six allowed reads of the "build guard D-6065" block (beyond the plan's list: denied `<id>.claude-build` and `.claude-roll.lock`, so each `TRUST` alternative has its own pin, and `cd ~/.cc-sessions && cp /tmp/x child-deny.settings.json`; the edit pin `…//x/../claude-roll-live`; and the allowed `cd ~/.ccrc && cat claude-target`), and a subagent and top-level case; all 16 denied cases were red on the Task 2 tip. Mutants, each measured red with `-t "D-6065"`: the Bash arm; each `cd` arm (`.ccrc`, `.cc-sessions`); the edit-tool arm; each of the seven `TRUST` alternatives on its own pin; and the prefilter's `.cc-sessions` term. Defined in dee7477ac (Task 3). Widened in 90e22def2 after an automated security review of Task 3, in the safe direction, pinned in the "D-6064 and D-6065, review hardening" block: a writer with `.ccrc` or `.cc-sessions` as a bare target directory and a trusted name as a path component (`cp /tmp/claude-smoked ~/.ccrc/`); the `find`, `xargs`, interpreter and variable arms for `TRUST` paths, as for the build's; glob characters in the trusted names (`rm ~/.ccrc/claude-*`, `*.claude-canary`) and a glob segment directly under `.ccrc` or `.cc-sessions` (`rm -rf ~/.ccrc/*`, which also denies a glob write to any registry file, the safe direction); and the relative spelling at the start of a word (`cd ~ && rm .ccrc/claude-halted`). Each was red on the Task 4 tip, and each widening's mutant was measured red on its own pin; the glob characters in the names red only on two pins added for a bare operand after a `cd` (`cd ~/.ccrc && rm claude-*`, `cd ~/.cc-sessions && rm *.claude-canary`), since a full path's glob segment is caught by the glob-segment alternative already. Accepted false denies the whole-branch review measured: a copy OUT of a trusted file (`cp ~/.ccrc/claude-target /tmp/t.bak`), a fixture tree under another root (`touch /tmp/fx/.cc-sessions/lane-a-p.claude-canary`, `echo 2.1.1 > $H/.ccrc/claude-target`), and a mention after a writer word (`grep -rn 'touch ~/.cc-sessions/claude-roll-live' server/test/`).
- **D-6066** — `build-upstream-id-from-deny-file` (Task 4): the deny file `$REG/child-deny.settings.json`, which `install-session-hooks.sh` writes from `childDenyRules` and which names the roster's upstream id, was read only by the PermissionRequest arm (`_hook_approval_wait`, its digest check). The PreToolUse deny arm now reads it too: when it is a regular file and not a symlink, the hook reads at most 64 KiB of it with a bounded builtin read (`_hook_deny_text`, under `LC_ALL=C` so the cap counts bytes) and passes the text as `--arg deny`, read as `$ARGS.named.deny // ""` so the class-mode call and the test's jq helper still compile; it is parsed under `try`; and every `<p>` the file holds as BOTH `Bash(<p> install:*)` and `Bash(<p> update:*)` (the pair `childDenyRules` emits for a Claude Code head), unique, minus `claude`, becomes `UPRE`; an empty list is `(?!)`. Every deny file holds `Bash(ccrc update:*)` alone, which is why one verb is not enough. With those names a bare `<p>` head followed by Task 1's flags and verb is denied (and a `$VAR` head in a command naming `<p>`, beyond the plan's list), and so are writes onto `.local/bin/<p>` with nothing after the name, by Task 2's writers and arms (the `cd ~/.local/bin`, `cd ~/.local` and `cd ~` rows included) and by the edit tools. A missing, unreadable, non-regular, symlinked, over-cap or unparsable file leaves the arm as on main. The file is shared by the whole box, so a child that makes it unreadable costs every child only the upstream-id arms, which main never had. The fixture deny files are built by the real `ccd/install-session-hooks.sh --homes` in a fixture HOME, as `install-session-hooks.test.ts` invokes it, with `~/.ccrc/accounts.sh` holding `CCRC_UPSTREAM=upstream-a` or absent. Pins: the "build guard D-6066" block (13 denied commands, Write and Edit on the upstream launcher, five allowed commands, three default-file commands that get no build reason, the parity case over every paired head, the regression case with no, a symlinked and an unparsable file, a top-level case, and the timing pin: 40 KB of `upstream-a -a ` with the file, under 1 s); every denied pin and the parity case were red on the Task 3 tip. Mutants, each measured red with `-t "D-6066"`: the `--rawfile` argument dropped; the pair condition loosened to either verb (the default-file `ccrc` pins); the bare-name head; the launcher-write alternative (Bash and the edit tools share `BUILDX`, so one mutant reds both, and the plan's separate edit-tool mutant is that same one); the `cd ~/.local/bin` row without the upstream id; the `$VAR` head without it; the launcher's look-ahead without `.` (`upstream-a.bak`); the symlink check; the prefilter's standalone `install`/`update` reverted to main's `claude` group; and the `try` removed (jq fails on an empty or unparsable file, and the arm fails open). The classifier side stays open, as D-5993 now says. Defined in 2e9be8574 (Task 4). Corrected after the regex and cost review lens measured that a file `--rawfile` could not read (mode 000, a directory, a file removed after the test) made jq exit 2 with no output, so the verb, surface and build arms all allowed, for every child on the box, since the file is one per box (in a fixture HOME at dea811329, mode 644 denied `ccd ws-rm x`, `ccrc-api approvals list` and `claude update`, and mode 000 none of them): the hook now reads the file itself, bounded, and passes the text as `--arg deny`, so the file can no longer make the jq call fail. A retry without the file would not have been enough: a FIFO, a symlink to `/dev/zero` or a very large file blocks jq or runs it unbounded, past the hook's timeout, which fails open before any retry. The cap stays well under the 128 KiB one `--arg` may hold, since E2BIG would fail open again. A FIFO still blocks the open: a residual (D-6064's list), as `install-session-hooks.sh` already accepts. Pins: the regression case gains a surface assertion and two setups, mode 000 (skipped as root, its mode restored in `finally`) and a 200 KB file naming `upstream-a`; in every setup the verb, surface and build cases deny and `upstream-a update` is allowed, as on main. Mutants, measured red with `-t "over-cap"`: back to `--rawfile` (red on mode 000) and the cap dropped (red on the over-cap file, where `--arg` fails with E2BIG).
