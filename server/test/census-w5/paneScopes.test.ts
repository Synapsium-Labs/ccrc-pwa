// The pane scope's census, held two ways (D-7303; ARCH-72, Task C5l; plan
// 2026-10-29-consolidation-k16-panescope-reader.md): against a FIXTURE tree, so each query counts what it claims and
// passes over what it must not, and against the REAL tree, where each REPORTS by name (`reportRow.ts`), its base and
// target both the measured base: under OA-C21 (a) no count moves, and under (b) only the listers' definitions do,
// which that task's own ratchet pins.
import { describe, it, expect } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expectReportRow } from './reportRow.js';
import {
  paneScopeActs, paneScopeListers, panescopeReaders, panescopeSuffixPurgers, panescopeWriterLines, panescopeWriters,
  type PaneScopeSite,
} from './paneScopes.js';

const show = (name: string, sites: readonly PaneScopeSite[]): void => {
  console.log(`census ${name}: ${sites.length}\n${sites.map((s) => `  ${s.name}  (${s.file}:${s.line}  ${s.text.trim()})`).join('\n')}`);
};
const names = (sites: readonly PaneScopeSite[]): string[] => sites.map((s) => s.name);

const SH = '#!/usr/bin/env bash\n';

describe('the pane scope census (D-7303)', () => {
  const tree = (files: Record<string, string>): string => {
    const t = mkdtempSync(path.join(tmpdir(), 'k16-census-'));
    for (const [rel, body] of Object.entries(files)) {
      const p = path.join(t, rel);
      mkdirSync(path.dirname(p), { recursive: true });
      writeFileSync(p, body, { mode: 0o755 });
    }
    return t;
  };
  const planted = (): string => tree({
    'ccd/ccd': [
      SH,
      'reader_a() {',
      '  local id="$1" scope',
      '  scope=$(_reg_get "$id" panescope)',
      '  scope=$(_reg_get "$id" panescope)',
      '}',
      'reader_to() {',
      '  _reg_read_to v "$1" panescope || return 1',
      '}',
      'reader_path() {',
      '  [[ -f "$REG/$1.panescope" ]] && cat "$REG/$1.panescope"',
      '}',
      'named_not_field() {',
      '  _panescope_record "$1"',
      '  _panescope_proc_root',
      '  _reg_get "$1" panescopes',
      '  _reg_get "$1" scope',
      '}',
      'commented() {',
      '  # scope=$(_reg_get "$id" panescope)',
      '  echo "the marker $REG/<id>.panescope names the scope"',
      '  log "rm -f $REG/$id.panescope would remove it"',
      '}',
      'writer_two() {',
      '  _reg_set "$id" panescope "$unit" && return 0',
      '  rm -f -- "$REG/$id.panescope"',
      '}',
      'writer_redirect() {',
      '  printf "%s" "$u" > "$REG/$1.panescope"',
      '}',
      'purge() {',
      '  local id="$1" f',
      '  for f in "$REG/$id".*; do',
      '    rm -f "$f"',
      '  done',
      '}',
      'private_family() {',
      '  for pf in "$REG/.$id".*; do rm -f "$pf"; done',
      '}',
      'lister_plain() {',
      '  systemctl --user list-units --no-legend --plain \'tmux-spawn-*.scope\'',
      '}',
      'lister_ro() {',
      '  while read -r u _; do echo "$u"; done < <(systemctl --user list-units --no-legend \'tmux-spawn-*.scope\' 2>/dev/null)',
      '}',
      'lister_other() {',
      '  systemctl --user list-units --no-legend \'ccrc-tmux-server.scope\'',
      '  echo "systemctl --user list-units tmux-spawn-*.scope"',
      '}',
      'acting() {',
      '  for s in $(systemctl --user list-units --no-legend "tmux-spawn-*.scope" | awk \'{print $1}\'); do',
      '    systemctl --user set-property --runtime "$s" MemoryMax=12G',
      '    systemctl --user stop --no-block "$s"',
      '  done',
      '}',
      'stop_elsewhere() {',
      '  systemctl --user stop "other.scope"',
      '}',
      '',
    ].join('\n'),
  });

  it('FIXTURE readers: a field read (both forms) and a path read count, one site per body; a name, another field, a comment and a quoted sentence do not', () => {
    const t = planted();
    try {
      expect(names(panescopeReaders(t))).toEqual(['ccd/ccd#reader_a', 'ccd/ccd#reader_to', 'ccd/ccd#reader_path']);
    } finally { rmSync(t, { recursive: true, force: true }); }
  });

  it('FIXTURE writers: `_reg_set … panescope`, `rm` and a redirection count, one site per body (its writing lines listed); the suffix-glob purge is reported apart', () => {
    const t = planted();
    try {
      expect(names(panescopeWriters(t))).toEqual(['ccd/ccd#writer_two', 'ccd/ccd#writer_redirect']);
      expect(panescopeWriterLines(t).map((s) => `${s.name} ${s.text.trim()}`)).toEqual([
        'ccd/ccd#writer_two _reg_set "$id" panescope "$unit" && return 0',
        'ccd/ccd#writer_two rm -f -- "$REG/$id.panescope"',
        'ccd/ccd#writer_redirect printf "%s" "$u" > "$REG/$1.panescope"',
      ]);
      expect(names(panescopeSuffixPurgers(t))).toEqual(['ccd/ccd#purge']);
    } finally { rmSync(t, { recursive: true, force: true }); }
  });

  it('FIXTURE listers: the pattern word with and without --plain, read-only and acting; another unit and a quoted sentence are not listers', () => {
    const t = planted();
    try {
      expect(paneScopeListers(t).map((s) => ({ name: s.name, plain: s.plain, acts: s.acts }))).toEqual([
        { name: 'ccd/ccd#lister_plain', plain: true, acts: false },
        { name: 'ccd/ccd#lister_ro', plain: false, acts: false },
        { name: 'ccd/ccd#acting', plain: false, acts: true },
      ]);
    } finally { rmSync(t, { recursive: true, force: true }); }
  });

  it('FIXTURE acts: set-property and stop count only in a body that lists pane scopes', () => {
    const t = planted();
    try {
      expect(names(paneScopeActs(t))).toEqual(['ccd/ccd#acting:set-property', 'ccd/ccd#acting:stop']);
    } finally { rmSync(t, { recursive: true, force: true }); }
  });

  it('FIXTURE: a sibling program\'s sites carry its own name, and its top level is `<top-level>`', () => {
    const t = tree({
      'ccd/ccd': `${SH}x() { :; }\n`,
      'ccd/cap': `${SH}for s in $(systemctl --user list-units --no-legend "tmux-spawn-*.scope" 2>/dev/null | awk '{print $1}'); do\n  systemctl --user set-property --runtime "$s" TasksMax=4096 2>/dev/null\ndone\n`,
      'ccd/notes.md': 'systemctl --user list-units tmux-spawn-*.scope\n',
    });
    try {
      expect(paneScopeListers(t).map((s) => [s.name, s.plain, s.acts])).toEqual([['ccd/cap#<top-level>', false, true]]);
      expect(names(paneScopeActs(t))).toEqual(['ccd/cap#<top-level>:set-property']);
    } finally { rmSync(t, { recursive: true, force: true }); }
  });

  // ── REAL: each query reports by name; base and target are both the measured base ──────────────────────────────────
  const READERS = ['ccd/ccd#_end_cause'];
  const WRITERS = ['ccd/ccd#_panescope_record'];
  const PURGERS = ['ccd/ccd#_reg_purge'];
  const LISTERS = ['ccd/ccd-cap-scopes#<top-level>', 'ccd/ccd-scope-sweep#<top-level>', 'ccd/ccrc-doctor-checks#_check_scopes', 'ccd/ccrc-doctor-checks#_check_oom-policy'];
  const ACTS = ['ccd/ccd-cap-scopes#<top-level>:set-property', 'ccd/ccd-scope-sweep#<top-level>:stop'];

  it('REAL readers: `$REG/<id>.panescope` has one reader, ccd/ccd#_end_cause (reported)', () => {
    const got = panescopeReaders();
    show('panescopeReaders', got);
    expectReportRow('panescopeReaders', names(got), READERS, READERS, 1);
  });

  it('REAL writers: one writer body, ccd/ccd#_panescope_record (two writing lines); ccd/ccd#_reg_purge\'s suffix glob reported apart, not counted', () => {
    const got = panescopeWriters();
    show('panescopeWriters', got);
    show('panescopeWriterLines', panescopeWriterLines());
    show('panescopeSuffixPurgers (apart)', panescopeSuffixPurgers());
    expectReportRow('panescopeWriters', names(got), WRITERS, WRITERS, 1);
    expect(names(got).filter((n) => PURGERS.includes(n)), 'the suffix-glob purge is never a counted writer').toEqual([]);
    expect(names(panescopeSuffixPurgers()), 'the purge, reported apart').toEqual(expect.arrayContaining(PURGERS));
  });

  it('REAL listers: four, two acting (the cap without --plain, the sweep with it) and the doctor\'s two read-only (reported)', () => {
    const got = paneScopeListers();
    console.log(`census paneScopeListers: ${got.length}\n${got.map((s) => `  ${s.name}  plain=${s.plain} acts=${s.acts}  (${s.file}:${s.line}  ${s.text.trim()})`).join('\n')}`);
    expectReportRow('paneScopeListers', names(got), LISTERS, LISTERS, 1);
    const byName = new Map(got.map((s) => [s.name, s]));
    for (const n of names(got)) {
      const s = byName.get(n)!;
      expect({ n, plain: s.plain, acts: s.acts }, `${n}: its flags and act as measured`).toEqual({
        n, plain: n === 'ccd/ccd-scope-sweep#<top-level>', acts: n === LISTERS[0] || n === LISTERS[1],
      });
    }
  });

  it('REAL acts: two, the cap\'s set-property --runtime and the sweep\'s stop --no-block (reported)', () => {
    const got = paneScopeActs();
    show('paneScopeActs', got);
    expectReportRow('paneScopeActs', names(got), ACTS, ACTS, 1);
  });
});
