// W5's account-marker census, held two ways (`consolidation-census.test.ts`'s discipline; D-7048; ARCH-72, Task C5a;
// plan 2026-10-26-consolidation-arch43-arch72-accounts.md): against a FIXTURE tree, so the query counts what it claims
// and passes over what it must not, and against the REAL tree, so it finds the writers the plan cites. The REAL rows
// REPORT: the base counts (`authdead` 6, `disabled` 3) are what the PR body prints, and each may-only-shrink pin lands
// later, in the commit that reaches its count (C5b: 6 -> 4; C5c: 3 -> 1). They hold only what is true at every step of
// the series: the readers are never writers, and every name is a real body.
import { describe, it, expect } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { ccdFunctionDefinitions, CCD_FUNCTION_DEF, REPO } from '../consolidationCensus.js';
import {
  accountMarkerWriters, bashBodies, disabledProjectionWriters, shippedBashPrograms, type AccountMarkerWriter,
} from './accountMarkers.js';

const show = (name: string, sites: readonly AccountMarkerWriter[]): void => {
  console.log(`census ${name}: ${sites.length}\n${sites.map((s) => `  ${s.name}  (${s.file}:${s.line}  ${s.text.trim()})`).join('\n')}`);
};

const SH = '#!/usr/bin/env bash\n';

