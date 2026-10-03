// `ccdArchiveRefusal` (workspace lifecycle spec §5.2) reads ccd's own `die` lines — so the lines it reads are produced
// HERE by the real `cmd_ws_archive`, under the isolated HOME harness, one per refusal the door names. A reworded ccd
// reds this file instead of silently losing its word on the phone. Fixture HOMEs only; tmux and systemd are shell
// stubs, as in `ccd-archive.test.ts`, whose shapes these are.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, WS_ADD, type CcdHarness } from './ccdWsHelpers.js';
import { ccdArchiveRefusal } from '../src/coord/archiveDoor.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-archwords-'); });
afterEach(() => { h.cleanup(); });

const ARCH = `_ws_unsupervise() { echo "unsupervise $1" >> "$HOME/ccd-calls"; };
  tmux() { echo "tmux $*" >> "$HOME/ccd-calls"; return 1; };
  _session_verdict() { echo gone; };`;
const LIVE = ARCH
  .replace('_session_verdict() { echo gone; };', '_session_verdict() { echo live; };')
  .replace('tmux() { echo "tmux $*" >> "$HOME/ccd-calls"; return 1; };',
    'tmux() { case "$1" in list-panes) echo 4242 ;; *) echo "tmux $*" >> "$HOME/ccd-calls" ;; esac; };');

/** ccd's stderr for a refused `cmd_ws_archive`. */
const refusal = (snippet: string): string => {
  try {
    h.sh(snippet);
  } catch (e) {
    return String((e as { stderr?: string }).stderr ?? '');
  }
  throw new Error('ws-archive did not refuse');
};

const workspace = (): string => {
  h.makeRepo('demo');
  h.sh(`${WS_ADD} CCD_WS_SLUG=quiet-basin cmd_ws_add demo`);
  return path.join(h.home, 'worktrees', 'demo', 'quiet-basin');
};

describe('ccd\'s ws-archive refusals, read back as the door\'s words', () => {
  it('a turn in progress is session-busy', () => {
    workspace();
    const cfg = path.join(h.home, '.claude', 'sessions');
    fs.mkdirSync(cfg, { recursive: true });
    fs.writeFileSync(path.join(cfg, '4242.json'), JSON.stringify({ status: 'busy', statusUpdatedAt: 1 }));
    expect(ccdArchiveRefusal(refusal(`${LIVE} cmd_ws_archive --session demo-quiet-basin`))).toBe('session-busy');
  });

  it('a live pane whose status cannot be read is status-unknown', () => {
    workspace();
    fs.mkdirSync(path.join(h.home, '.claude', 'sessions'), { recursive: true });
    expect(ccdArchiveRefusal(refusal(`${LIVE} cmd_ws_archive --session demo-quiet-basin`))).toBe('status-unknown');
  });

  it('a worktree that moved away is worktree-gone', () => {
    const wt = workspace();
    fs.renameSync(wt, `${wt}-moved`);
    expect(ccdArchiveRefusal(refusal(`${ARCH} cmd_ws_archive --session demo-quiet-basin`))).toBe('worktree-gone');
  });

  it('a tree ccd cannot describe truthfully is manifest-unbuildable', () => {
    const wt = workspace();
    fs.rmSync(wt, { recursive: true, force: true });
    fs.mkdirSync(wt, { recursive: true });
    h.git(wt, 'init', '-q', '-b', 'ws/quiet-basin');
    fs.writeFileSync(path.join(wt, 'stranger.txt'), 'x\n');
    h.git(wt, 'add', 'stranger.txt');
    h.git(wt, 'commit', '-qm', 'a stranger');
    expect(ccdArchiveRefusal(refusal(`${ARCH} cmd_ws_archive --session demo-quiet-basin`))).toBe('manifest-unbuildable');
  });

  it('an EMPTY manifest is manifest-unbuildable', () => {
    workspace();
    expect(ccdArchiveRefusal(refusal(`${ARCH} _ws_archive_manifest() { :; }; cmd_ws_archive --session demo-quiet-basin`)))
      .toBe('manifest-unbuildable');
  });

  it('a manifest that is not valid JSON is manifest-unbuildable', () => {
    workspace();
    expect(ccdArchiveRefusal(refusal(`${ARCH} _ws_archive_manifest() { echo '{"bytes": NaN}'; }; cmd_ws_archive --session demo-quiet-basin`)))
      .toBe('manifest-unbuildable');
  });

  it('CONTROL: a refusal the door has no word for stays wordless — the reader is not matching everything', () => {
    expect(ccdArchiveRefusal(refusal(`${ARCH} cmd_ws_archive --session ghost-session`))).toBeNull();
  });
});
