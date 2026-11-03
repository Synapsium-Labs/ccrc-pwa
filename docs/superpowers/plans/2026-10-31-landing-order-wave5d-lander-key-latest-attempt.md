# Landing order, wave 5d — the lander key and the latest-attempt rule Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the operator's answers to question 3 and D-7546, and close the radar's carried wording items.
- **The lander key.** The conflict radar accepts `lander=coordinator` or `lander=none` in a project's landing conf,
  and mirrors a valid `lander=coordinator` as `$REG/landing/<project>/lander`. No key means `none`. Nothing reads the
  marker in this wave: 5i adds its reader.
- **The latest-attempt rule.** §5b's prose says what the verdict already does: the latest attempt of each required
  check name decides. An earlier failed attempt, read with `filter=all`, is a line the coordinator names in its turn's
  text, never a stop. The verdict fence is byte-identical.
- **The radar's carried items.** Review 1171's wording and pins, and the order in which the tick takes projects:
  least recently measured first, so a tail project no longer misses every tick (review 1125's N6).

**Why:**
- The radar refuses an unknown key today. `parse_conf` answers `unknown-key`, and the whole conf then stops being
  measured. So the radar learns the key before the operator writes it, and the operator writes it only once the fleet
  box runs this wave's probe.
- Wave 5b landed without its Task 2 (D-7546). The skill text still states the strict reading of D-7495, which the
  operator has now ruled out.

**Architecture:**
- **Task 1** (`ccd/ccd-land-probe`, `ccd/ccrc`, README): the key in `parse_conf`, the marker in `reconcile_enabled`'s
  pass, `remove_own`'s names, uninstall's removal of the marker, and their fixture-HOME cases.
- **Task 2** (`ccd/coordinator-skill/references/wave-lifecycle.md`, `server/test/coordinator-skill.test.ts`): the stop
  paragraph's D-7495 sentence restated, one paragraph on the latest-attempt rule, and their pins.
- **Task 3** (`ccd/ccd-land-probe`, `ccd/ccrc-doctor-checks`, README, the wave 3b notes): the tick's order, review
  1171's wording and pins, and their cases.
- **Task 4:** the gate, the PR and the wave-done.

**Tech Stack:** Python 3 (the probe), bash (`ccd/ccrc`), Markdown skills; vitest with fixture git and fixture HOMEs.

**Spec:** `docs/superpowers/specs/2026-09-23-landing-order-and-main-churn-design.md`: §5.3 (the radar and its conf), §5.4 (the `enabled` mirror and its reader),
§5.5 (the landing line, which reads the marker in 5i) and §5.7 (the landing route and read 5).

**Other sources:**
- the ledger, `docs/superpowers/programs/landing-order.md`: row 5d; the Decisions entry that records wave 5e's merge
  and the operator's rulings; the Carried constraints "From wave 3b's reviews (1140, 1143, 1158 and 1171)" and "A
  project the tick budget leaves unstarted";
- D-7546's definition, `docs/superpowers/plans/2026-10-30-landing-order-wave5a-departures.md`, and D-7495's, in `docs/superpowers/plans/2026-10-29-landing-order-wave4c-lineage-hardening.md`;
- wave 3b's plan and notes, `docs/superpowers/plans/2026-10-27-landing-order-wave3b-conflict-radar.md` and its
  directory.

**Prerequisite:** none. 5d does not depend on 5e. It ships to the fleet box first: the probe and the skill text
travel with ccrc's updater.

**Plan review.**
- **Drafting.** Each task was drafted against `main` by its own Opus reader, and a Sonnet reader checked it against
  `main`: every code claim, every red-first step and every mutation row's red. All their fixes are applied. The
  coordinator ruled on every departure the drafts proposed. The marker is written on the conditions `enabled` uses,
  except for the lineage test (D-7636). The tick takes projects least recently measured first, instead of a
  clock-based rotation (D-7642). The wave 3b notes are corrected in place (D-7646).
- **Review.** Three Opus lenses then reviewed the whole plan (cross-task executability, spec fidelity, and fail-closed
  with the repository rules), and Sonnet refuters checked the serious findings. No critical finding was raised. Each
  important finding that held is answered:
  - the new paragraph says both kinds of `red-unreachable`: a red that no rerun reaches, and one still red after the
    one rerun;
  - Task 3 anchors its README insertion on Task 1's rewritten paragraph;
  - the multi-tick probe cases carry explicit timeouts;
  - D-7642's fallback drops every order assertion and row with it;
  - a symlinked landing directory is never followed, so 5i must read a marker reached through one as absent (D-7647);
  - the read-only census's existing pins stay unchanged, and the new write is checked in the diff.
- **Minors.** Each minor finding is answered.

## What this does not claim
- **No reader of the marker.** 5i reads `$REG/landing/<project>/lander`. Until then the marker changes nothing.
- **No server change, and no `CLAUDE.md` change.**
- **No new git verb.** D-7391 (`git show-ref --exists`) adds a verb to the probe's git door, which is the operator's
  to decide. It stays carried, as do D-7393's marker for a null `id`, an interrupted tick's marker, and the killed-tick
  remnants.
- **No change to the verdict.** The block already decides over the latest attempt. Only the prose changes.

## Global Constraints
- **Modules first.** Run `npm ci` in `server/` before Task 1.
- **Fixture git and fixture HOMEs only.** Never run `ccd`, the probe, `ccrc install` or `ccrc doctor` against the
  live HOME. Never write `~/.ccrc/landing/` or `$REG/landing/` on the live box.
- **The probe stays read-only toward git and GitHub.** No new import, `gh` or git shape is added, so every existing pin
  in `ccd-land-probe-readonly.test.ts` stays green unchanged (Task 3 only adds one wording case and edits its header
  comment). New files are written only through `write_json`. No source pin holds that, so the reviewer checks it in the
  diff: the only new write is the `lander` row's `write_json(ldir, name, doc)`, and the only new removals are
  `remove_own` calls.
- **Tests.**
  - Every test runs as `ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 <files>` from `server/`, in the
    foreground, with a timeout of at least 600000 ms.
  - `typecheck-tests` runs alone, and `tsc --noEmit` runs for the server.
- **Growth.** `ccd/ccrc` is growth-listed. Run `growth-check` with `GROWTH_CHECK=1` after `git fetch origin main`, and
  report its net delta.
- **The verdict fence is byte-identical.** On `origin/main`, the 254 body lines of `wave-lifecycle.md`'s `### 5b`
  `bash` block hash to `dec52b5aaf9d6166853a25a18db29d2203a38fd6ace044f7c7068e43c4eef3a7`.
- **Skill text.** No clause is added or removed: `CONTRACT` stays 19. No new skill sentence holds a double quote.
  Every paragraph written in `wave-lifecycle.md` wraps at 80 columns.
- **Cite code by symbol or `@anchor`,** never by file and line.
- **Mutations.** Run them sequentially in the worktree, bounded with `timeout -k` and a measured `ulimit -u`. Restore
  each mutated file from a saved copy with its sha256 checked and its mode kept (`ccd/ccd-land-probe` and `ccd/ccrc`
  are executable), never with `git checkout`, and keep each row's log under `.superpowers/sdd/`.
- **Neutral names only.** The repository is public (`project-a`, `proj-a`, `lane-a`).
- **Deviation numbers are issued, never chosen.** A departure found during execution is named by slug in the
  wave-done (`D-TBD-<slug>`), and the coordinator numbers it.
- **The wave-done waits for the PR's fast run** on the exact tip, and reports its conclusion. A red there is a red
  gate.
- **Commits** go on the workspace's own branch. Never update-branch, rebase or force-push.

## Review Focus
1. **The key never arms by accident.** A bad value, a repeat, a CR left by a CRLF line or a case variant answers
   `conf-invalid` and removes both mirrors. A conf with no `lander` key, or `lander=none`, writes no marker and removes
   a standing one.
2. **The marker is removed in every other case.** That covers a paused project, one that is not a checkout, a removed
   conf, and a directory under `$REG/landing/` with no conf. A symlinked landing directory is never followed, so nothing
   in it is written or removed (K7), and 5i's reader must treat a `lander` reached through a symlinked `$REG/landing` or
   project directory as absent (D-7647). Uninstall removes it with `enabled`.
3. **The key changes no measurement.** With or without `lander`, the tick writes the same `probe` and `main-health`.
   `lineage` and `lander` are independent.
4. **No sentence still says an earlier failed attempt stops a landing.** The RED bullet's one rerun and the new-head
   route's facts stay true under the latest-attempt rule. The every-attempt read is a report line, and a failed read
   of it is no stop. The fence hash is unchanged.
5. **The tick's order is deterministic and read-only.** A project with no `probe` goes first, ties fall to the name,
   and the order key is read with `lstat`, never followed or opened. No new file or git shape is added.

**Task order:** 1, 2, 3, 4. Tasks 1 and 3 both edit `ccd/ccd-land-probe` and `ccd-land-probe.test.ts`: Task 3 starts
from Task 1's commit.

---

### Task 1: the lander key and its marker

Scope item 1 (the operator's ruling on question 3). The radar learns `lander=coordinator|none` before anyone writes it. It mirrors a valid `lander=coordinator` as `$REG/landing/<project>/lander` in the same pre-pass that mirrors `lineage=on` as `enabled`. Nothing reads the marker in this wave. Sub-wave 5i adds its reader.

**The marker's write condition, argued (spec §5.4, §5.5, §5.7 on `main`).** `lander` is written under exactly the conditions `enabled` is written under, except for the lineage test. That means: a valid conf with `lander=coordinator`, the project not paused (`is_paused`), a real main checkout (`is_checkout`), and both directories passing `ensure_dir`. In every other case the marker is removed. `lineage` plays no part: `lineage=off` with `lander=coordinator` still writes the marker. The reasons:
- §5.4 makes `enabled` a mirror of an operator file the agent cannot read, and its table treats a paused project as not opted in; wave 3b writes it only for an unpaused project with a checkout. Section 5.5 builds the line on that same radar: "Next to land" is "the radar names the head whose composition against the current base is clean", and item 6 clears `mainRedHold` only on "a green `main-health` reading". A paused project, or one with no checkout, gets no `probe` or `main-health` on any tick. A marker standing there would declare a line whose inputs are never refreshed.
- An absent marker leaves the line inert (5i). That is the subtractive direction. The line stops naming heads and holding, but it does not land anything by itself. Under §5.7 the coordinator still reads the repository's own rules before every landing, whichever way the marker reads. So removing the marker under a pause fails closed. Keeping it would let 5i read a declaration that the radar no longer backs.
- §5.5 keeps the operator's line pause (`operatorPaused`, in `coord.db`) separate from the radar's per-project `paused` file, and this wave adds no server state. The README already says a radar pause "stops acceptance as well as measurement". It now stops the line's declaration as well, which uses the same file and the same remedy.
- `lineage` does not gate the marker, as the scope ruling requires. Under the operator's ruling on D-7472, `lineage=on` stays off on this repository, so a marker gated on lineage would never be written; §5.5's line does not depend on stage 4's lineage acceptance.

**Files:**
- Modify: `ccd/ccd-land-probe`. Change `parse_conf`'s key loop, value check and default dict; `reconcile_enabled` (keep its name); `remove_own`'s name guard and its docstring; a new module constant `MIRRORS`; and the header comment (WHAT IT MEASURES, step 3 of THE TICK, PATHS).
- Modify: `README.md`, the "Conflict radar (ccd-land-probe)" section only (the file table, the reconcile paragraph, **The conf.**, the pause and uninstall sentences).
- Modify: `ccd/ccrc`. Only the radar mirror loop in `_uninst_cc_sessions`, which removes `enabled` today (D-7635, `uninstall-removes-lander`).
- Test: `server/test/ccd-land-probe.test.ts` (a new describe at the end of the file), `server/test/ccrc-uninstall.test.ts` (one new case).
- Not modified: `ccd/ccrc-doctor-checks`' land-probe check. It counts conf files and reads their mtime, never a key, so `lander=` changes no doctor line.
- Run, not modified: `server/test/ccd-land-probe-readonly.test.ts`, `server/test/ccd-land-probe-doctor.test.ts`, `server/test/ccd-land-lineage-accept.test.ts`, and the guards listed in Step 5.

**Interfaces:**
- The conf key is `lander`. Its values are `coordinator` and `none`. With no key the default is `none`: `parse_conf` returns `{'base': 'main', 'lineage': 'off', 'lander': 'none'}`. Any other value, matched byte for byte with no strip (`Coordinator`, `coordinator ` with a trailing space, an empty value, `on`, a CR left by a CRLF line), answers `bad-value`. A second `lander=` line answers `repeated-key` through the existing `seen` set. `bogus=1` still answers `unknown-key`.
- A new module constant, `MIRRORS = ('enabled', 'lander')`, names the files the pre-pass owns. `remove_own(dirpath, name)` deletes a regular file whose name is in `MIRRORS` or ends with `.lineage`, and nothing else. Its two `real_dir` checks stay as they are.
- The marker is `$REG/landing/<project>/lander`, written by `write_json` (`v`, `project`, `lander`, `at`, in that key order): `{"v":1,"project":"<project>","lander":"coordinator","at":"<now_iso()>"}`. In one pass a project's `enabled` and `lander` carry the same `at`, computed once per project. Absent means the project is not a coordinator-lands project. Its one reader-to-be is 5i's server reader. Nothing in this wave reads it.
- `reconcile_enabled(projects)` keeps its name and its place (before the measuring loop). Its orphan loop removes every name in `MIRRORS` from a directory under `$REG/landing/` that has no conf. `handle_project` and `probe_project` do not read `conf['lander']`, so the key changes no measurement.
- No new `gh` or git shape, no new import, no new file writer: every existing case in `ccd-land-probe-readonly.test.ts` stays green unchanged (only Task 3 adds a wording case and edits its header comment).

- [ ] **Step 1: The failing cases (red first).** Append to `server/test/ccd-land-probe.test.ts`:
  ```ts
  describe('ccd-land-probe: the lander key and its mirror (landing order wave 5d)', () => {
    const LANDER_KEYS = ['v', 'project', 'lander', 'at'];
    const arm = (text = 'lander=coordinator\n'): void => {
      fx.conf(fx.project, text);
      expect(fx.run().status).toBe(0);
    };

    it('K1 lander=coordinator is accepted and mirrored, whatever lineage says', { timeout: 60_000 }, () => {
      fx.addHead(1, { 'a.txt': 'a\n' });
      fx.conf(fx.project, 'lander=coordinator\n');
      const r = fx.run();
      expect(r.status).toBe(0);
      expect(r.stderr).not.toContain('conf-invalid');
      const doc = fx.readJson('lander');
      expect(Object.keys(doc)).toEqual(LANDER_KEYS);
      expect(doc).toMatchObject({ v: 1, project: 'proj-a', lander: 'coordinator' });
      expect(Math.abs(Date.parse(doc.at) - Date.now())).toBeLessThan(60_000);
      expect(fx.exists('enabled')).toBe(false);           // lineage defaults to off
      expect(fx.exists('probe')).toBe(true);              // the key changes no measurement
      arm('lineage=on\nlander=coordinator\n');
      expect(fx.readJson('lander').at).toBe(fx.readJson('enabled').at);   // one pass, one time
      arm('lineage=off\nlander=coordinator\n');
      expect(fx.exists('lander')).toBe(true);
      expect(fx.exists('enabled')).toBe(false);
    });

    it('K2 lander=none, and no lander key at all, write no marker and remove a standing one', { timeout: 120_000 }, () => {
      fx.addHead(1, { 'a.txt': 'a\n' });
      for (const text of ['lander=none\n', '', 'lineage=on\n', 'lineage=on\nlander=none\n']) {
        arm();
        expect(fx.exists('lander'), text).toBe(true);
        fx.conf(fx.project, text);
        const r = fx.run();
        expect(r.status, text).toBe(0);
        expect(r.stderr, text).not.toContain('conf-invalid');
        expect(fx.exists('lander'), text).toBe(false);
        expect(fx.exists('enabled'), text).toBe(text.includes('lineage=on'));
        expect(fx.exists('probe'), text).toBe(true);
      }
    });

    it('K3 any other value is conf-invalid: bad-value, and removes both mirrors', { timeout: 180_000 }, () => {
      fx.addHead(1, { 'a.txt': 'a\n' });
      for (const v of ['Coordinator', 'coordinator ', '', 'on', 'yes', 'operator', 'coordinator\r']) {
        arm('lineage=on\nlander=coordinator\n');
        expect(fx.exists('lander'), JSON.stringify(v)).toBe(true);
        fx.conf(fx.project, `lineage=on\nlander=${v}\n`);
        const r = fx.run();
        expect(r.status).toBe(0);
        expect(r.stderr, JSON.stringify(v)).toContain('conf-invalid proj-a: bad-value');
        expect(fx.exists('lander'), JSON.stringify(v)).toBe(false);
        expect(fx.exists('enabled'), JSON.stringify(v)).toBe(false);
      }
    });

    it('K4 a repeated lander is conf-invalid: repeated-key, and removes the marker', { timeout: 90_000 }, () => {
      fx.addHead(1, { 'a.txt': 'a\n' });
      for (const text of ['lander=coordinator\nlander=coordinator\n', 'lander=none\nlander=coordinator\n']) {
        arm();
        fx.conf(fx.project, text);
        const r = fx.run();
        expect(r.status).toBe(0);
        expect(r.stderr, text).toContain('conf-invalid proj-a: repeated-key');
        expect(fx.exists('lander'), text).toBe(false);
      }
    });

    it('K5 an unknown key beside lander is still unknown-key, and removes the marker', () => {
      fx.addHead(1, { 'a.txt': 'a\n' });
      arm();
      fx.conf(fx.project, 'lander=coordinator\nbogus=1\n');
      const r = fx.run();
      expect(r.stderr).toContain('conf-invalid proj-a: unknown-key');
      expect(fx.exists('lander')).toBe(false);
    });

    it('K6 removal reaches every other case in the same pass: paused, not a checkout, a conf removed, a directory with no conf; lineage=off keeps it', { timeout: 90_000 }, () => {
      const plant = (name: string): string => {
        const d = path.join(fx.reg, 'landing', name);
        fs.mkdirSync(d, { recursive: true });
        fs.writeFileSync(path.join(d, 'lander'), '{}\n');
        return path.join(d, 'lander');
      };
      const off = makeLandFixture(h, { project: 'proj-off', slug: 'o/off' });
      const gone = makeLandFixture(h, { project: 'proj-gone', slug: 'o/gone' });
      fx.addHead(1, { 'a.txt': 'a\n' });
      fx.conf('proj-a', 'lander=coordinator\n');
      fx.pause('project');
      fx.conf('proj-off', 'lineage=off\nlander=coordinator\n');
      fx.conf('proj-nocheckout', 'lander=coordinator\n');
      fx.conf('proj-gone', 'lander=coordinator\n');
      expect(fx.run().status).toBe(0);
      expect(gone.exists('lander')).toBe(true);
      fs.rmSync(gone.confPath());
      const files = ['proj-a', 'proj-nocheckout', 'orphan'].map(plant);
      expect(fx.run().status).toBe(0);
      for (const f of files) expect(fs.existsSync(f), f).toBe(false);
      expect(gone.exists('lander'), 'a removed conf').toBe(false);
      expect(off.readJson('lander')).toMatchObject({ v: 1, project: 'proj-off', lander: 'coordinator' });
    });

    it('K7 a landing directory that is a symlink keeps the lander files in its target', () => {
      fx.addHead(1, { 'a.txt': 'a\n' });
      fx.conf(fx.project, 'lander=none\n');
      const target = path.join(h.home, 'landing-target');
      const files = ['proj-a', 'orphan'].map((n) => {
        fs.mkdirSync(path.join(target, n), { recursive: true });
        const f = path.join(target, n, 'lander');
        fs.writeFileSync(f, '{}\n');
        return f;
      });
      fs.mkdirSync(fx.reg, { recursive: true });
      fs.symlinkSync(target, path.join(fx.reg, 'landing'));
      expect(fx.run().status).toBe(0);
      for (const f of files) expect(fs.readFileSync(f, 'utf8'), f).toBe('{}\n');
    });
  });
  ```
  The existing `enabled mirrors lineage=on …` case, with its `bogus=1` `unknown-key` assertion, stays unchanged. Then append to `server/test/ccrc-uninstall.test.ts`, beside the 3b landing case:
  ```ts
  it('~/.cc-sessions: the lander mirror goes with enabled, under the same rules (landing order wave 5d)', () => {
    const home = mkTmp('ccrc-uninst-lander-');
    plantInstalledBox(home);
    const land = join(home, '.cc-sessions', 'landing');
    const keep = (rel: string): string => join(land, rel);
    for (const d of ['proj-a', 'proj-a/sub', 'proj-b']) mkdirSync(keep(d), { recursive: true });
    writeFileSync(keep('proj-a/lander'), '{"v":1,"project":"proj-a","lander":"coordinator","at":"2026-10-31T09:00:00Z"}\n');
    writeFileSync(keep('proj-a/enabled'), '{"v":1}\n');
    writeFileSync(keep('proj-a/probe'), '{"v":1}\n');
    writeFileSync(keep('proj-a/sub/lander'), 'deeper\n');
    mkdirSync(join(home, 'elsewhere'), { recursive: true });
    writeFileSync(join(home, 'elsewhere', 'target'), 'not ours\n');
    symlinkSync(join(home, 'elsewhere', 'target'), keep('proj-b/lander'));
    writeFileSync(keep('lander'), 'stray\n');
    const r = runVerb(home, 'uninstall', ['--force']);
    expect(r.code, r.stderr).toBe(0);
    expect(existsSync(keep('proj-a/lander')), 'the lander mirror survived').toBe(false);
    expect(existsSync(keep('proj-a/enabled'))).toBe(false);
    for (const rel of ['proj-a/probe', 'proj-a/sub/lander', 'lander']) expect(existsSync(keep(rel)), rel).toBe(true);
    expect(lstatSync(keep('proj-b/lander')).isSymbolicLink()).toBe(true);
    expect(readFileSync(join(home, 'elsewhere', 'target'), 'utf8')).toBe('not ours\n');
  });
  ```

- [ ] **Step 2: Run, and see each new case fail for its own reason.**
  `cd server && ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/ccd-land-probe.test.ts test/ccrc-uninstall.test.ts`
  The expected reds:
  - K1: `stderr` contains `conf-invalid proj-a: unknown-key`, and `readJson('lander')` throws ENOENT.
  - K2: the first `arm()` writes no marker (`expected false to be true`).
  - K3: the marker is not armed, so the first `toBe(true)` is red.
  - K4: the first loop's stderr reads `unknown-key`, not `repeated-key`.
  - K5: green on `main`, since `unknown-key` already removes nothing that exists. It is recorded as a characterization case, not a red.
  - K6: `gone.exists('lander')` is false after the first run, and `off.readJson('lander')` throws.
  - K7 is green on `main` (characterization); 5D-KEY-15 turns it red.
  - The uninstall case: `proj-a/lander` survives (`the lander mirror survived`).

- [ ] **Step 3: The implementation.** In `ccd/ccd-land-probe`:
  - `parse_conf`:
    ```python
    conf = {'base': 'main', 'lineage': 'off', 'lander': 'none'}
    ...
    if key not in ('base', 'lineage', 'lander'):
        return None, 'unknown-key'
    ...
    elif key == 'lineage':
        if value not in ('on', 'off'):
            return None, 'bad-value'
    elif value not in ('coordinator', 'none'):
        return None, 'bad-value'
    ```
  - A module constant, beside `remove_own`: `MIRRORS = ('enabled', 'lander')   # the pre-pass's own files: written by write_json in reconcile_enabled, removed by remove_own`.
  - `remove_own`: the guard becomes `if '/' in name or not (name in MIRRORS or name.endswith('.lineage')): return`. The docstring becomes `"""Delete a regular file named \`enabled\`, \`lander\` or \`*.lineage\` in a real, owned directory under a real, owned $REG/landing/, and nothing else: both directories are lstat-checked, so a symlinked landing directory is left alone."""`
  - `reconcile_enabled(projects)`:
    ```python
    for project in projects:
        ldir = LANDING + '/' + project
        conf, _ = parse_conf(CONF_DIR + '/' + project + '.conf')
        live = conf is not None and not is_paused(ldir) and is_checkout(project)
        at = now_iso()
        for name, wanted, doc in (
                ('enabled', live and conf['lineage'] == 'on', {'v': 1, 'project': project, 'at': at}),
                ('lander', live and conf['lander'] == 'coordinator',
                 {'v': 1, 'project': project, 'lander': 'coordinator', 'at': at})):
            if wanted and ensure_dir(LANDING, 'landing', True) and ensure_dir(ldir, project, True):
                write_json(ldir, name, doc)
            else:
                remove_own(ldir, name)
    ...
    for n in names:
        if PROJECT_RE.fullmatch(n) and not os.path.lexists(CONF_DIR + '/' + n + '.conf'):
            for name in MIRRORS:
                remove_own(LANDING + '/' + n, name)
    ```
    The docstring's first sentence becomes: `The two mirrors, reconciled in one pass at the start of the tick, before any project is measured: \`enabled\` is written for each valid conf with lineage=on, and \`lander\` for each valid conf with lander=coordinator whatever lineage says, each only for an unpaused project with a real main checkout, and each is removed in every other case (an invalid conf, its key not set, paused, not a checkout), and for every directory under $REG/landing/ with no conf at all.` The rest of the docstring stays.
  - The header comment:
    - WHAT IT MEASURES gains a last bullet: `#   - the landing line's mirror of lander=coordinator, with its own time (\`lander\`; for stage 5's landing line, which does not read it yet).`
    - Step 3's title becomes `THE MIRROR PRE-PASS`. Its sentence becomes `writes \`enabled\` for a valid conf with lineage=on, and \`lander\` for a valid conf with lander=coordinator whatever lineage says, each for an unpaused project and a real main checkout, and removes each in every other case (an invalid or missing conf, its key not set, paused, not a checkout, a directory with no conf at all)`. The last sentence becomes `The measuring loop never writes or removes \`enabled\` or \`lander\`.`
    - PATHS: the conf line becomes `(base=, lineage=on|off, lander=coordinator|none)`. After the `enabled` line, add `#   $REG/landing/<project>/lander         this probe: the mirror of lander=coordinator`.
  - `ccd/ccrc`, `_uninst_cc_sessions`'s radar loop. Replace the single `lfile="$ldir/enabled"` test with:
    ```bash
    for lfile in "$ldir/enabled" "$ldir/lander"; do
      if [ -f "$lfile" ] && [ ! -L "$lfile" ]; then
        rm -f -- "$lfile" || _ccrc_die "removing the radar's opt-in mirror $lfile failed"
      fi
    done
    ```
    The comment above the radar loop has its opening rewritten as: "The conflict radar's two mirrors (landing order wave 3b, and wave 5d's `lander`): `$reg/landing/<project>/enabled` and `lander`, the two files the probe writes that a LATER reader trusts (spec 5.4, 5.5). ... ONLY a regular file named `enabled` or `lander`, ONE level under ..."
  - `README.md`, Conflict radar section, verbatim:
    - `It writes four JSON files` becomes `It writes five JSON files`. The table gains a row after `enabled`: ``| `lander` | the mirror of the conf's `lander=coordinator`, with its own time; absent means the project is not a coordinator-lands project, and stage 5's landing line, which does not read it yet |``
    - The reconcile paragraph's first two sentences become: ``The two mirrors, `enabled` and `lander`, are reconciled in one pass at the start of every tick that runs, before any project is measured. `enabled` is written for a valid conf with `lineage=on`, and `lander` for a valid conf with `lander=coordinator` whatever `lineage` says, each only for an unpaused project with a real main checkout, and each is removed in every other case.``
    - The reconcile paragraph's next sentence begins `Its writes are therefore`; it becomes `Their writes are therefore`.
    - **The conf.** The old text is hard-wrapped on `main` and spans three lines: `... There are` / ``two keys: `base`, a branch name that defaults to `main`, and `lineage`, `on` or `off`, which defaults to `off`. An`` / `empty conf turns the radar on ...`. The edit replaces from `There are` through ``which defaults to `off`.`` across the line break, and the new text is re-wrapped at the README's existing width (about 118 columns):
      ```
      There are three keys: `base`, a branch name that defaults to `main`; `lineage`, `on` or `off`, which defaults to
      `off`; and `lander`, `coordinator` or `none`, which defaults to `none` and says who lands the project's PRs. A probe
      older than this key reads a conf that names it as `unknown-key` and stops measuring that project, so write `lander=`
      only once the box runs this probe. An
      ```
      (the `An` that ends the old second line stays at the end of the new text, ahead of `empty conf turns the radar on ...`). Then `That project is not measured, its \`enabled\` is removed, and the` becomes `That project is not measured, its \`enabled\` and \`lander\` are removed, and the` (the full anchor, because `its \`enabled\` is removed` also occurs in the pause paragraph); that phrase sits on a long unwrapped line, so it matches on one line.
    - `A paused project is not measured, and its \`enabled\` is removed, so a pause stops acceptance as well as measurement.` becomes ``A paused project is not measured, and its `enabled` and `lander` are removed, so a pause stops acceptance and the landing line's declaration as well as measurement.``
    - `` `ccrc uninstall` removes the units, the binary and every `enabled` file.`` becomes ``… and every `enabled` and `lander` file.``

- [ ] **Step 4: Run, and see it pass.**
  `cd server && ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/ccd-land-probe.test.ts test/ccrc-uninstall.test.ts`. Expected: every case is green, the 3b and 4 cases included, unchanged.

- [ ] **Step 5: The suites, each touched or bearing file whole.** From `server/`:
  - `ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/ccd-land-probe.test.ts test/ccd-land-probe-readonly.test.ts test/ccd-land-probe-doctor.test.ts test/ccd-land-lineage-accept.test.ts test/ccrc-uninstall.test.ts`. The readonly file's existing cases must stay green unchanged (only Task 3 adds a wording case and edits its header comment): R5b's import census, one Popen, the git and gh allowlists.
  - `ccrc test -- env GROWTH_CHECK=1 ./node_modules/.bin/vitest run --maxWorkers=2 test/growth-check.test.ts`. `ccd/ccrc` is a listed file, and it grows by about 2 net code lines, under `GROWTH_LIMIT` (40).
  - `ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/docs-parity.test.ts test/citations.test.ts test/anchors.test.ts test/single-definition`.
  - Hold the verdict fence: `git diff origin/main -- ccd/coordinator-skill/references/wave-lifecycle.md` is empty for this task.
  - Run every mutation in the table below, one at a time and sequentially. Restore each from a saved copy with its sha256 checked, never with `git checkout`, and record each red.

- [ ] **Step 6: Commit.** `git add ccd/ccd-land-probe ccd/ccrc README.md server/test/ccd-land-probe.test.ts server/test/ccrc-uninstall.test.ts`, then `git commit` with the message `feat(ccd): the radar learns lander=coordinator|none and mirrors it as $REG/landing/<project>/lander (landing order wave 5d)`, which ends with the attribution trailer.

**Mutation table (Task 1).**

| id | mutation | predicted red |
|---|---|---|
| 5D-KEY-01 | `parse_conf`'s key tuple goes back to `('base', 'lineage')` | K1: stderr holds `conf-invalid proj-a: unknown-key` and `readJson('lander')` throws. K2, K3, K4 and K6 are red at their first arm. It cannot stay green, because every conf naming `lander` is then invalid. |
| 5D-KEY-02 | the lander arm accepts any value (`elif value not in ('coordinator', 'none')` deleted) | K3: no `bad-value` in stderr for `Coordinator`. The marker is removed anyway (`!= 'coordinator'`), so the stderr assertion carries the red. |
| 5D-KEY-03 | the default dict's `'lander': 'none'` becomes `'lander': 'coordinator'` | K2's `''` and `lineage=on` iterations: `exists('lander')` is true after the run. The stated default is what reads the absent key. |
| 5D-KEY-04 | the `lander` row's `wanted` drops `and conf['lander'] == 'coordinator'` | K2's `lander=none` iteration: the marker stands. K6's paused, nocheckout and orphan files stay unaffected. |
| 5D-KEY-05 | `remove_own`'s guard goes back to `name == 'enabled'` (no `MIRRORS`) | K2, K3 and K4: the marker is never removed (`expected true to be false`). K6: all four planted files stand. The uninstall case stays green, because that removal is ccrc's own. |
| 5D-KEY-06 | the orphan loop removes only `enabled` (`for name in MIRRORS` becomes `('enabled',)`) | K6: `orphan/lander` and `proj-gone/lander` stand. Only the no-conf pass can remove them, so nothing else turns them green. |
| 5D-KEY-07 | the `lander` row's `wanted` gains `and conf['lineage'] == 'on'` | K1's first and last arms (`lineage` off): no marker. K6: `off.readJson('lander')` throws. |
| 5D-KEY-08 | `live` drops `not is_paused(ldir)` for the `lander` row only (`wanted` written as `conf is not None and is_checkout(project) and conf['lander'] == 'coordinator'`) | K6: `proj-a/lander` is rewritten, not removed (paused). |
| 5D-KEY-09 | the `lander` row drops `is_checkout(project)` | K6: `proj-nocheckout/lander` is written with the full doc instead of being removed. |
| 5D-KEY-10 | the repeat check becomes `if key in seen and key != 'lander'` | K4: stderr holds no `repeated-key`, the second value wins, and the marker stands. |
| 5D-KEY-11 | the `lander` doc drops `'lander': 'coordinator'` | K1: `Object.keys(doc)` is `['v','project','at']`, not `LANDER_KEYS`. |
| 5D-KEY-12 | the mutation computes the `lander` doc's time with its own `now_iso()` after a `time.sleep(1.1)`, instead of the shared `at` | K1: `lander.at === enabled.at` goes red, deterministically, because `now_iso()` has one-second resolution and the sleep crosses a second. |
| 5D-KEY-13 | `_uninst_cc_sessions`'s loop goes back to `"$ldir/enabled"` only | The uninstall case: `the lander mirror survived`. |
| 5D-KEY-14 | the uninstall loop drops `[ ! -L "$lfile" ]` | The uninstall case: `proj-b/lander` is no longer a symlink (`lstatSync` throws ENOENT). The 3b case's `proj-b/enabled` is red too. |
| 5D-KEY-15 | delete the `not real_dir(LANDING) or` half of `remove_own`'s directory check, or have the lander row call `os.unlink` directly | K7: `proj-a/lander` and `orphan/lander` in the symlink target are removed, so `readFileSync` throws ENOENT. The existing enabled symlink case goes red in the same run. |


### Task 2: the latest-attempt rule in the skill text (D-7546, amending the strict reading of D-7495)

Scope item 2. The operator ruled D-7546 on 2026-10-31: the latest attempt of each required check name decides, which is GitHub's own merge rule, and the every-attempt read (`check-runs?filter=all`) is a report line, never a stop. The verdict block already decides that way: read 5 (`checks()` in the §5b fence) asks `"repos/{owner}/{repo}/commits/$HC/check-runs"` with no `filter`, and GitHub's default, `latest`, lists only the newest run of each name (D-7546, `docs/superpowers/plans/2026-10-30-landing-order-wave5a-departures.md`; spec §5.7.1's read 5 row already says so). So this task is prose and pins only, and the fence stays byte-identical.

One sentence on `main` states the strict rule, and no other does (measured: `git grep -n -i -E 'later green|any completed run|latest attempt|filter=all|strict rule' origin/main -- ccd README.md` finds only `ccd/coordinator-skill/references/wave-lifecycle.md`'s stop paragraph): the stop paragraph's last-but-one sentence, `The one rerun the RED bullet allows does not clear a red that is main's own, and no close and reopen does either: the verdict calls a required name red while any completed run of it on the head failed, a later green run of it included (D-7495; judging only the newest run would loosen the gate, which is the operator's to decide), a rerun replays …`. This task:
- restates that sentence in place, dropping its strict clause and keeping its two facts, with the reason that still holds under the new rule (a rerun replays its run's original merge commit, which still carries `main`'s red);
- adds one paragraph after the stop paragraph, ending §5b, **The latest attempt decides**: the rule, why it is what read 5 lists, what it makes of the RED bullet's one rerun, and the every-attempt read as a line the coordinator names in its turn's text, never a stop.

**What the coordinator does with an earlier failed attempt now:** before each enqueue, direct merge and re-enqueue it reads `gh api --paginate 'repos/{owner}/{repo}/commits/<handoffCommit>/check-runs?filter=all'` and names in its turn's text, apart from the verdict's line, each required name that failed on any attempt (or none). That line decides nothing and is never a stop; a failed read of it is named as unread and is no stop either. The verdict's line alone decides.

**Files:**
- Modify: `ccd/coordinator-skill/references/wave-lifecycle.md`, §5b prose only: the stop paragraph's tail (from the line that begins `operator. The one rerun the RED bullet allows` to the end of the paragraph), and one new paragraph after it, before `## 6 — Final merge`. Nothing between the §5b fence markers changes.
- Test: `server/test/coordinator-skill.test.ts` (the stop pin in the §5b describe; the 5a arm case; a new `landing order wave 5d` describe at the end of the file).
- Run, not modified: `server/test/coordinator-landing-verdict.test.ts`.
- Mutation only, claimed for row 5D-RULE-04: the same `wave-lifecycle.md`'s verdict fence, read 5's URL. It is measured, restored from a saved copy with its sha256 checked, and never shipped.
- Not modified (measured, nothing to restate: `git grep -i -E "later green|any completed run|latest attempt|filter=all|strict rule|loosen the gate|rerun"` over `ccd/coordinator-skill/SKILL.md`, `ccd/worker-skill`, `ccd/reviewer-skill` and `README.md` finds nothing): `ccd/coordinator-skill/SKILL.md`, `ccd/worker-skill/SKILL.md`, `ccd/reviewer-skill/SKILL.md`, `README.md`, the spec.

**Interfaces:**
- No new helper and no new export. The new describe reuses this file's `refs`, `flat` and `allSkillText`, and slices §5b exactly as the 5a and 5b describes do:
  ```ts
  const wl = refs('wave-lifecycle.md');
  const at = wl.indexOf('### 5b — The landing route, from the repository\'s own rules');
  const sec = at >= 0 ? wl.slice(at, wl.indexOf('\n## ', at)) : '';
  const fence = /```bash\n([\s\S]*?)```/;
  const block = fence.exec(sec)?.[1] ?? '';
  const prose = flat(sec.replace(fence, ''));
  ```
- The 5a case `the strict rule the stop paragraph states is the block's own arm (D-7495)` is renamed `the red arm is the block's own, over the latest attempt read 5 lists (D-7495, D-7546)`; it keeps its assertion and gains two.
- The stop pin (`pins the whole stop paragraph, to the end of §5b: what a stop does and the reasons it names (the stop pin)`) keeps its name and its slice (`prose.slice(from).trim()`), which now also holds the new paragraph: its fifteenth string changes and five strings are appended.
- The fence hash is measured, not pinned by a test: `sed -n '/^### 5b — /,/^## 6 — /p' ccd/coordinator-skill/references/wave-lifecycle.md | awk '/^```bash$/{f=1;next} f&&/^```$/{exit} f' | sha256sum` prints `dec52b5aaf9d6166853a25a18db29d2203a38fd6ace044f7c7068e43c4eef3a7` over 254 lines (measured on `origin/main` 4fc83e57b).

- [ ] **Step 1: The failing pins.** In `server/test/coordinator-skill.test.ts`:
  1. **The stop pin.** Replace its fifteenth string (the one beginning `The one rerun the RED bullet allows`, between `Send the new-head round only when` and `Where you take the route`) (the D-7495 sentence) with the first string below, keep `'Where you take the route, say so in your turn\'s text with the reads that showed it.'`, and append the last five, in this order, at the end of `whole`:
     ```ts
     'The one rerun the RED bullet allows does not clear a red that is `main`\'s own, and no close and reopen does either: a rerun replays its run\'s original merge commit, which still carries `main`\'s red, and a close and reopen of the PR can race GitHub\'s recompute of the merge ref.',
     'Where you take the route, say so in your turn\'s text with the reads that showed it.',
     '**The latest attempt decides** (D-7546, which amends the strict reading of D-7495).',
     'The verdict judges the latest attempt of each required name, which is GitHub\'s own merge rule and all read 5 lists: `commits/<sha>/check-runs` with no `filter` answers only the newest run of each name, so a name that failed and then passed on a rerun of the same head reads passing.',
     'So a red that the one rerun the RED bullet allows turns green is cleared. A red that no rerun reaches, or one still red after that rerun, stays the stop `red-unreachable`.',
     'Before each enqueue, direct merge and re-enqueue, read every attempt as well, with `gh api --paginate \'repos/{owner}/{repo}/commits/<handoffCommit>/check-runs?filter=all\'`, and name in your turn\'s text, apart from the verdict\'s line, each check name of which any completed run concluded other than success, neutral or skipped, or none.',
     'That line is a report: it is never a stop and decides nothing, and a read of it that fails is named as unread and is no stop either.',
     ```
  2. **The 5a arm case**, renamed `the red arm is the block's own, over the latest attempt read 5 lists (D-7495, D-7546)`. It keeps its `toContain` of the `elif any($r[]; .status == "completed" …` arm and adds:
     ```ts
     expect(block, 'read 5 no longer reads the head\'s check runs').toContain('"repos/{owner}/{repo}/commits/$HC/check-runs"');
     expect(block, 'read 5 now reads every attempt: the prose\'s latest-attempt rule is false').not.toContain('filter=');
     ```
  3. **A new describe at the end of the file**, `landing order wave 5d: the latest attempt decides (D-7546)`, with the slice above and these cases:
     ```ts
     it('states the latest-attempt rule, and keeps the every-attempt read a report line in the turn text, never a stop (D-7546)', () => {
       expect(prose).toContain('**The latest attempt decides** (D-7546, which amends the strict reading of D-7495).');
       expect(prose).toContain('The verdict judges the latest attempt of each required name, which is GitHub\'s own merge rule and all read 5 lists');
       expect(prose).toContain('`commits/<sha>/check-runs` with no `filter` answers only the newest run of each name');
       expect(prose).toContain('So a red that the one rerun the RED bullet allows turns green is cleared. A red that no rerun reaches, or one still red after that rerun, stays the stop `red-unreachable`.');
       expect(prose).toContain('`gh api --paginate \'repos/{owner}/{repo}/commits/<handoffCommit>/check-runs?filter=all\'`');
       expect(prose).toContain('and name in your turn\'s text, apart from the verdict\'s line, each check name of which any completed run concluded other than success, neutral or skipped, or none.');
       expect(prose).toContain('That line is a report: it is never a stop and decides nothing, and a read of it that fails is named as unread and is no stop either.');
       expect(prose, 'the any-attempt rule is back (D-7495)').not.toContain('while any completed run of it on the head failed');
       expect(prose, 'the any-attempt rule is back (D-7495)').not.toContain('a later green run of it included');
       expect(prose, 'the any-attempt rule is back (D-7495)').not.toContain('judging only the newest run would loosen the gate');
     });

     it('a rerun still does not clear a red that is main\'s own, for the reason that holds under the latest attempt', () => {
       expect(prose).toContain('The one rerun the RED bullet allows does not clear a red that is `main`\'s own, and no close and reopen does either: a rerun replays its run\'s original merge commit, which still carries `main`\'s red,');
     });

     it('the latest-attempt paragraph follows the stop paragraph and ends §5b', () => {
       const stop = prose.indexOf('**A stop.**');
       const rule = prose.indexOf('**The latest attempt decides**');
       expect(stop, '§5b lost its stop paragraph').toBeGreaterThanOrEqual(0);
       expect(rule, 'the latest-attempt paragraph sits before the stop paragraph').toBeGreaterThan(stop);
       expect(prose.trim().endsWith('and is no stop either.'), 'something follows the latest-attempt paragraph in §5b').toBe(true);
     });

     it('wraps §5b from the stop paragraph to its end at 80 columns', () => {
       const from = wl.indexOf('**A stop.**');
       const to = wl.indexOf('\n## 6 — ', from);
       expect(from).toBeGreaterThanOrEqual(0);
       expect(to).toBeGreaterThan(from);
       for (const l of wl.slice(from, to).split('\n')) expect(l.length, `a line past the file's width: ${l}`).toBeLessThanOrEqual(80);
     });

     it('no 5d sentence holds a double quote', () => {
       const flatAll = flat(allSkillText);
       for (const s of [
         '**The latest attempt decides**', 'The verdict judges the latest attempt', 'So a red that the one rerun',
         'Before each enqueue, direct merge and re-enqueue, read every attempt', 'That line is a report',
       ]) {
         const from = flatAll.indexOf(s);
         expect(from, s).toBeGreaterThanOrEqual(0);
         const sentence = flatAll.slice(from, flatAll.indexOf('. ', from));
         expect(sentence, `a double quote in the sentence beginning ${s}`).not.toContain('"');
       }
     });
     ```
  - Run: `cd server && ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/coordinator-skill.test.ts`.
    - **Expected red:** the stop pin (`toBe`: the fifteenth string differs and five are missing); the D-7546 case (its first `toContain`, and `not.toContain('while any completed run of it on the head failed')`); the rerun-reason case; the order case (`rule` is -1); the 5d quote census (its presence assertion for `**The latest attempt decides**`).
    - **Expected green:** the renamed arm case (it pins today's block; its red is 5D-RULE-04), and the wrap case (today's stop paragraph is at most 80 columns on every line).

- [ ] **Step 2: Write the text.** In `ccd/coordinator-skill/references/wave-lifecycle.md`, keep every line of the stop paragraph through `exit 1 (a conflict) or any other answer leaves the stop standing for the`. Replace the paragraph's last seven lines (from `operator. The one rerun the RED bullet allows does not clear a red that is` to `you take the route, say so in your turn's text with the reads that showed it.`) with the first block below, then a blank line, then the second block, then the existing blank line and `## 6 — Final merge`. Verbatim, wrapped at 80 columns, no double quote:
  ```markdown
  operator. The one rerun the RED bullet allows does not clear a red that is
  `main`'s own, and no close and reopen does either: a rerun replays its run's
  original merge commit, which still carries `main`'s red, and a close and reopen
  of the PR can race GitHub's recompute of the merge ref. Where you take the
  route, say so in your turn's text with the reads that showed it.
  ```
  ```markdown
  **The latest attempt decides** (D-7546, which amends the strict reading of
  D-7495). The verdict judges the latest attempt of each required name, which is
  GitHub's own merge rule and all read 5 lists: `commits/<sha>/check-runs` with no
  `filter` answers only the newest run of each name, so a name that failed and
  then passed on a rerun of the same head reads passing. So a red that the one
  rerun the RED bullet allows turns green is cleared. A red that no rerun reaches,
  or one still red after that rerun, stays the stop `red-unreachable`. Before each
  enqueue, direct merge and re-enqueue, read every attempt as well, with `gh api
  --paginate
  'repos/{owner}/{repo}/commits/<handoffCommit>/check-runs?filter=all'`, and name
  in your turn's text, apart from the verdict's line, each check name of which any
  completed run concluded other than success, neutral or skipped, or none. That
  line is a report: it is never a stop and decides nothing, and a read of it that
  fails is named as unread and is no stop either.
  ```
  Nothing else changes: not the fence, not the RED bullet (its one-rerun rule is already true under the new rule, and the list pin holds it), not the new-head route's other sentences, not SKILL.md.

- [ ] **Step 3: Run it green, and measure the fence.**
  - `cd server && ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/coordinator-skill.test.ts` — expected: green, the 5a census (`The one rerun the RED bullet allows`) and the 5b and 5e censuses included.
  - `cd server && ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/coordinator-landing-verdict.test.ts` — expected: green with no change (its D-7495 row feeds the arm two runs of one name and still prints `RED`, which is the arm, not what read 5 receives).
  - From the worktree root: `sed -n '/^### 5b — /,/^## 6 — /p' ccd/coordinator-skill/references/wave-lifecycle.md | awk '/^```bash$/{f=1;next} f&&/^```$/{exit} f' | sha256sum` prints `dec52b5aaf9d6166853a25a18db29d2203a38fd6ace044f7c7068e43c4eef3a7`, and `... | wc -l` prints `254`. `git diff origin/main -- ccd/coordinator-skill/references/wave-lifecycle.md` touches no line between the fence markers.
  - `awk 'length > 80' ccd/coordinator-skill/references/wave-lifecycle.md` lists no line this task wrote.

- [ ] **Step 4: The suites.** Each file whole, in the foreground, timeout at least 600000 ms, one command per line:
  - `cd server && ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/coordinator-skill.test.ts test/coordinator-landing-verdict.test.ts test/install-coordinator-skill.test.ts test/expiry-lane-prose.test.ts test/worker-skill.test.ts test/reviewer-skill.test.ts` (`expiry-lane-prose` reads `wave-lifecycle.md` whole through `flat('ccd/coordinator-skill/references/wave-lifecycle.md')`; the worker and reviewer skill suites point at that file)
  - `cd server && ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/session-hook-merge-deny.test.ts` (it reads only the native-queue paragraph's `gh` spans and the verdict block, neither of which this task touches; run it as a cheap guard, not as the one that fires; a `session-hook*` suite is a known load flake: re-run it alone before calling it a break)
  - `cd server && ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/citations.test.ts test/anchors.test.ts test/docs-parity.test.ts`
  - `cd server && ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/single-definition/`
  - `git fetch origin main` is NOT run by this task's executor if the brief forbids it; otherwise `cd server && ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/deviation-refs.test.ts` (the text cites D-7546 and D-7495, both defined; it defines no number).
  - growth-check does not apply: neither touched file is in its list (`server/test/growth-check.test.ts`: `ccd/ccd`, `ccd/ccrc`, `ccd/session-hook.sh`, `watch.ts`, `store.ts`, `routes.ts`, `server.ts`, `sessionws.ts`, `pwa/src/lib/api.ts`).
  - Expected: green. `carries all nineteen clauses verbatim` stays green: no clause changes.

- [ ] **Step 5: Mutations.** Run the rows below sequentially, one per run, through `ccrc test -- … --maxWorkers=2`, restoring each mutated file from a saved copy with its sha256 checked (never `git checkout`), each log kept under `.superpowers/sdd/`.

| id | Mutation | Predicted red |
|---|---|---|
| 5D-RULE-01 | in the stop paragraph, put the strict clause back: `… and no close and reopen does either: the verdict calls a required name red while any completed run of it on the head failed, a later green run of it included (D-7495; judging only the newest run would loosen the gate, which is the operator's to decide), a rerun replays …` | **The D-7546 case**: its three `not.toContain` fail (the three strict phrases are back). The stop pin (`toBe`) and the rerun-reason case (`a rerun replays its run's original merge commit, which still carries` no longer follows `does either: `) are red too. It cannot stay green: the case's `not.toContain` reads the whole flattened prose of §5b. |
| 5D-RULE-02 | drop the sentence `That line is a report: it is never a stop and decides nothing, and a read of it that fails is named as unread and is no stop either.` | **The D-7546 case** (its seventh `toContain`), the order case (`endsWith('and is no stop either.')` is false), the stop pin, and the 5d census's presence assertion for `That line is a report`. |
| 5D-RULE-03 | `it is never a stop and decides nothing` becomes `it is the stop red-unreachable` | **The D-7546 case** (its seventh `toContain`), and the stop pin. The sentence still exists, so only the exact words go red. |
| 5D-RULE-04 | (block mutant) read 5's URL becomes `"repos/{owner}/{repo}/commits/$HC/check-runs?filter=all"` | **The renamed arm case**: its new `toContain('"repos/{owner}/{repo}/commits/$HC/check-runs"')` fails (the closing quote no longer follows `check-runs`) and its `not.toContain('filter=')` fails. **`coordinator-landing-verdict.test.ts`** is red too: its `gh` stub matches only `*/check-runs`, so every read-5 case answers unreadable. Run both files, record both, restore the fence from the saved copy, and re-measure the hash. |
| 5D-RULE-05 | drop `, which still carries \`main\`'s red` from the stop paragraph's rerun sentence | **The rerun-reason case** (`toContain`), and the stop pin. |
| 5D-RULE-06 | move the whole **The latest attempt decides** paragraph to just before `**A stop.**` | **The order case** (`rule > stop` fails) and **the 5e line pin** (`prose.slice(from, to)` between the landing-line paragraph and the stop paragraph now holds the moved paragraph). The stop pin is red too (its slice no longer holds the five appended strings at its end). |
| 5D-RULE-07 | join the new paragraph's lines `and re-enqueue, read every attempt as well, with \`gh api --paginate` and the next into one line | **The wrap case only**: that line is past 80 columns. Every `flat` pin stays green, because flattening erases the line break. |
| 5D-RULE-08 | write `(D-7546, which amends the "strict" reading of D-7495)` | **The 5d quote census**, which names the sentence beginning `**The latest attempt decides**`. The D-7546 case's first `toContain` and the stop pin are red too, but the census names the quote. |
| 5D-RULE-09 | drop the two sentences `So a red that the one rerun the RED bullet allows turns green is cleared. A red that no rerun reaches, or one still red after that rerun, stays the stop \`red-unreachable\`.` | **The D-7546 case** (its fourth `toContain`), the stop pin, and the 5d census's presence assertion for `So a red that the one rerun`. |
| 5D-RULE-10 | `name in your turn's text, apart from the verdict's line,` becomes `stop the landing on` | **The D-7546 case** (its sixth `toContain`), and the stop pin. |

- [ ] **Step 6: Commit.**
  ```
  docs(skills): the latest attempt of each required name decides; every attempt is a report line in the turn text, never a stop (D-7546) (landing order wave 5d)
  ```


### Task 3: the radar's carried wording and pins, and the project rotation (scope items 3 and 4)

Ledger, Carried constraints: "From wave 3b's reviews (1140, 1143, 1158 and 1171)", its "Wording and pins left by review 1171" list, and "A project the tick budget leaves unstarted" (review 1125 N6, D-7268). Every cited text below was read on `origin/main` at `4fc83e57b`. The notes file is `docs/superpowers/plans/2026-10-27-landing-order-wave3b-conflict-radar/wave3b-notes.md`.

**Files:**
- Modify: `ccd/ccd-land-probe`: `project_rows`' docstring, `qualifying`'s docstring, the header's step 4, a new `tick_order` beside `handle_project`, and `main`'s measuring loop.
- Modify: `README.md`, section "Conflict radar (ccd-land-probe)": the held-row parenthesis, the `fetch-failed` sentence, and one new paragraph, **The order.**
- Modify: `ccd/ccrc-doctor-checks`, the `land-probe` header's "AN INTERRUPTED TICK READS AS A RUNNING ONE" paragraph (the no-checkpoint sentence only).
- Modify: `docs/superpowers/plans/2026-10-27-landing-order-wave3b-conflict-radar/wave3b-notes.md`: the "undecided rows (fix round 3)" table row, and the no-checkpoint sentence in "Accepted by ruling (review 1140)", F2.
- Modify: `server/test/ccd-land-probe-readonly.test.ts`: the header comment's "a call's keyword", and one new wording case in `describe('ccd-land-probe: the literal source pins')`.
- Test: `server/test/ccd-land-probe.test.ts`: one new case in the describe `ccd-land-probe: a registry the probe cannot read decides no row (fix round 4, …)`, and a new describe for N6.
- Not modified: `docs/superpowers/programs/landing-order.md`. The coordinator moves the carried entries when it records the merge.

**Interfaces:**
- New in `ccd/ccd-land-probe`, placed beside `handle_project`:
  ```python
  def tick_order(projects):   # list[str] -> list[str]
      def last(p):
          if not (real_dir(LANDING) and real_dir(LANDING + '/' + p)):
              return -1
          try:
              st = os.lstat(LANDING + '/' + p + '/probe')
          except OSError:
              return -1
          return st.st_mtime_ns if stat.S_ISREG(st.st_mode) else -1
      return sorted(projects, key=lambda p: (last(p), p))
  ```
  The order is least recently measured first. The key is the mtime of the project's own `probe`, read with `lstat` once `real_dir` has passed for both directories, with nothing followed and nothing opened. A project with no regular `probe` file has the key `-1`, so it goes first. Ties go by name.
  - `main` changes `for project in projects:` to `for project in tick_order(projects):`.
  - `reconcile_enabled(projects)` keeps the sorted list, so the pre-pass does not change.
  - Nothing new is imported (`os` and `stat` are already in the census's pinned list), and no file, knob, git call or gh call is added.
- The two `lineage-skip` lines this task pins apart are `project_rows`' `'lineage-skip: a registry row could not be read'` and `'lineage-skip: a registry row names no well-formed branch'`. The third, `qualifying`'s `'… names a branch the git door refuses'`, is not one of the two.
- `tick_order` does not touch Task 1's `lander` key, marker or `remove_own` change. Task 1 edits the header's PATHS list and `reconcile_enabled`, and this task edits step 4 and `main`, so the two tasks touch no shared line.

**The N6 decision: yes, ordered by the last measurement, not by the clock (D-7642, `lru-order-not-clock-rotation`).**
- **Read-only.** The order takes one `lstat` of a file the probe itself writes, with no open and no follow, and no git or gh call.
- **Deterministic under test.** A test sets the file's mtime with `fs.utimesSync`. On a fresh HOME every key is `-1`, so the order is by name, exactly as today, and every existing multi-project case keeps its order.
- **No new shape.** It adds no file, marker, knob or git form.
- **It closes the starvation.** A project the tick budget left unstarted keeps the oldest `probe`, so the next tick starts with it.
- **Today's two-project case stays green.** In `the tick budget leaves an unreached project's files as they were`, `proj-a`'s `probe` is written before `proj-b`'s on tick 1, so tick 2 again starts with `proj-a`.

#### Step 1: the failing tests

- [ ] **1a. Pin the two skip lines apart.** Add this case to the describe `ccd-land-probe: a registry the probe cannot read decides no row (fix round 4, review 1143 F5, F6; fix round 5, review 1158 F2, F5)`. It uses that describe's `seeded`, `unchanged`, `said`, `lines`, `ALPHA`, `BETA` and `MALFORMED`. It needs no uid guard, because the unreadable `.branch` is a two-line file, as in F6-b.
  ```ts
  it('1171-a the two lineage-skip lines stay apart: an unreadable row and two malformed rows (one a git-valid name the grammar does not hold, ws/gamma+b) log one line each, every held file byte-identical', { timeout: 120_000 }, () => {
    const GAMMA = 'lane-a-proj-a-gamma';
    const old = seeded([ALPHA, BETA, GAMMA]);
    fs.writeFileSync(path.join(fx.reg, `${ALPHA}.branch`), 'ws/alpha\nws/other\n');   // unreadable (two lines)
    fs.writeFileSync(path.join(fx.reg, `${BETA}.branch`), 'ws/beta~0\n');             // malformed: a revision expression
    fs.writeFileSync(path.join(fx.reg, `${GAMMA}.branch`), 'ws/gamma+b\n');           // malformed by the grammar, valid to git
    const m = fx.run();
    expect(m.status).toBe(0);
    expect(fx.readJson('probe').state).toBe('measured');
    unchanged(old, 'measured tick');
    const skip = (t: string): string[] => lines(m.stderr).filter((l) => l === `land-probe: lineage-skip: ${t}`);
    expect(skip('a registry row could not be read'), 'the unreadable line, once').toHaveLength(1);
    expect(skip(MALFORMED), 'the malformed line, once for two rows').toHaveLength(1);
    expect(lines(m.stderr).filter((l) => l.startsWith('land-probe: lineage-skip: ')), 'exactly the two lines').toHaveLength(2);
    said(m.stderr, MALFORMED, [ALPHA, BETA, GAMMA], 'measured tick');
  });
  ```
  This case is green on `main`: it pins behaviour that already exists. Its red is shown by mutations 5D-CARRIED-01 to 5D-CARRIED-03.

- [ ] **1b. The N6 order.** Add a new describe at the end of `server/test/ccd-land-probe.test.ts`.
  ```ts
  describe('ccd-land-probe: the tick measures the least recently measured project first (review 1125 N6, D-7268)', () => {
    const order = (stderr: string): string[] =>
      [...stderr.matchAll(/^land-probe: unmeasured (proj-[ab]) main-health /gm)].map((x) => x[1]);

    it('N6-a an older probe goes first whatever the names, and a project with no probe goes before both', { timeout: 120_000 }, () => {
      const b = makeLandFixture(h, { project: 'proj-b', slug: 'o/r2' });
      fx.addHead(1, { 'a.txt': 'a\n' });
      b.addHead(1, { 'b.txt': 'b\n' });
      fx.conf('proj-a', '');
      fx.conf('proj-b', '');
      const t1 = fx.run();
      expect(t1.status).toBe(0);
      expect(order(t1.stderr), 'tick 1: neither has a probe, so by name').toEqual(['proj-a', 'proj-b']);
      const past = new Date(Date.now() - 3_600_000);
      fs.utimesSync(path.join(b.landDir, 'probe'), past, past);
      const t2 = fx.run();
      expect(t2.status).toBe(0);
      expect(order(t2.stderr), 'tick 2: proj-b\'s probe is older').toEqual(['proj-b', 'proj-a']);
      fs.rmSync(path.join(fx.landDir, 'probe'));
      const t3 = fx.run();
      expect(t3.status).toBe(0);
      expect(order(t3.stderr), 'tick 3: proj-a has no probe').toEqual(['proj-a', 'proj-b']);
    });

    it('N6-b a project the tick budget left unstarted is measured first on the next tick', { timeout: 180_000 }, () => {
      const b = makeLandFixture(h, { project: 'proj-b', slug: 'o/r2' });
      for (let n = 1; n <= 6; n++) fx.addHead(n, { [`f${n}.txt`]: 'x\n' });
      b.addHead(1, { 'b.txt': 'b\n' });
      fx.conf('proj-a', '');
      fx.conf('proj-b', '');
      expect(fx.run().status).toBe(0);
      fx.wrapGit('case " $* " in *" merge-tree "*) sleep 6;; esac');
      const t2 = fx.run({ CCD_LAND_PROBE_TICK_BUDGET: '30' });
      expect(t2.status).toBe(0);
      expect(t2.stderr, 'tick 2 left proj-b unstarted').toContain('land-probe: tick-budget: proj-b not started');
      const before = fs.statSync(path.join(b.landDir, 'probe'));
      const t3 = fx.run({ CCD_LAND_PROBE_TICK_BUDGET: '30' });
      expect(t3.status).toBe(0);
      expect(t3.stderr, 'tick 3 starts with proj-b').not.toContain('land-probe: tick-budget: proj-b not started');
      expect(fs.statSync(path.join(b.landDir, 'probe')).mtimeMs, 'proj-b\'s probe was rewritten').toBeGreaterThan(before.mtimeMs);
    });
  });
  ```
  - The `unmeasured <p> main-health gh-failed` line is each project's own, since no REST answer is stubbed (the first radar case reads `main-health` `gh-failed`). That is how the order is read without any timing.
  - On `main` both cases are red. N6-a's tick 2 reads `['proj-a', 'proj-b']`. N6-b's tick 3 again says `tick-budget: proj-b not started`.

- [ ] **1c. The review 1171 wording.** Add this case to `describe('ccd-land-probe: the literal source pins')` in `server/test/ccd-land-probe-readonly.test.ts`. It uses the file's existing `src` and `PROBE`.
  ```ts
  it("review 1171's wording says what the code does: the held grammar, the tip-null routes, the fallback's fetch-failed, the no-checkpoint cases", () => {
    const ROOT = path.resolve(path.dirname(PROBE), '..');
    const flat = (s: string): string => s.replace(/\n[ \t]*(?:#[ \t]?)?[ \t]*/g, ' ').replace(/ {2,}/g, ' ');
    const probe = flat(src);
    expect(probe).toContain('and also a name git allows that the grammar does not hold, such as `ws/a+b`');
    expect(probe).not.toContain('corrupt registry content, a shape git forbids in a ref name)');
    expect(probe).toContain('With an old file it is rewritten unmeasured with tip null on every route that has no measured base: a failed or timed-out fetch');
    expect(probe).toContain('one the project budget cut, a slug that is None, and the before-first-write fallback.');
    expect(probe).not.toContain('on a failed fetch, and in the before-first-write fallback, it is rewritten unmeasured with tip null');
    expect(probe).toContain('4. For each conf, least recently measured first (tick_order');
    const readme = flat(fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8'));
    expect(readme).toContain('or a name git allows but the probe\'s narrower grammar does not, such as `ws/a+b`');
    expect(readme).not.toContain('a scratch, alternates or refspec failure before the first write');
    expect(readme).toContain('a failure to write the scratch\'s alternates file is the failed fetch\'s own `fetch-failed`');
    expect(readme).toContain('**The order.** Each tick measures the projects least recently measured first');
    const doctor = flat(fs.readFileSync(path.join(ROOT, 'ccd', 'ccrc-doctor-checks'), 'utf8'));
    expect(doctor).toContain('when every open PR is cross-repository (the probe drops those heads), when the PR list failed, or when the project budget is already spent');
    expect(doctor).not.toContain('zero open PRs, or the PR list failed');
  });
  ```

#### Step 2: the run, and the expected failure

- [ ] `cd server && ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/ccd-land-probe.test.ts test/ccd-land-probe-readonly.test.ts -t "1171-a|N6-|review 1171's wording"`. Expected:
  - 1171-a passes, because it is a pin of existing behaviour.
  - N6-a fails at `tick 2: proj-b's probe is older` (it receives `['proj-a', 'proj-b']`).
  - N6-b fails at `tick 3 starts with proj-b`.
  - The wording case fails at its first `toContain`.

#### Step 3: the implementation

- [ ] **3a. `tick_order`.** Add it as in the Interfaces block, with this docstring: `"""The measuring loop's order (review 1125 N6, D-7268): least recently measured first, by the mtime of each project's own probe (both directories lstat-checked, the file itself lstat'd, nothing followed or opened; only the order depends on it, and ensure_dir still checks both directories before any write); a project with no regular probe comes first; ties by name. Read-only, and no file of its own: a project the tick budget left unstarted keeps the oldest probe, so the next tick starts with it. The mirror pre-pass (reconcile_enabled) keeps the sorted order."""`. Then set `main`'s loop to `for project in tick_order(projects):`.
- [ ] **3b. Step 4 of the header.** `#   4. For each conf, sorted, while the tick budget lasts:` becomes `#   4. For each conf, least recently measured first (tick_order: by its probe file's mtime, a project with none first, ties by name; review 1125 N6), while the tick budget lasts:`. Rewrap that numbered item at 120 columns, keeping its `#      ` continuation indent.
- [ ] **3c. `project_rows`' docstring.** Replace `(review 1158 F2, F6: a NUL byte, `ws/a~0`, `ws/a.lock`; corrupt registry content, a shape git forbids in a ref name)` with `(review 1158 F2, F6: a NUL byte, `ws/a~0`, `ws/a.lock`, corrupt registry content in a shape git forbids in a ref name; and also a name git allows that the grammar does not hold, such as `ws/a+b`, review 1171)`. Rewrap the docstring at 120 columns. The old text is hard-wrapped on `main`; match it across the line break (with its continuation indent or `# ` prefix), then rewrap.
- [ ] **3d. `qualifying`'s docstring.** Replace `An undecided row's previous file stays on a measured base; on a failed fetch, and in the before-first-write fallback, it is rewritten unmeasured with tip null.` with `An undecided row's previous file stays on a measured base. With an old file it is rewritten unmeasured with tip null on every route that has no measured base: a failed or timed-out fetch (a failure at the scratch's init, its alternates file, the URL's ls-remote, the fetch or the fetched base's rev-parse), one the project budget cut, a slug that is None, and the before-first-write fallback.` Rewrap at 120 columns. The old text is hard-wrapped on `main`; match it across the line break (with its continuation indent or `# ` prefix), then rewrap. Leave the words `(decided, logged once)` as they are: they are the git-setting bullet's item, which is not in this scope.
- [ ] **3e. README, the held-row parenthesis.** Replace `(corrupt registry content, such as a NUL byte, `ws/a~0` or `ws/a.lock`)` with `(corrupt registry content, such as a NUL byte, `ws/a~0` or `ws/a.lock`, or a name git allows but the probe's narrower grammar does not, such as `ws/a+b`)`.
- [ ] **3f. README, the `fetch-failed` sentence.** Replace `` `fetch-failed` also covers a scratch, alternates or refspec failure before the first write, since the probe's set has no closer word. `` with `` `fetch-failed` also covers an error before the first write (a scratch that cannot be made, or a refspec the git door refuses), since the probe's set has no closer word; a failure to write the scratch's alternates file is the failed fetch's own `fetch-failed`. `` The old text is hard-wrapped on `main`; match it across the line break (with its continuation indent or `# ` prefix), then rewrap.
- [ ] **3g. README, the order.** Insert this paragraph before the paragraph that begins "The two mirrors, `enabled` and `lander`, are reconciled in one pass" (Task 1's text): `**The order.** Each tick measures the projects least recently measured first: it orders them by the modification time of each one's `probe`, a project with none first and ties by name. So a project the tick budget left unstarted (the journal's `tick-budget: <project> not started`) is the first one measured on the next tick.` Rewrap every touched README paragraph at the section's width.
- [ ] **3h. The doctor header** (`ccd/ccrc-doctor-checks`, the `land-probe` header). Replace `when there are zero open PRs, or the PR list failed, no checkpoint runs between the base rev-parse and that write` with `when there are zero open PRs, when every open PR is cross-repository (the probe drops those heads), when the PR list failed, or when the project budget is already spent (each merge-tree then answers budget without starting a child), no checkpoint runs between the base rev-parse and that write`. Rewrap with the header's `# ` prefix. The old text is hard-wrapped on `main`; match it across the line break (with its continuation indent or `# ` prefix), then rewrap.
- [ ] **3i. The notes.**
  - In the F2 paragraph, make the same replacement as 3h (the notes' sentence has the same words), using backticks for `merge-tree` and `budget`, and rewrap at 120 columns.
  - In the "undecided rows (fix round 3)" table row, replace `An undecided row keeps its old file on a measured base, and on a failed fetch or in the before-first-write fallback it is rewritten unmeasured with `tip: null`; it is never pruned` with `An undecided row keeps its old file on a measured base. With an old file it is rewritten unmeasured with `tip: null` on every route with no measured base: a failed or timed-out fetch (at the scratch's `init`, its alternates file, the URL's `ls-remote --get-url`, the fetch or the fetched base's `rev-parse`), a fetch the project budget cut, a slug that is None (`repo-unreadable`), and the before-first-write fallback; it is never pruned (review 1171)`. The row stays one line.
- [ ] **3j. The census header** (`server/test/ccd-land-probe-readonly.test.ts`). Replace `a global or nonlocal, a call's keyword, an attribute` with `a global or nonlocal, a keyword (an `ast.keyword`: a call's, or a class statement's), an attribute`, and rewrap that comment at 120 columns. The census arm `isinstance(n, ast.keyword) and n.arg == TABLE` counts both.

#### Step 4: the run, and the pass

- [ ] Run the Step 2 command again. All four cases pass.

#### Step 5: the suites

- [ ] `cd server && ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/ccd-land-probe.test.ts test/ccd-land-probe-readonly.test.ts test/ccd-land-probe-doctor.test.ts test/ccd-land-lineage-accept.test.ts test/ccrc-doctor-core.test.ts test/doctor-cadence.test.ts test/ccd-harness-integrity.test.ts`. Run it in the foreground with a timeout of at least 600000 ms. Every case is green, including `the tick budget leaves an unreached project's files as they were` and every two-project case, unchanged.
- [ ] `cd server && ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/docs-parity.test.ts test/citations.test.ts test/anchors.test.ts test/macos-platform.test.ts test/single-definition/`. `macos-platform` scans the probe for GNU spellings. `docs-parity` covers the README and doctor edits.
- [ ] Growth-check does not apply. `ccd/ccd-land-probe`, `ccd/ccrc-doctor-checks` and `README.md` are not in `GROWTH_FILES` (`server/test/growth-check.test.ts`).
- [ ] The §5b fence of `wave-lifecycle.md` is not touched by this task.

#### Step 6: the commit

- [ ] Commit on the workspace branch: `fix(ccd-land-probe): least recently measured project first (N6); review 1171's wording and the skip-line pin (landing order wave 5d)`, ending with the attribution line.

#### Mutation table

Run each row sequentially. Restore from a saved copy with its sha256 checked, never with `git checkout`. Keep each row's log under `.superpowers/sdd/`.

| id | Mutation | Predicted red |
|---|---|---|
| 5D-CARRIED-01 | In `project_rows`, `    if malformed:` becomes `    elif malformed:` | **1171-a**: `the malformed line, once for two rows` gets 0 lines. Every older case has only one held kind, so it stays green: only this case sees both kinds at once. |
| 5D-CARRIED-02 | Move `log('lineage-skip: a registry row names no well-formed branch')` from after the loop to just after `malformed = True` inside it | **1171-a**: two malformed rows (BETA, GAMMA) give 2 lines where `toHaveLength(1)` is pinned, and the total is 3, not 2. |
| 5D-CARRIED-03 | `WS_NAME_RE`'s two character classes `[A-Za-z0-9._-]` become `[A-Za-z0-9._+-]` | **1171-a**: `ws/gamma+b` is no longer held. The repository has no such branch, so `rev-parse` answers rc 1 and GAMMA's old file is pruned. `unchanged` fails on `lane-a-proj-a-gamma.lineage is still there`. |
| 5D-CARRIED-04 | `main`'s loop goes back to `for project in projects:` | **N6-a**, tick 2: `['proj-a', 'proj-b']`. **N6-b**, tick 3: `tick-budget: proj-b not started` again. The order then never reads the `probe` file. |
| 5D-CARRIED-05 | In `tick_order`, `return -1` (the `OSError` arm) becomes `return float('inf')` | **N6-a**, tick 3: a project with no `probe` goes last, `['proj-b', 'proj-a']`. Tick 1 stays green, because both keys are equal and the order falls back to the names. |
| 5D-CARRIED-06 | `tick_order`'s key becomes `lambda p: (-last(p), p)` (newest first) | **N6-a**, tick 2 (`['proj-a', 'proj-b']`), and **N6-b**, tick 3. |
| 5D-CARRIED-07 | Revert 3d (`qualifying`'s old sentence) | **The review 1171 wording case**: the third `toContain` and the `not.toContain` on the old sentence. |
| 5D-CARRIED-08 | Revert 3f (the README's old `fetch-failed` sentence) | **The wording case**: the README `not.toContain('a scratch, alternates or refspec failure …')` and the following `toContain`. |
| 5D-CARRIED-09 | Revert 3h (the doctor header's old clause) | **The wording case**: the doctor `toContain` and its `not.toContain('zero open PRs, or the PR list failed')`. |
| 5D-CARRIED-10 | Drop `and also a name git allows that the grammar does not hold, such as `ws/a+b`, review 1171` from `project_rows`' docstring | **The wording case**: its first `toContain`. |
| 5D-CARRIED-11 | Revert 3b (header step 4 back to `For each conf, sorted, while the tick budget lasts:`) | The wording case: `toContain('4. For each conf, least recently measured first (tick_order')`. |
| 5D-CARRIED-12 | Revert 3e (README parenthesis back to the old text) | The wording case: README `toContain('or a name git allows but the probe\'s narrower grammar does not, such as `ws/a+b`')`. |
| 5D-CARRIED-13 | Delete the README paragraph 3g | The wording case: README `toContain('**The order.** Each tick measures the projects least recently measured first')`. |

### Task 4: The gate, the PR and the wave-done

**Files:** none new. This task measures, opens the PR and reports.

- [ ] **Step 1: The fence.** `git diff origin/main -- ccd/coordinator-skill/references/wave-lifecycle.md` shows no hunk between §5b's `` ```bash `` and its closing fence. The hash, measured with `sed -n '/^### 5b — /,/^## 6 — /p' <file> | awk '/^```bash$/{f=1;next} f&&/^```$/{exit} f' | sha256sum`, reads `dec52b5aaf9d6166853a25a18db29d2203a38fd6ace044f7c7068e43c4eef3a7` (254 lines).

- [ ] **Step 2: The suites.** One file per process, from `server/`, as `ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/<file>`. Expected: green.
  - **Every test file Tasks 1 to 3 create or modify,** whole: `ccd-land-probe`, `ccrc-uninstall` and `coordinator-skill`, and any other the tasks name.
  - **The readers of the changed files:**
    - `ccd-land-probe-readonly`, `ccd-land-probe-doctor` and `ccd-land-lineage-accept`;
    - `ccrc-doctor-core`, `doctor-cadence` and `ccd-harness-integrity`;
    - `coordinator-landing-verdict`, `worker-skill`, `reviewer-skill`, `expiry-lane-prose` and `install-coordinator-skill`.
  - **The guards:**
    - every `single-definition/*` file, each in its own process;
    - `citations`, `anchors`, `docs-parity` and `topology-clean`;
    - `deviation-refs`, after `git fetch origin main`;
    - `growth-check`, with `GROWTH_CHECK=1` after the fetch, reporting `ccd/ccrc`'s net delta;
    - `typecheck-tests` alone, and `tsc --noEmit` for the server.
  - Name every re-run of a known load flake in the wave-done.

- [ ] **Step 3: The mutation table.** Re-measure every row of Tasks 1 to 3 on the final files, sequentially, under the Global Constraints. Report each row as measured against predicted, naming the cases that went red, and each recorded survivor with its reason.

- [ ] **Step 4: Scope.** `git diff --stat origin/main` names only the files Tasks 1 to 3 list. `CLAUDE.md` is untouched.

- [ ] **Step 5: The PR.**
  - Before every push, scan the diff, the commit messages and the PR body for private names, as the repository's rule asks.
  - Push the branch once, after Steps 1 to 4 are green.
  - In the PR body, name: the key and its marker, the latest-attempt rule, the tick's order, the fence hash, `ccd/ccrc`'s growth figure, and the mutation rows.
  - Say in the PR body that the operator writes `lander=` only once the fleet box runs this probe.

- [ ] **Step 6: The fast run.** Wait for the PR's fast run on the exact tip to finish. Read its conclusion and its `plan fast server tests` summary. A red is a red gate: read the failing lines, and fix them on the branch or report them.

- [ ] **Step 7: The wave-done.** Send one wave-done at the exact final tip, with the fingerprint and the PR number. Include:
  - the gate's suite lines, with each re-run of a known load flake named;
  - the fence hash and `ccd/ccrc`'s net delta;
  - every mutation row measured against its prediction;
  - every departure (`D-TBD-<slug>`);
  - the fast run's id and conclusion, and whether its summary lists `ccd-land-probe` and `coordinator-skill`.

## Deviations found

This plan's numbers are D-7635 to D-7647, issued on 2026-10-31 for wave 5d. Each entry is dated 2026-10-31.

- **D-7635** — `uninstall-removes-lander` (Task 1): The scope ruling lists no ccd/ccrc change. But `_uninst_cc_sessions` removes `enabled` because it is 'the one file the probe writes that a LATER reader trusts' and 'with the probe gone nothing refreshes it'. `lander` is a second such file, and 5i's reader will trust it. Left behind by an uninstall, it would declare a coordinator-lands project that no probe backs. The plan widens that loop to `enabled` and `lander` under the same regular-file, non-symlink, one-level rules, and adds one uninstall case (5D-KEY-13 and 5D-KEY-14). ccd/ccrc is growth-listed. The change adds about 2 net code lines, under the limit, and the armed growth-check runs. If the coordinator rules it out, drop the ccrc edit, its README word and the uninstall case, and carry the item to 5i.
- **D-7636** — `marker-condition-same-as-enabled` (Task 1): No literal departure: the scope ruling's default (the pause and checkout conditions `enabled` uses, without lineage) is kept, and argued from spec 5.4 and 5.5. The line's inputs, the radar's `probe` and `main-health`, exist only for a measured project, and an absent marker makes the line inert, which is the fail-closed direction. One consequence the README now states: the radar's per-project `paused` file also withdraws the line's declaration. That is a widening of what that pause means, and the operator should see it.
- **D-7637** — `spec-spelling-lander-colon` (Task 1): Spec 5.5 writes the declaration as `lander:coordinator`. The conf grammar is `key=value`, so the key is spelled `lander=coordinator`, as the operator's ruling on question 3 says. The spec text is not amended in this task. Its colon reads as prose, not as conf syntax.
- **D-7638** — `reconcile-name-kept` (Task 1): `reconcile_enabled` now reconciles two mirrors but keeps its name. A rename would ripple into the header, the README and test describe strings for no behaviour change. Its docstring names both files, and the header's step 3 is retitled THE MIRROR PRE-PASS.
- **D-7639** — `latest-attempt-paragraph-of-its-own` (Task 2): Scope item 2 says to restate the D-7495 sentence as the latest attempt deciding. The plan restates that sentence in place only by dropping its strict clause and keeping its two facts (a rerun replays its run's original merge commit, now with the reason that still holds: it still carries main's red; and a close and reopen can race the merge-ref recompute), and states the rule, its consequence for the RED bullet's one rerun, and the every-attempt report line in a new paragraph, **The latest attempt decides**, after the stop paragraph and ending §5b. Putting four sentences about the report line inside the new-head route's sentences would split that route from its closing 'Where you take the route' sentence. The new paragraph sits inside the stop pin's slice (prose.slice(from) to the section's end), so the stop pin still holds every word, and an order case pins where it sits.
- **D-7640** — `report-line-before-re-enqueue-too` (Task 2): D-7546's note (wave 5a departures) says the coordinator reports a failed attempt before the enqueue, and wave 5b's dropped Task 2 said before every enqueue and every direct merge, in the landing report. This plan says before each enqueue, direct merge and re-enqueue, the same three acts the landing-line paragraph names, and puts the line in the coordinator's turn text, as scope item 2 words it. A read of filter=all that fails is named as unread and is no stop, which neither earlier text said; without it a failed report read could be taken for a stop.
- **D-7641** — `verdict-test-row-name-kept` (Task 2): server/test/coordinator-landing-verdict.test.ts keeps its row 'a required name that failed and then passed on the same head is still red: any completed run that failed is red (D-7495)'. It is outside scope item 2's file list, and it stays true of what it tests: the block's jq arm, handed both runs, prints RED (D-7546's note says that row pins the arm, not what live GitHub sends). The renamed arm case in coordinator-skill.test.ts carries the latest-attempt claim instead, by pinning read 5's URL without a filter. The row name states the arm's behaviour on two runs, not the gate's rule; 5h renames it.
- **D-7642** — `lru-order-not-clock-rotation` (Task 3): The scope offers rotating the tick's start by a value the probe already has, such as the tick's minute. The plan instead orders projects least recently measured first, by the mtime of each project's own probe file (lstat only, a project with none first, ties by name). A clock rotation has two defects. First, ticks are five minutes apart, so a minute rotation steps by five: with a project count sharing a factor with five, some starts never occur. Rotating by the tick index would restate the timer's period inside the probe, a second copy that D-7054 forbids doctor. Second, a rotation guarantees nothing when one project spends the whole budget. The last-measured order guarantees that a project left unstarted is the first measured next tick. It still meets every condition of the ruling: read-only (one lstat of the probe's own file, no open, no follow), deterministic under test (fs.utimesSync), no new file, knob, git or gh shape, and on a fresh HOME the order is today's sorted order. This is a different mechanism from the ruling's example. It is offered because it meets the ruling's three conditions and closes the starvation the ruling names. If the coordinator rejects it, N6 stays carried and steps 1b, 3a, 3b and 3g, the two order assertions in step 1c's wording case (the `4. For each conf, least recently measured first (tick_order` toContain and the README `**The order.** ...` toContain), and mutations 5D-CARRIED-04 to 06, 11 and 13 are dropped.
- **D-7643** — `readme-never-said-a-shape-git-forbids` (Task 3): The ledger names README's 'a shape git forbids'. README on main never carried that phrase: its held-row parenthesis reads '(corrupt registry content, such as a NUL byte, `ws/a~0` or `ws/a.lock`)', which is untrue in the same way, since it presents every held name as corrupt. The plan fixes that parenthesis (it adds 'or a name git allows but the probe's narrower grammar does not, such as `ws/a+b`') and the literal phrase in project_rows' docstring. The 1171-a case pins the behaviour with a real ws/gamma+b row.
- **D-7644** — `pr-body-left-as-merged` (Task 3): The ledger item says README and the PR body list an alternates failure under the fallback's fetch-failed. Only README is fixed. The PR body belongs to a merged PR: an edit adds a revision that GitHub keeps and changes no durable reader. The scope's 'the notes' listing' is already true (the notes' Departure 4 lists no alternates failure).
- **D-7645** — `wording-pins-added` (Task 3): Scope item 3 calls these items wording. The plan adds one text-pin case in ccd-land-probe-readonly.test.ts, so that a revert of the probe docstrings, the README sentences or the doctor header goes red (mutation-table discipline). The notes file and the census header comment are not pinned. The notes are a dated plan document, and the census header is the test file's own comment.
- **D-7646** — `notes-corrected-in-place` (Task 3): The ledger carried these wording items against the notes file (wave3b-notes.md). A notes file is not a plan's task text, so it is corrected where it stands, in task step 3i, and not by a departure from the plan.
- **D-7647** — `symlinked-marker-reads-absent` (Task 1, plan review): `remove_own` refuses to act when `$REG/landing` or the project's directory is not a real directory, so a `lander` file reached through a symlink is neither written nor removed (K7), and a stale one can stand there. 5i's reader must treat a `lander` reached through a symlinked `$REG/landing` or project directory as absent.
