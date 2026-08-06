// ws-hold / ws-release — a declared program claim on a workspace, under the
// isolated HOME harness. Adapted from the plan's sketch to the harness's real
// API: there is no `h.wsId`; the id is `${project}-${slug}`, exactly as
// ccd-archive.test.ts's own `workspace()` helper derives it (cmd_ws_add
// requires an existing project repo — `h.makeRepo` — and CCD_WS_SLUG pins the
// slug rather than letting `_ws_slug_new` pick one).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, WS_ADD, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-hold-'); });
afterEach(() => { h.cleanup(); });

const shFail = (snippet: string): { code: number; stderr: string } => {
  try { h.sh(snippet); return { code: 0, stderr: '' }; }
  catch (e) {
    const err = e as { status?: number; stderr?: Buffer };
    return { code: err.status ?? 1, stderr: String(err.stderr ?? '') };
  }
};

/** A real workspace, named `demo-quiet-basin` — same idiom as
 *  ccd-archive.test.ts's `workspace()`, trimmed to just the id since these
 *  tests never need the worktree path. */
const workspaceId = (): string => {
  h.makeRepo('demo');
  h.sh(`${WS_ADD} CCD_WS_SLUG=quiet-basin cmd_ws_add demo`);
  return 'demo-quiet-basin';
};

describe('ccd ws-hold / ws-release', () => {
  it('holds a workspace: writes the reason verbatim', () => {
    const id = workspaceId();
    const out = h.sh(`cmd_ws_hold --session ${id} --reason "program:agent-evals wave:1/4"`);
    expect(out).toContain(`held ${id}`);
    expect(fs.readFileSync(path.join(h.home, '.cc-sessions', `${id}.hold`), 'utf8'))
      .toBe('program:agent-evals wave:1/4');
  });

  it('re-hold updates the reason in place, exit 0', () => {
    const id = workspaceId();
    h.sh(`cmd_ws_hold --session ${id} --reason "wave:1/4"`);
    h.sh(`cmd_ws_hold --session ${id} --reason "wave:2/4"`);
    expect(fs.readFileSync(path.join(h.home, '.cc-sessions', `${id}.hold`), 'utf8')).toBe('wave:2/4');
  });

  it('release unlinks; releasing an unheld workspace is a no-op at exit 0', () => {
    const id = workspaceId();
    h.sh(`cmd_ws_hold --session ${id} --reason "w"`);
    expect(h.sh(`cmd_ws_release --session ${id}`)).toContain(`released ${id}`);
    expect(fs.existsSync(path.join(h.home, '.cc-sessions', `${id}.hold`))).toBe(false);
    expect(h.sh(`cmd_ws_release --session ${id}`)).toContain(`not held ${id}`);
  });

  it('refuses a main checkout — a hold there is a lie', () => {
    // A registry entry with no `workspace` field is a main checkout.
    h.sh(`mkdir -p "$HOME/.cc-sessions"
      printf u > "$HOME/.cc-sessions/claude-demo.uuid"
      printf claude > "$HOME/.cc-sessions/claude-demo.wrapper"`);
    const r = shFail(`cmd_ws_hold --session claude-demo --reason w`);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('not a workspace');
  });

  it('refuses an archived workspace — restore first', () => {
    const id = workspaceId();
    h.sh(`printf 1786000000 > "$HOME/.cc-sessions/${id}.archived"`);
    const r = shFail(`cmd_ws_hold --session ${id} --reason w`);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('archived');
  });

  it('refuses an empty reason — a hold nobody can explain is an orphan by construction', () => {
    const id = workspaceId();
    const r = shFail(`cmd_ws_hold --session ${id} --reason ""`);
    expect(r.code).not.toBe(0);
  });

  it('caps lists both verbs', () => {
    const caps = h.sh('cmd_caps');
    expect(caps).toContain('ws-hold');
    expect(caps).toContain('ws-release');
  });
});
