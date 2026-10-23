// server/test/transcript-jq-ship.test.ts
// The one transcript reader (`ccd/lib/transcript.jq`, ARCH-65) is data that two bash programs load with
// `jq -L`. A copy that never reaches a box is not a loud failure: every read answers NOT MEASURED. So
// the three installers, the uninstaller and the lookup are held here, in both directions.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { mkTmp } from './tmpHelpers.js';

const REPO = path.join(import.meta.dirname, '..', '..');
const read = (rel: string): string => fs.readFileSync(path.join(REPO, rel), 'utf8');
const code = (src: string): string[] => src.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
const DEST = '.cc-sessions/lib/transcript.jq';
const A = 'a'.repeat(36), B = 'b'.repeat(36);

describe('ccd/lib/transcript.jq ships', () => {
  it('deploy.sh installs it once, at 644, before the ccd that loads it', () => {
    const lines = code(read('deploy/deploy.sh'));
    const at = lines.filter((l) => l === `install_atomic ccd/lib/transcript.jq ${DEST} 644`);
    expect(at, 'one install line').toHaveLength(1);
    const lib = lines.indexOf(at[0]!);
    expect(lib, 'it lands before the pair').toBeLessThan(lines.indexOf('install_ccd_pair'));
    expect(lib).toBeGreaterThan(-1);
  });
  it('deploy.sh backs it up with the other helpers', () => {
    expect(read('deploy/deploy.sh')).toContain('~/.cc-sessions/lib/transcript.jq ~/ccrc-backups/$TS/transcript.jq');
  });
  it('ccrc install places it, ccrc update backs it up, ccrc uninstall removes it', () => {
    const src = read('ccd/ccrc');
    expect(src).toContain('_inst_atomic "$tree/ccd/lib/transcript.jq" "$HOME/.cc-sessions/lib/transcript.jq" 644');
    expect(src).toContain('_upd_backup_copy "$HOME/.cc-sessions/lib/transcript.jq" transcript.jq');
    expect(src).toContain('"$reg/lib/transcript.jq"');
  });
  it('ccd and the doctor look for it where the installers put it', () => {
    for (const rel of ['ccd/ccd', 'ccd/ccrc-doctor-checks']) {
      expect(read(rel), rel).toContain('TRANSCRIPT_JQ_LIB="$HOME/.cc-sessions/lib"');
    }
  });
});

describe('the lookup', () => {
  const run = (home: string): { rc: string; next: string } => {
    // The doctor file is copied alone into a directory with no `lib` beside it: the installed shape.
    const bin = mkTmp('tjq-bin-');
    fs.copyFileSync(path.join(REPO, 'ccd', 'ccrc-doctor-checks'), path.join(bin, 'ccrc-doctor-checks'));
    const f = path.join(bin, `${A}.jsonl`);
    fs.writeFileSync(f, JSON.stringify({ type: 'continued-in', sessionId: A, continuedInSessionId: B }) + '\n');
    const r = spawnSync('bash', ['-c', '. "$1"; _dr_continued_in "$2" "$3"; printf "%s|%s" "$?" "${_DR_CI_NEXT-}"', '_',
      path.join(bin, 'ccrc-doctor-checks'), f, A], { encoding: 'utf8', env: { ...process.env, HOME: home } });
    const [rc = '', next = ''] = r.stdout.split('|');
    return { rc, next };
  };
  it('an installed copy reads the module under $HOME/.cc-sessions/lib', () => {
    const home = mkTmp('tjq-home-');
    fs.mkdirSync(path.join(home, '.cc-sessions', 'lib'), { recursive: true });
    fs.copyFileSync(path.join(REPO, 'ccd', 'lib', 'transcript.jq'), path.join(home, DEST));
    expect(run(home)).toEqual({ rc: '0', next: B });
  });
  it('a box the module never reached answers NOT MEASURED (rc 2), never "not superseded"', () => {
    expect(run(mkTmp('tjq-home-')).rc).toBe('2');
  });
});
