// `ws-archive --if-no-pane` and `--reason stale` (fleet disk retention, spec 2026-10-23 section 2.7.5): the stale-archive
// arm's act. The flag refuses `live`, before anything is written, when a tmux session for the id exists or its unit answers
// anything but `inactive`/`failed`; the reason word `stale` is what lands in `.archivedreason`. FIXTURE HOME ONLY: tmux
// and the unit probe are shell stubs, and nothing here reaches a live box.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, WS_ADD, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-nopane-'); });
afterEach(() => { h.cleanup(); });

/** The substrate stubs. `probe` is `_session_probe`'s verdict (live|gone|unknown), `unit` the word `_svc_is_active` prints. */
const STUBS = (probe: string, unit: string): string => `_ws_unsupervise() { echo "unsupervise $1" >> "$HOME/ccd-calls"; };
  tmux() { echo "tmux $*" >> "$HOME/ccd-calls"; return 1; };
  _session_probe() { PROBE_VERDICT=${probe}; PROBE_DETAIL=""; PROBE_SUBSTRATE=present; return 0; };
  _svc_is_active() { printf '%s' '${unit}'; };
  _session_verdict() { echo gone; };`;

const shFail = (snippet: string): { code: number; stdout: string; stderr: string } => {
  try { return { code: 0, stdout: h.sh(snippet), stderr: '' }; }
  catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? 1, stdout: String(err.stdout ?? ''), stderr: String(err.stderr ?? '') };
  }
};

const ID = 'demo-quiet-basin';
const workspace = (): void => {
  h.makeRepo('demo');
  h.sh(`${WS_ADD} CCD_WS_SLUG=quiet-basin cmd_ws_add demo`);
};
const archive = (probe: string, unit: string, flags: string): ReturnType<typeof shFail> =>
  shFail(`${STUBS(probe, unit)} cmd_ws_archive ${flags} --session ${ID}`);
const touched = (): boolean =>
  ['archived', 'archivedreason', 'archivemanifest'].some((f) => fs.existsSync(path.join(h.home, '.cc-sessions', `${ID}.${f}`)));
const calls = (): string => { try { return fs.readFileSync(path.join(h.home, 'ccd-calls'), 'utf8'); } catch { return ''; } };

describe('ws-archive --if-no-pane', () => {
  it('archives a workspace with no pane and an inactive unit, and records the reason stale', () => {
    workspace();
    const r = archive('gone', 'inactive', '--if-no-pane --reason stale');
    expect(r.code).toBe(0);
    expect(r.stdout).toContain(`archived ${ID}`);
    expect(h.reg(ID, 'archivedreason')).toBe('stale');
    expect(fs.existsSync(path.join(h.home, '.cc-sessions', `${ID}.archived`))).toBe(true);
  });

  it('a failed unit does not hold the archive back', () => {
    workspace();
    expect(archive('gone', 'failed', '--if-no-pane --reason stale').code).toBe(0);
    expect(h.reg(ID, 'archivedreason')).toBe('stale');
  });

  it('refuses live when a pane is up, and writes nothing and kills nothing', () => {
    workspace();
    const r = archive('live', 'inactive', '--if-no-pane --reason stale');
    expect(r.code).not.toBe(0);
    expect(r.stderr).toMatch(/live/);
    expect(touched()).toBe(false);
    expect(calls()).not.toMatch(/kill-session|unsupervise/);
  });

  it.each(['active', 'activating', 'deactivating', 'reloading', ''])('refuses live when the unit answers %j', (unit) => {
    workspace();
    const r = archive('gone', unit, '--if-no-pane --reason stale');
    expect(r.code).not.toBe(0);
    expect(r.stderr).toMatch(/live/);
    expect(touched()).toBe(false);
  });

  it('an unanswered tmux probe is kept too (fail toward keeping)', () => {
    workspace();
    const r = archive('unknown', 'inactive', '--if-no-pane --reason stale');
    expect(r.code).not.toBe(0);
    expect(r.stderr).toMatch(/live/);
    expect(touched()).toBe(false);
  });

  it('without the flag the verb is as it was: a live pane is not refused as live, and the reason is the usual word', () => {
    workspace();
    const r = archive('live', 'active', '');
    expect(r.stderr).not.toMatch(/\blive\b/);
    expect(r.code).toBe(0);
    expect(h.reg(ID, 'archivedreason')).toBe('empty');
  });

  it('a reason other than stale stays a trail word and never becomes archivedreason', () => {
    workspace();
    expect(archive('gone', 'inactive', '--if-no-pane --reason sweep').code).toBe(0);
    expect(h.reg(ID, 'archivedreason')).toBe('empty');
  });

  it('--reason stale without the flag still records stale (the reason word is its own switch)', () => {
    workspace();
    expect(archive('live', 'active', '--reason stale').code).toBe(0);
    expect(h.reg(ID, 'archivedreason')).toBe('stale');
  });

  it('an already archived workspace answers as before, even with a pane up', () => {
    workspace();
    expect(archive('gone', 'inactive', '').code).toBe(0);
    const r = archive('live', 'active', '--if-no-pane --reason stale');
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('already archived');
  });
});

describe('ccd caps', () => {
  it('advertises archive-if-no-pane-v1 once', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'ccd', 'ccd'), 'utf8');
    expect(src.match(/echo archive-if-no-pane-v1/g)?.length).toBe(1);
  });
});
