// The tail's done DOCUMENT says what it kept (child reclamation wave 6, spec
// §5.6). The reclaim and expiry tail is one tail and prints one done
// document on stdout, for both verbs. A leaf it does not remove is KEPT and
// recorded on the journal's done row (`meas.clipsKept`, `meas.tmpRootKept`);
// the document now carries the same two words, additively: `clipsKept` and
// `tmpRootKept`, each `refused`, `unmeasured` or `in-use`, or `null` when
// nothing was kept. A document from an older ccd omits both keys, and a reader
// takes that absence as unmeasured, never as gone. No server reader reads them
// in this wave: both parsers read named keys only.
// FIXTURE HOMES ONLY (`makePrHarness`): the unit and the pane are stubbed
// (`CHILD_STUBS`); the in-use probe and the leaf helper's owner and `rm` are
// shadowed by shell functions for the one call; nothing runs against the live HOME.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { eventsOf, measOf } from './lifecycleHelpers.js';
import { CHILD_ID, childReclaimVerb, evalOf, makeChild } from './childReclaimFixture.js';
import { EXP_ID, expireToken, expireVerb, makeArchived } from './wsExpireFixture.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-done-kept-'); });
afterEach(() => { h.cleanup(); });

type Doc = Record<string, unknown>;
const plantClips = (id: string): string => {
  const d = path.join(h.home, '.cc-clips', id);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'shot.png'), 'png');
  return d;
};
const plantTmp = (id: string): string => {
  const d = path.join(h.home, '.cc-tmp', id);
  fs.mkdirSync(path.join(d, 'cdk.out'), { recursive: true });
  return d;
};
const doneRow = (act: string): Record<string, unknown> => eventsOf(h.home, act).find((e) => e['outcome'] === 'done')!;

/** The clips leaf belongs to another uid: the helper refuses it. */
const CLIPS_NOT_OURS = '_ws_leaf_uid() { case "$1" in */.cc-clips/*) echo 999999 ;; *)'
  + ' if [[ "$CCD_OS" == darwin ]]; then stat -f %u "$1"; else stat -c %u "$1"; fi ;; esac; };';
/** `rm` fails on the clips leaf only: the helper answers unmeasured. */
const CLIPS_RM_FAILS = 'rm() { if [[ "$1" == -rf* && "$*" == *"/.cc-clips/"* ]]; then'
  + ' echo "rm: cannot remove: Device or resource busy" >&2; return 1; fi; command rm "$@"; };';
const TMP_IN_USE = 'CCD_RECLAIM_TMPROOT_WAIT_S=0; _ws_path_users() { _WS_PATH_USERS_PIDS=4242; _WS_PATH_USERS_WHY="stub: in use"; return 1; };';
const TMP_UNMEASURED = 'CCD_RECLAIM_TMPROOT_WAIT_S=0; _ws_path_users() { _WS_PATH_USERS_PIDS=""; _WS_PATH_USERS_WHY="stub: not measured"; return 2; };';
const NOBODY = '_ws_path_users() { _WS_PATH_USERS_PIDS=""; _WS_PATH_USERS_WHY=""; return 0; };';

/** The document's two kept keys, and the journal's — they must say the same. */
const kept = (doc: Doc, act: string): void => {
  const meas = measOf(doneRow(act));
  expect(doc['clipsKept'] ?? null, 'clipsKept agrees with the done row').toBe(meas['clipsKept'] ?? null);
  expect(doc['tmpRootKept'] ?? null, 'tmpRootKept agrees with the done row').toBe(meas['tmpRootKept'] ?? null);
};

describe('ws-reclaim’s done document carries clipsKept and tmpRootKept', () => {
  it('a refused clips leaf and a temp root in use: `refused` and `in-use`, as JSON strings', () => {
    makeChild(h);
    const clips = plantClips(CHILD_ID);
    const tmp = plantTmp(CHILD_ID);
    const r = childReclaimVerb(h, evalOf(h).token, { pre: `${CLIPS_NOT_OURS} ${TMP_IN_USE}` });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const doc = JSON.parse(r.stdout) as Doc;
    expect(doc['reclaimed']).toBe(CHILD_ID);
    expect(doc['clipsKept']).toBe('refused');
    expect(doc['tmpRootKept']).toBe('in-use');
    expect(r.stdout, 'each word a JSON string').toContain('"clipsKept":"refused","tmpRootKept":"in-use"');
    expect(fs.existsSync(path.join(clips, 'shot.png')), 'the CONTROL: the clips leaf was kept').toBe(true);
    expect(fs.existsSync(path.join(tmp, 'cdk.out')), 'the CONTROL: the temp root was kept').toBe(true);
    kept(doc, 'reclaim');
  }, 90_000);

  it('both leaves gone: both keys PRESENT, and null', () => {
    makeChild(h);
    const clips = plantClips(CHILD_ID);
    const tmp = plantTmp(CHILD_ID);
    const r = childReclaimVerb(h, evalOf(h).token, { pre: NOBODY });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const doc = JSON.parse(r.stdout) as Doc;
    expect(doc['reclaimed']).toBe(CHILD_ID);
    expect(Object.keys(doc)).toEqual(expect.arrayContaining(['clipsKept', 'tmpRootKept']));
    expect(doc['clipsKept']).toBeNull();
    expect(doc['tmpRootKept']).toBeNull();
    expect(fs.existsSync(clips), 'the CONTROL: the clips leaf went').toBe(false);
    expect(fs.existsSync(tmp), 'the CONTROL: the temp root went').toBe(false);
    kept(doc, 'reclaim');
  }, 90_000);
});

