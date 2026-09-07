// `$REG/<account>-authdead` is the account-health probe's durable verdict, in the
// tree's one fault format — `"<epoch> <reason>"`, the shape `swapblocked` already
// uses (ccd/ccd:13599). This file pins the READER and the NAMESPACE; the two
// placement consumers are pinned in the describes Task 2 adds below.
//
// THE DIGITS GATE IS NOT COSMETIC. ccd runs under `set -u`, and every reader of a
// stamped marker in this file validates the epoch as digits BEFORE any arithmetic
// touches it (`_auto_swap_check`'s `bts`, ccd/ccd:11909) — a hand-edited or
// half-written field otherwise emits an unbound-variable line on every supervise
// tick. `_authdead` is a predicate rather than an arithmetic reader, so the gate
// buys something else here: it is what makes a TRUNCATED marker read as "no
// verdict" instead of as a verdict nobody wrote.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;
let home: string;

const sh = (s: string, env: NodeJS.ProcessEnv = {}): string => h.sh(s, env);
const ok = (snippet: string): boolean => sh(`${snippet} && echo yes || echo no`) === 'yes';
const marker = (w: string): string => path.join(home, '.cc-sessions', `${w}-authdead`);
const mark = (w: string, body: string): void => fs.writeFileSync(marker(w), body);

beforeEach(() => { h = makeCcdHarness('ccrc-ccd-authdead-'); home = h.home; });
afterEach(() => { h.cleanup(); });

describe('_authdead', () => {
  it('is false when no marker exists', () => {
    expect(ok('_authdead claude')).toBe(false);
  });

  it('is true for the shipped format, "<epoch> <reason>"', () => {
    mark('claude', '1757203200 auth-401');
    expect(ok('_authdead claude')).toBe(true);
  });

  it('is true for a bare epoch with no reason — the reason is a note, the stamp is the fact', () => {
    mark('claude', '1757203200');
    expect(ok('_authdead claude')).toBe(true);
  });

  it('is FALSE for an empty file — a marker nobody finished writing is not a verdict', () => {
    mark('claude', '');
    expect(ok('_authdead claude')).toBe(false);
  });

  it('is FALSE when the first field is not digits', () => {
    mark('claude', 'yesterday auth-401');
    expect(ok('_authdead claude')).toBe(false);
  });

  it('answers per account, never fleet-wide', () => {
    mark('claude-a', '1757203200 auth-401');
    expect(ok('_authdead claude-a')).toBe(true);
    expect(ok('_authdead claude')).toBe(false);
    expect(ok('_authdead claude-b')).toBe(false);
  });

  it('prints nothing on either path — it is a predicate, not a reader', () => {
    mark('claude', '1757203200 auth-401');
    expect(sh('_authdead claude; _authdead claude-b; echo END')).toBe('END');
  });
});

describe('the marker is DOTLESS, so no registry glob can eat it', () => {
  // Every registry glob in ccd is suffix-shaped and runs the same one-dot rule
  // (`[[ "$suffix" == *.* ]] && continue`) at THREE sites: `_reg_purge`
  // (ccd/ccd:1656), `_ws_slug_free` (:3757) and `_ws_slug_residue` (:3768). All
  // three glob `"$REG/$id".*`, which requires a literal dot AFTER the id — so a
  // dotless `<account>-authdead` is invisible to them even when a session id
  // collides with it byte for byte. Asserted rather than assumed, because the
  // collision is what a per-account marker in the session namespace risks and it
  // is exactly the class `_reg_purge`'s own header records as measured.
  it('survives _reg_purge of a session whose id IS the marker name', () => {
    const reg = path.join(home, '.cc-sessions');
    mark('claude-authdead', '1757203200 auth-401');
    fs.writeFileSync(path.join(reg, 'claude-authdead.uuid'), 'u\n');
    fs.writeFileSync(path.join(reg, 'claude-authdead.wrapper'), 'claude\n');
    sh('_reg_purge claude-authdead');
    expect(fs.existsSync(path.join(reg, 'claude-authdead.uuid')), 'the session row survived').toBe(false);
    expect(fs.existsSync(marker('claude-authdead')), 'the marker was swept').toBe(true);
  });

  it('does not make a colliding slug read as occupied', () => {
    // The other direction of the same rule: `_ws_slug_free` must not see the
    // dotless marker either, or the marker would wedge a slug forever.
    mark('demo-quiet', '1757203200 auth-401');
    expect(ok('_ws_slug_free demo quiet')).toBe(true);
  });
});
