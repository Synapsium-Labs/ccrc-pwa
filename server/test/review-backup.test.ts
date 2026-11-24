// X3 R1.5 (M-X3.7): a snapshot must never carry the private review store back across a restore.
// Read source text only. Plant controls in memory; never run a backup or open the real store.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from './scan/symbols.js';

const read = (rel: string) => readFileSync(path.join(REPO_ROOT, rel), 'utf8');
const ccrc = read('ccd/ccrc');
const deploy = read('deploy/deploy.sh');
const snapshot = read('deploy/coordination-snapshot.mjs');
const store = '/.ccrc/review-shares';

function between(text: string, start: string, end: string): string {
  const first = text.indexOf(start);
  expect(first, `missing backup census start: ${start}`).toBeGreaterThanOrEqual(0);
  const last = text.indexOf(end, first + start.length);
  expect(last, `missing backup census end: ${end}`).toBeGreaterThan(first);
  return text.slice(first, last);
}

function shellCopiesStore(text: string): boolean {
  // A source-operand census for the standing backup blocks, not a shell interpreter. Treat
  // quoted and unquoted path spellings alike, and fail closed on globs that could include dotfiles.
  const code = text.replace(/(^|[ \t])#.*$/gm, '').replace(/["']/g, '');
  const homePath = /(?:\$\{HOME\}|\$HOME|~)(?=\/|\s|[;|&<>()]|$)(\/[^\s;|&<>()\\]*)?/g;
  for (const [, suffix = '/'] of code.matchAll(homePath)) {
    const candidate = path.posix.normalize(suffix).replace(/\/$/, '') || '/';
    if (candidate === '/' || candidate === '/.ccrc' || candidate === store || candidate.startsWith(`${store}/`)) return true;
    if (/[*?\[{]/.test(candidate) && ['/.ccrc', store, '/ccrc', '/ccrc/review-shares']
      .some(target => path.posix.matchesGlob(target, candidate))) return true;
  }
  return false;
}

function snapshotNamesStore(text: string): boolean {
  // Look at the member declaration and the capture body, including a member named via a constant.
  const members = between(text, 'const MEMBER_KEYS = ', '\nfunction readManifest');
  const capture = between(text, 'export function capture(opts) {', '\nconst MEMBER_KEYS = ');
  const code = (part: string) => part.replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, '');
  return /\breview-shares\b|\breview_?shares\b/i.test(code(members) + code(capture));
}

const funcs = [
  ['_upd_backup', '  _upd_backup_set\n', '  cp -a ~/.ccrc "$UPD_BACKUP_DIR/"\n'],
  ['_upd_backup_set', '  _upd_backup_copy "$BOX_TREE_DIR/server/dist"', '  _upd_backup_copy "$HOME/.ccrc/review-shares" review-shares data\n'],
  ['cmd_backup', '  _upd_backup backup\n', '  cp -a "${HOME}" "$BOX_BACKUP_ROOT/"\n'],
] as const;
const lanes = [
  ['agent', '# Back up what the previous deploy left', '# `--exclude \'ccrc-mail.token\'`:', '  "${SSH[@]}" "$BOX" "cp -a ~/.ccrc/review-* ~/ccrc-backups/$TS/"\n'],
  ['server', '# Back up the served bundle before rsync --delete replaces it.', '# See the agent path\'s identical exclude', '  "${SSH[@]}" "$BOX" "cp -a ~/.ccrc/* ~/ccrc-backups/$TS/"\n'],
] as const;

function plant(text: string, at: string, insertion: string): string {
  const planted = text.replace(at, () => insertion + at);
  expect(planted).not.toBe(text);
  return planted;
}

describe('review snapshots are not backed up or restored', () => {
  it.each(funcs)('scans ccd/ccrc#%s and detects a planted copy', (name, anchor, copy) => {
    const body = (text: string) => between(text, `\n${name}() {`, '\n}\n');
    expect(shellCopiesStore(body(ccrc))).toBe(false);
    expect(shellCopiesStore(body(plant(ccrc, anchor, copy)))).toBe(true);
  });

  it.each(lanes)('scans the deploy %s backup block and detects a planted copy', (_lane, start, end, copy) => {
    const body = (text: string) => between(text, start, end);
    expect(shellCopiesStore(body(deploy))).toBe(false);
    expect(shellCopiesStore(body(plant(deploy, end, copy)))).toBe(true);
  });

  it('scans coordination snapshot membership and detects a planted member', () => {
    expect(snapshotNamesStore(snapshot)).toBe(false);
    const added = plant(snapshot, 'coordDb: DB_FILE, delegationCarried:', "reviewShares: 'review-shares', ");
    expect(snapshotNamesStore(added)).toBe(true);
  });

  it.each(['$HOME', '${HOME}/.', '~/.ccrc/', '"$HOME"/.ccrc/review-shares/index',
    '~/*', '~/.ccrc/*', '~/.ccrc/review-??????', '~/.ccrc/{memory,review-shares}'])('detects a copy of %s', source => {
    expect(shellCopiesStore(`cp -a ${source} "$UPD_BACKUP_DIR/"`)).toBe(true);
  });

  it('leaves standing narrow copies and comments alone', () => {
    expect(shellCopiesStore('cp -a "$HOME/.ccrc/memory" "$UPD_BACKUP_DIR/" # not ~/.ccrc/review-shares')).toBe(false);
  });
});