describe('ws-expire’s done document — the same printf — carries them too', () => {
  it('an rm that fails on the clips leaf and a probe that cannot measure: `unmeasured` twice', () => {
    makeArchived(h);
    const clips = plantClips(EXP_ID);
    const tmp = plantTmp(EXP_ID);
    const r = expireVerb(h, expireToken(h), { pre: `${CLIPS_RM_FAILS} ${TMP_UNMEASURED}` });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const doc = JSON.parse(r.stdout) as Doc;
    expect(doc['expired']).toBe(EXP_ID);
    expect(doc['clipsKept']).toBe('unmeasured');
    expect(doc['tmpRootKept']).toBe('unmeasured');
    expect(fs.existsSync(path.join(clips, 'shot.png')), 'the CONTROL: the clips leaf was kept').toBe(true);
    expect(fs.existsSync(path.join(tmp, 'cdk.out')), 'the CONTROL: the temp root was kept').toBe(true);
    kept(doc, 'expire');
  }, 90_000);

  it('a refused clips leaf and a temp root in use: `refused` and `in-use`', () => {
    makeArchived(h);
    plantClips(EXP_ID);
    plantTmp(EXP_ID);
    const r = expireVerb(h, expireToken(h), { pre: `${CLIPS_NOT_OURS} ${TMP_IN_USE}` });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const doc = JSON.parse(r.stdout) as Doc;
    expect(doc['expired']).toBe(EXP_ID);
    expect(doc['clipsKept']).toBe('refused');
    expect(doc['tmpRootKept']).toBe('in-use');
    kept(doc, 'expire');
  }, 90_000);

  it('both leaves gone: both keys present, and null', () => {
    makeArchived(h);
    plantClips(EXP_ID);
    plantTmp(EXP_ID);
    const r = expireVerb(h, expireToken(h), { pre: NOBODY });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const doc = JSON.parse(r.stdout) as Doc;
    expect(doc['expired']).toBe(EXP_ID);
    expect(Object.keys(doc)).toEqual(expect.arrayContaining(['clipsKept', 'tmpRootKept']));
    expect(doc['clipsKept']).toBeNull();
    expect(doc['tmpRootKept']).toBeNull();
    kept(doc, 'expire');
  }, 90_000);
});

describe('a kept word never reads as null — it is printed without python, and an encoder that fails changes nothing', () => {
  /** The encoder the kept words once went through (`_json_str`, one python3 call) FAILS when the tail asks it to
   *  encode one of them; every other call — the id, the wip, the journal's — is the real one. */
  const ENCODER_FAILS = 'eval "_t_json_real()$(declare -f _json_str | tail -n +2)";'
    + ' _json_str() { if [[ "${FUNCNAME[1]-}" == _ws_reclaim_tail ]]; then case "${1-}" in refused|unmeasured|in-use)'
    + ' echo "encoder-failed $1" >> "$HOME/encoder-fails"; return 1 ;; esac; fi; _t_json_real "$@"; };';

  it('reclaim: both leaves kept, the encoder failing for their words — `refused` and `in-use` still, never null', () => {
    makeChild(h);
    plantClips(CHILD_ID);
    plantTmp(CHILD_ID);
    const r = childReclaimVerb(h, evalOf(h).token, { pre: `${CLIPS_NOT_OURS} ${TMP_IN_USE} ${ENCODER_FAILS}` });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const doc = JSON.parse(r.stdout) as Doc;
    expect(doc['reclaimed']).toBe(CHILD_ID);
    expect(doc['clipsKept'], 'a kept clips leaf never reads as nothing kept').toBe('refused');
    expect(doc['tmpRootKept'], 'a kept temp root never reads as nothing kept').toBe('in-use');
    kept(doc, 'reclaim');
  }, 90_000);

  it('expire: both leaves kept unmeasured, the encoder failing — `unmeasured` twice, never null', () => {
    makeArchived(h);
    plantClips(EXP_ID);
    plantTmp(EXP_ID);
    const r = expireVerb(h, expireToken(h), { pre: `${CLIPS_RM_FAILS} ${TMP_UNMEASURED} ${ENCODER_FAILS}` });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const doc = JSON.parse(r.stdout) as Doc;
    expect(doc['expired']).toBe(EXP_ID);
    expect(doc['clipsKept']).toBe('unmeasured');
    expect(doc['tmpRootKept']).toBe('unmeasured');
    kept(doc, 'expire');
  }, 90_000);

  it('a word outside the three — a value no arm names — prints `unmeasured`, never null', () => {
    makeChild(h);
    plantClips(CHILD_ID);
    plantTmp(CHILD_ID);
    // The temp root's kept word is replaced, after step (6) set it and before the document is printed, by a
    // value no arm names: the residue patch runs in the tail's own shell, so a function it calls can reach the
    // tail's local.
    const odd = 'eval "_t_patch_real()$(declare -f _ws_tombstone_patch | tail -n +2)";'
      + ' _ws_tombstone_patch() { [[ "${FUNCNAME[1]-}" == _ws_reclaim_tail && "${2-}" == *residueBytes* ]] && tmpkept=odd-word; _t_patch_real "$@"; };';
    const r = childReclaimVerb(h, evalOf(h).token, { pre: `${CLIPS_NOT_OURS} ${TMP_IN_USE} ${odd}` });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const doc = JSON.parse(r.stdout) as Doc;
    expect(doc['clipsKept']).toBe('refused');
    expect(measOf(doneRow('reclaim'))['tmpRootKept'], 'the CONTROL: the tail carried the odd word').toBe('odd-word');
    expect(doc['tmpRootKept'], 'an unnamed value is unmeasured, never nothing kept').toBe('unmeasured');
  }, 90_000);
});