describe('W5 account-marker census (D-7048)', () => {
  const tree = (files: Record<string, string>): string => {
    const t = mkdtempSync(path.join(tmpdir(), 'w5-census-'));
    for (const [rel, body] of Object.entries(files)) {
      const p = path.join(t, rel);
      mkdirSync(path.dirname(p), { recursive: true });
      writeFileSync(p, body, { mode: 0o755 });
    }
    return t;
  };

  const W_A = 'w_a() {\n  local f="$REG/$1-authdead"\n  rm -f -- "$f"\n}';
  const W_B = 'w_b() {\n  printf x > "$REG/$1-authdead"\n}';
  const W_B_EDITED = 'w_b() {\n  printf y > "$REG/$1-authdead"\n}';
  const region = (body: string): string =>
    `# ── BEGIN GENERATED ACCOUNT HELPERS (fixture) ──\n# ccrc:generated 1 sha256=${'0'.repeat(64)}\n${body}\n# ── END GENERATED ACCOUNT HELPERS ──\n`;
  const generatedTree = (wb: string): string => tree({
    'ccd/ccd': `${SH}${W_A}\n${W_B}\n_reader() { [[ -f "$REG/$1-authdead" ]]; }\n`,
    'ccd/sibling': `${SH}${region(`${W_A}\n${wb}`)}main() {\n  w_a "$1"\n}\n`,
  });

  it('FIXTURE: a generated region\'s byte copy is no site, a region body that differs by one byte is its own (3, then 2)', () => {
    const t = generatedTree(W_B_EDITED);
    const u = generatedTree(W_B);
    try {
      expect(accountMarkerWriters('authdead', t).map((s) => s.name)).toEqual(['ccd/ccd#w_a', 'ccd/ccd#w_b', 'ccd/sibling#w_b']);
      expect(accountMarkerWriters('authdead', u).map((s) => s.name)).toEqual(['ccd/ccd#w_a', 'ccd/ccd#w_b']);
    } finally { rmSync(t, { recursive: true, force: true }); rmSync(u, { recursive: true, force: true }); }
  });

  it('FIXTURE: every write form counts, one site per body; readers, comments and other names do not', () => {
    const t = tree({
      'ccd/ccd': [
        SH,
        'staged() {',
        '  tmp=$(mktemp "$REG/$1-authdead.tmp.XXXXXX") && printf "%s" x > "$tmp" && mv -f "$tmp" "$REG/$1-authdead"',
        '  rm -f "$REG/$1-authdead"',
        '}',
        'oneline() { rm -f "$REG/$1-authdead"; }',
        'touched() {',
        '  touch "$REG/$1-authdead"',
        '}',
        'plat() {',
        '  local tgt="$REG/$1-authdead"',
        '  _plat_mv_notdir "$2" "$tgt"',
        '}',
        'listed() {',
        '  for f in "$A/$1.json" "$REG/$1-authdead"; do',
        '    rm -f -- "$f"',
        '  done',
        '}',
        'in_heredoc() {',
        '  bash <<\'EOF\'',
        '}',
        'rm -f "$REG/$1-authdead"',
        'EOF',
        '}',
        'reader() {',
        '  local f="$REG/$1-authdead" t',
        '  [[ -f "$f" && ! -L "$f" ]] || return 1',
        '  t=$(cat "$f" 2>/dev/null)',
        '}',
        'commented() {',
        '  # rm -f "$REG/$1-authdead"',
        '  echo "-> $REG/$1-authdead"',
        '}',
        'other_name() {',
        '  rm -f "$REG/$1-authdeadline" "$REG/$1.authdead"',
        '}',
        'rm -f -- "$REG"/*-authdead.tmp.* 2>/dev/null',
        '',
      ].join('\n'),
      'ccd/helper.py': 'import os\nos.remove(REG + "/x-authdead")\n',
      'ccd/notes': 'plain text, no shebang\nrm -f "$REG/$1-authdead"\n',
    });
    try {
      expect(accountMarkerWriters('authdead', t).map((s) => s.name)).toEqual([
        'ccd/ccd#staged', 'ccd/ccd#oneline', 'ccd/ccd#touched', 'ccd/ccd#plat', 'ccd/ccd#listed', 'ccd/ccd#in_heredoc',
        'ccd/ccd#<top-level>',
      ]);
      expect(shippedBashPrograms(t)).toEqual(['ccd/ccd']);
    } finally { rmSync(t, { recursive: true, force: true }); }
  });

  it('FIXTURE: the disabled query passes over every non-lane switch, the --disabled flag and a quoted sentence', () => {
    const t = tree({
      'ccd/ccrc': [
        SH,
        'lane_off() {',
        '  local marker="$_SVC_REG/$1-disabled" tmp="$_SVC_REG/.$1-disabled.tmp.$$"',
        '  : > "$tmp"',
        '  _plat_mv_notdir "$tmp" "$marker"',
        '}',
        'switches() {',
        '  touch "$REG/stop-done-disabled" "$REG/hibernate-disabled" "$REG/mail-disabled" "$REG/asks-disabled"',
        '  rm -f "$REG/child-reclaim-disabled" "$REG/idle-compact-nudge-disabled" "$REG/stall-watch-disabled" "$REG/autocompact-disabled"',
        '  node op.mjs switched --id "$1" --disabled true > "$out"',
        '}',
        'remove_loop() {',
        '  for f in "$L/$id.json" "$_SVC_REG/$id-disabled"; do rm -f -- "$f"; done',
        '}',
        'sentence() {',
        '  die "no account (kill-switch; rm $REG/$lane-disabled to re-enable) or <id>-disabled is present"',
        '  local marker="$_SVC_REG/$id-disabled"',
        '  [ ! -d "$marker" ] || refuse "$marker is a directory"',
        '}',
        '',
      ].join('\n'),
    });
    try {
      expect(accountMarkerWriters('disabled', t).map((s) => s.name)).toEqual(['ccd/ccrc#lane_off', 'ccd/ccrc#remove_loop']);
    } finally { rmSync(t, { recursive: true, force: true }); }
  });

  it('FIXTURE: a body ends where its braces close or at a column-0 } outside a heredoc; one-line definitions are bodies', () => {
    const b = bashBodies(`${SH}a() { :; }\nb() {\n  cat <<EOF\n}\nEOF\n}\nc() { local x="\${1-}"\n      echo "{ $x"; }\nx=1\nd() {\n  :\n}\n`);
    expect(b.map((x) => x.name)).toEqual(['a', 'b', 'c', 'd', '<top-level>']);
    expect(b[1]!.lines.map((l) => l.line)).toEqual([3, 4, 5, 6, 7]);
    expect(b[2]!.lines.map((l) => l.line)).toEqual([8, 9]);
    expect(b[4]!.lines.map((l) => l.line)).toEqual([1, 10, 14]);
  });

  it('FIXTURE: a projection writer outside the named disabled bodies is a site, in bash, JS/TS or Python; other switches are not', () => {
    const t = tree({
      'ccd/ccrc': `${SH}lane_off() {\n  local marker="$REG/$1-disabled"\n  touch "$marker"\n}\n`,
      'ccd/ccd': `${SH}_lane_enabled() { [[ ! -f "$REG/$1-disabled" ]]; }\n`,
      'deploy/gen.mjs': "for (const a of r.accounts) if (a.homeAble === false) writeFileSync(join(reg, `${a.id}-disabled`), '');\n",
      'deploy/switch.mjs': "writeFileSync(join(reg, 'stop-done-disabled'), '');\n// writeFileSync(join(reg, `${id}-disabled`), '');\n",
      'deploy/converge.sh': '#!/bin/sh\nconverge() {\n  for id in $IDS; do touch "$REG/$id-disabled"; done\n}\n',
      'shared/project.py': 'with open(f"{reg}/{i}-disabled", "w"):\n    pass\n',
      'shared/read.ts': "const off = existsSync(join(reg, `${id}-disabled`));\n",
    });
    try {
      expect(disabledProjectionWriters(t).map((s) => s.name)).toEqual(['deploy/converge.sh#converge', 'deploy/gen.mjs:1', 'shared/project.py:1']);
    } finally { rmSync(t, { recursive: true, force: true }); }
  });

  it('REAL: the body splitter finds every ccd/ccd function ccdFunctionDefinitions finds, in order', () => {
    const want = ccdFunctionDefinitions().map((d) => CCD_FUNCTION_DEF.exec(d.text)![1]!);
    const got = bashBodies(readFileSync(path.join(REPO, 'ccd', 'ccd'), 'utf8')).filter((b) => b.fn).map((b) => b.name);
    expect(got).toEqual(want);
  });

  const READERS = ['ccd/ccd#_authdead', 'ccd/ccd-telemetry-keepalive#_authdead', 'ccd/ccd#_lane_enabled'];

  it('REAL: auth-dead writers, reported by name (6 at base: the rescue, the expiry, the spawn clear, the probe\'s three)', () => {
    const s = accountMarkerWriters('authdead');
    show('accountMarkerWriters(authdead)', s);
    const names = s.map((x) => x.name);
    for (const r of READERS) expect(names).not.toContain(r);
    expect(names).toContain('ccd/ccd#_authdead_expired');
    expect(s.length).toBeGreaterThan(0);
  });

  it('REAL: disabled-switch writers, reported by name (3 at base: _acct_mark_off, _acct_enable, _acct_remove)', () => {
    const s = accountMarkerWriters('disabled');
    show('accountMarkerWriters(disabled)', s);
    const names = s.map((x) => x.name);
    for (const r of READERS) expect(names).not.toContain(r);
    expect(names.every((n) => n.startsWith('ccd/ccrc#'))).toBe(true);
    expect(s.length).toBeGreaterThan(0);
  });
});
