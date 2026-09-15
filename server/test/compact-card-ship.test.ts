// server/test/compact-card-ship.test.ts
// The compaction card's helper reaches a box the same way the hook does, and
// this file is why that stays true. The hook's two guards for it —
// `[ -f "$COMPACT_HELPER" ] || return 0`, once in PreCompact and once in
// PostCompact — are silent and total, so a helper shipped through one door and
// not another is a fleet of boxes that publish no set, serve no card and
// journal no measurement, with nothing anywhere saying so.
//
// THE PATH IS DERIVED FROM THE HOOK, NEVER RESTATED. Every destination below is
// built from `COMPACT_HELPER`'s own assignment in `ccd/session-hook.sh`, so the
// divergence class this file exists for — the hook looking in one place and an
// installer writing to another — reds in BOTH directions, rather than only when
// someone remembers to edit three literals in step.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const REPO = path.join(import.meta.dirname, '..', '..');
const read = (rel: string): string => fs.readFileSync(path.join(REPO, rel), 'utf8');

/** Executable lines only. `deploy.sh` and `ccrc` both discuss their own helpers
 *  by name in prose, and a scrape that counted comments would "prove" an
 *  ordering the shell never runs — `ccrc-api-ship.test.ts`'s rule, and its
 *  reason, applied to two files. */
const code = (src: string): string[] =>
  src.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));

/** `COMPACT_HELPER` as the hook spells it: `$HOME/…`. */
const helperAbs = (): string => {
  // COUNT THEM, then take the one. `exec` returns the FIRST match and bash runs
  // the LAST top-level assignment, so the two disagree the moment there are
  // two — and the message here used to claim a count the assertion never made.
  // MEASURED (r1 first-run B2): a second top-level `COMPACT_HELPER=` line left
  // this file 8/8 GREEN with every destination below derived from the dead
  // first assignment, i.e. from a path the hook no longer resolves.
  const all = read('ccd/session-hook.sh').match(/^COMPACT_HELPER=.*$/gm) ?? [];
  expect(all, 'the hook assigns COMPACT_HELPER exactly once, at top level').toHaveLength(1);
  const m = /^COMPACT_HELPER="([^"]+)"$/.exec(all[0]!);
  expect(m, 'and assigns it one double-quoted path, nothing else').toBeTruthy();
  return m![1]!;
};
/** The same path as `install_atomic` spells a destination: HOME-relative. */
const helperRel = (): string => {
  const abs = helperAbs();
  expect(abs.startsWith('$HOME/'), `COMPACT_HELPER is not under $HOME: ${abs}`).toBe(true);
  return abs.slice('$HOME/'.length);
};
const helperName = (): string => path.posix.basename(helperAbs());

describe('compact-card.mjs ships', () => {
  it('deploy.sh installs it through install_atomic, at 644, where the hook looks for it', () => {
    const line = code(read('deploy/deploy.sh'))
      .filter((l) => l.startsWith('install_atomic ccd/compact-card.mjs'));
    expect(line, 'deploy.sh installs ccd/compact-card.mjs exactly once').toHaveLength(1);
    expect(line[0]).toBe(`install_atomic ccd/compact-card.mjs ${helperRel()} 644`);
  });

  it('it is never scp\'d straight to its final name', () => {
    // deploy-verify's own idiom, and its reason: bash executes a script lazily
    // from a saved byte offset, and `node` reads this one at whatever moment a
    // compaction starts. Both `"$BOX":dest` and `"$BOX:dest"` are banned, so a
    // call site "fixed" by switching quote style cannot sail through.
    const escaped = helperRel().replace(/[./]/g, '\\$&');
    const direct = new RegExp(
      `"\\$\\{SCP\\[@\\]\\}"\\s+\\S+\\s+("\\$BOX":|"\\$BOX:)${escaped}"?(?!\\.incoming)(\\s|$)`, 'm');
    expect(direct.test(read('deploy/deploy.sh')),
      'the helper is copied to its live name in place — the hazard install_atomic exists for').toBe(false);
  });

  it('it ships in the AGENT lane, before the hook that calls it', () => {
    const src = read('deploy/deploy.sh');
    const agentStart = src.indexOf('if [ "$TARGET" = "agent" ]');
    const agentEnd = src.indexOf('\nelse', agentStart);
    expect(agentStart, 'deploy.sh still has an agent branch').toBeGreaterThan(-1);
    expect(agentEnd, 'and it still ends at a top-level else').toBeGreaterThan(agentStart);
    const at = src.indexOf('install_atomic ccd/compact-card.mjs ');
    expect(at, 'the helper installs in the agent lane, not the server lane')
      .toBeGreaterThan(agentStart);
    expect(at, 'the helper installs in the agent lane, not the server lane').toBeLessThan(agentEnd);
    const lines = code(src);
    const helper = lines.findIndex((l) => l.startsWith('install_atomic ccd/compact-card.mjs '));
    const hook = lines.findIndex((l) => l.startsWith('install_atomic ccd/session-hook.sh '));
    expect(hook, 'deploy.sh still installs the hook').toBeGreaterThan(-1);
    expect(helper, 'the helper lands BEFORE the hook that calls it: the reverse order opens a window '
      + 'in which every live session on the box compacts against a helper that is not there yet, and '
      + 'the hook is silent about it').toBeLessThan(hook);
    expect(Math.abs(hook - helper),
      'the helper installs beside the hook — same lane, same event order').toBeLessThanOrEqual(2);
  });

  it('deploy.sh backs it up in the same set as the hook', () => {
    // EXECUTABLE LINES ONLY — this file's own rule, applied where it was
    // missing. MEASURED (r1 B2): deleting the executable clause and leaving its
    // exact spelling behind as a comment left this test GREEN while the agent
    // lane took no backup at all, and a raw `toContain` cannot tell a rollback
    // note from a rollback. The count is part of the claim: two spellings of
    // the same backup would mean one of them is not the one that runs.
    const lines = code(read('deploy/deploy.sh'));
    const running = (spelling: string): string[] => lines.filter((l) => l.includes(spelling));
    expect(running(`cp -a ~/${helperRel()} ~/ccrc-backups/$TS/${helperName()}`),
      'deploy.sh backs the helper up in exactly one line the shell runs').toHaveLength(1);
    expect(running('cp -a ~/.cc-sessions/session-hook.sh ~/ccrc-backups/$TS/session-hook.sh'),
      'the hook is still the neighbour this is "the same set as"').toHaveLength(1);
  });

  it('ccrc install places it at 644 before the hook, update backs it up, uninstall removes it', () => {
    const src = read('ccd/ccrc');
    const lines = code(src);
    const abs = helperAbs();
    const name = helperName();
    expect(lines).toContain(`_inst_atomic "$tree/ccd/${name}" "${abs}" 644`);
    const helper = lines.indexOf(`_inst_atomic "$tree/ccd/${name}" "${abs}" 644`);
    const hook = lines.findIndex((l) => l.startsWith('_inst_atomic "$tree/ccd/session-hook.sh"'));
    expect(hook, 'ccrc install still places the hook').toBeGreaterThan(-1);
    expect(helper, 'ccrc install places the helper before the hook, for deploy.sh\'s reason')
      .toBeLessThan(hook);
    expect(lines).toContain(`_upd_backup_copy "${abs}" ${name}`);
    // `_uninst_cc_sessions`' own header says its list IS `_inst_files` +
    // `_inst_skills`' install set, exactly. An installer with no removal beside
    // it does not merely leak a file — it makes that sentence false.
    const fn = /_uninst_cc_sessions\(\) \{([\s\S]*?)\n\}/.exec(src);
    expect(fn, 'ccrc still has a _uninst_cc_sessions').toBeTruthy();
    expect(fn![1], 'ccrc uninstall removes the helper it installs').toContain(`"$reg/${name}"`);
  });

  it('the release tarball carries it, because the pathspec names a directory', () => {
    // `git archive … ccd` is why `build-release.sh` needs no edit for this
    // file. Pinned rather than trusted: narrowing that pathspec to a file list
    // would leave a tarball whose `ccrc install` dies on a missing source.
    expect(code(read('deploy/build-release.sh'))).toContain('install.sh shared ccd deploy \\');
  });

  it('the helper\'s TYPES never reach a box', () => {
    // `compact-card.d.mts` exists for the vitest import; `node` never reads it
    // and no box has a use for it, so it must not join the install set that
    // `_uninst_cc_sessions` has to mirror.
    for (const rel of ['deploy/deploy.sh', 'ccd/ccrc']) {
      expect(code(read(rel)).filter((l) => l.includes('compact-card.d.mts')),
        `${rel} ships the helper's declaration file to a box`).toEqual([]);
    }
  });

  it('imports node:* only — the shared/mark.mjs class, never bundled, never npm', () => {
    const src = read('ccd/compact-card.mjs');
    const imports = [...src.matchAll(/^import .* from '([^']+)';$/gm)].map((m) => m[1]);
    expect(imports.length).toBeGreaterThan(0);
    for (const i of imports) expect(i, `${i} is not a node:* module`).toMatch(/^node:/);
  });
});
