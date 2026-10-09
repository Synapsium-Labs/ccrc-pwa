// X1's ccd half (child reclamation wave 7, spec 2026-09-22 §5.5): the reclaim
// token binds the ROW'S GENERATION — `$REG/<id>.generation`, minted once by row
// creation (`cmd_ws_add`, before any row field), removed last by `_reg_purge`,
// and rewritten by nothing else — so a token `ws-audit --reclaim` minted over
// one row is never spent on a re-mint of the same id, even when every other
// input matches. `/clear` and a swap rewrite `uuid` and `wrapper`, never the
// generation, and spend normally. The audit prints the value as an additive
// `generation` key; the server reads the document absence-permits.
// FIXTURE HOME ONLY (`makePrHarness`): every registry path is under its HOME.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { GH_STUB, makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { CHILD_ID, CHILD_RUN, CHILD_STUBS, childReclaimVerb, evalOf, makeChild } from './childReclaimFixture.js';
import { verbHelpers } from './childReclaimVerbHelpers.js';
import { parseChildReclaimAudit } from '../src/coord/childReclaim.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-child-reclaim-row-generation-'); });
afterEach(() => { h.cleanup(); });
const { intact, refusedWith, interrupted, resumeToken } = verbHelpers(() => h);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const genFile = (): string => path.join(h.home, '.cc-sessions', `${CHILD_ID}.generation`);
/** The file's exact bytes — 36, no LF (`_reg_generation_valid`); never trimmed. */
const gen = (): string => fs.readFileSync(genFile(), 'utf8');
/** Under the compaction lock, as row creation and `cmd_ensure` take it around the mint. */
const locked = (body: string): void => {
  h.sh(`_compact_lock_acquire ${CHILD_ID} 5 || exit 9; ${body}; rc=$?; _compact_lock_release "$COMPACT_LOCK_FD"; exit $rc`);
};
/** A RE-MINT of this id's generation and of nothing else: `_reg_purge`'s
 *  unlink, then row creation's mint. A real same-run re-mint (`_reg_purge`,
 *  then `cmd_ws_add --child` on the recycled slug) also moves the worktree and
 *  the branch, which other token inputs already catch; the case the generation
 *  closes is the one where every other input matches, which is this one. */
const remint = (): void => { locked(`rm -f "$REG/${CHILD_ID}.generation" && _reg_generation_init ${CHILD_ID}`); };
/** What `/clear` writes to the row (`_sync_uuid`: a new `uuid`), what a swap
 *  writes (`cmd_swap`: `wrapper`, `lastswap`), and a respawn's re-init
 *  (`cmd_ensure`, `cmd_ws_restore`: `_reg_generation_init`, idempotent). */
const clearAndSwap = (): void => {
  const other = h.reg(CHILD_ID, 'wrapper') === 'claude' ? 'claude-a' : 'claude';
  h.sh(`_reg_set ${CHILD_ID} uuid "$(_plat_uuid)" && _reg_set ${CHILD_ID} wrapper ${other}`
    + ` && _reg_set ${CHILD_ID} lastswap "$(date +%s)"`);
  locked(`_reg_generation_init ${CHILD_ID}`);
};
/** `_ws_reclaim_fingerprint` redefined to write its inputs, answering the same
 *  hash (`ccd-child-reclaim-gone-branch.test.ts`'s device). */
const FP_CAPTURE = '_ws_reclaim_fingerprint() { printf \'%s\\n\' "$@" > "$HOME/fp-inputs";'
  + ' printf \'%s\\n\' "$@" | _plat_sha256 | cut -d\' \' -f1; };';
const fpInputs = (): string[] => fs.readFileSync(path.join(h.home, 'fp-inputs'), 'utf8').split('\n').filter(Boolean);
/** The token the ladder minted BEFORE this wave: the same inputs, less the generation. */
const PRE_WAVE7_FP = '_ws_reclaim_fingerprint() { local a=() x; for x in "$@"; do [[ "$x" == generation=* ]] || a+=("$x"); done;'
  + ' printf \'%s\\n\' "${a[@]}" | _plat_sha256 | cut -d\' \' -f1; };';
const AUDIT_STUBS = `${CHILD_STUBS} _session_verdict() { echo gone; }; ${GH_STUB}`;
const auditRun = (): { code: number; stdout: string; stderr: string } =>
  h.run(`${AUDIT_STUBS} cmd_ws_audit --session ${CHILD_ID} --reclaim`);
const auditDoc = (): Record<string, unknown> => {
  const r = auditRun();
  expect(r.code, r.stdout + r.stderr).toBe(0);
  return JSON.parse(r.stdout.trim()) as Record<string, unknown>;
};

describe('the value — minted with the row, rotated by nothing but a purge and a re-mint (Task 0, measured)', () => {
  it('ws-add mints it; /clear, a swap and a respawn leave it; the purge removes it; a re-mint is a new value', () => {
    makeChild(h);
    const g0 = gen();
    expect(g0, 'the real ws-add minted one, exactly the grammar').toMatch(UUID);
    expect(g0).toHaveLength(36);
    clearAndSwap();
    expect(gen(), '/clear, a swap and a respawn re-init rotate nothing').toBe(g0);
    h.sh(`_reg_purge ${CHILD_ID} || true`);
    expect(fs.existsSync(genFile()), 'the purge takes it with the row').toBe(false);
    locked(`_reg_generation_init ${CHILD_ID}`);
    expect(gen()).toMatch(UUID);
    expect(gen(), 'the next row of this id is a new generation').not.toBe(g0);
  }, 90_000);
});

describe('the token binds it', () => {
  it('the present arm and the resume take it as an input, exactly once, and it is the file’s value', () => {
    const c = makeChild(h);
    expect(evalOf(h, { pre: FP_CAPTURE }).verdict).toBe('reclaimable');
    expect(fpInputs().filter((l) => l.startsWith('generation=')), 'the present arm').toEqual([`generation=${gen()}`]);
    interrupted(c, 'worktree');
    h.sh(`${CHILD_STUBS} ${FP_CAPTURE} _ws_reclaim_resume_eval ${CHILD_ID} 0 ${CHILD_RUN} worktree >/dev/null`);
    expect(fpInputs()[0], 'the CONTROL: this was the resume token').toBe('mode=reclaim-resume');
    expect(fpInputs().filter((l) => l.startsWith('generation=')), 'the resume').toEqual([`generation=${gen()}`]);
  }, 90_000);

  it('the vanished arm takes it too — through the same binding', () => {
    const c = makeChild(h);
    h.git(c.main, 'worktree', 'remove', '--force', c.wt);
    const e = evalOf(h, { pre: FP_CAPTURE });
    expect(e.verdict, e.detail).toBe('reclaimable');
    expect(fpInputs()).toContain('worktree=absent');
    expect(fpInputs().filter((l) => l.startsWith('generation='))).toEqual([`generation=${gen()}`]);
  }, 90_000);

  it('a re-mint between the audit and the spend refuses state-changed, and touches nothing', () => {
    const c = makeChild(h);
    const a = auditDoc();
    expect(a['verdict']).toBe('reclaimable');
    const g0 = gen();
    expect(a['generation'], 'the audit says which row it minted over').toBe(g0);
    remint();
    expect(gen(), 'the CONTROL: the re-mint is a new value').not.toBe(g0);
    expect(refusedWith(childReclaimVerb(h, String(a['token'])))).toBe('state-changed');
    intact(c);
    // The CONTROL: a fresh audit over the re-minted row mints another token, which spends.
    const b = auditDoc();
    expect(b['generation']).toBe(gen());
    expect(b['token']).not.toBe(a['token']);
    const r = childReclaimVerb(h, String(b['token']));
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(JSON.parse(r.stdout).reclaimed).toBe(CHILD_ID);
  }, 120_000);

  it('/clear, a swap and a respawn between the audit and the spend do NOT refuse — the generation is not the uuid', () => {
    makeChild(h);
    const a = auditDoc();
    const u0 = h.reg(CHILD_ID, 'uuid');
    clearAndSwap();
    expect(h.reg(CHILD_ID, 'uuid'), 'the CONTROL: /clear rotated the uuid').not.toBe(u0);
    expect(gen(), 'and not the generation').toBe(a['generation']);
    const r = childReclaimVerb(h, String(a['token']));
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(JSON.parse(r.stdout).reclaimed).toBe(CHILD_ID);
  }, 120_000);

  it('a resume token is bound too: a re-mint under a reclaim: breadcrumb refuses state-changed', () => {
    const c = makeChild(h);
    interrupted(c, 'worktree');
    const tok = resumeToken('worktree');
    remint();
    expect(refusedWith(childReclaimVerb(h, tok))).toBe('state-changed');
    expect(h.reg(CHILD_ID, 'reaping'), 'the breadcrumb stands').toBe('reclaim:worktree');
    intact(c);
    const r = childReclaimVerb(h, resumeToken('worktree'));
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(JSON.parse(r.stdout).reclaimed, 'the CONTROL: a resume token over the standing row spends').toBe(CHILD_ID);
  }, 120_000);

  it('an old-format token — minted before this wave, with no generation input — is refused as stale (state-changed), never accepted', () => {
    const c = makeChild(h);
    const old = evalOf(h, { pre: PRE_WAVE7_FP });
    const cur = evalOf(h);
    expect(old.verdict).toBe('reclaimable');
    expect(old.token).toMatch(/^[0-9a-f]{64}$/);
    expect(old.token, 'the stub drops exactly the generation; without it in the binding the two are one token').not.toBe(cur.token);
    expect(refusedWith(childReclaimVerb(h, old.token))).toBe('state-changed');
    intact(c);
  }, 90_000);
});

describe('no generation, no token', () => {
  it('an absent or malformed generation is unmeasured — never a token, never a terminal word; the audit says null and exits 1', () => {
    const c = makeChild(h);
    const good = gen();
    fs.rmSync(genFile());
    const e = evalOf(h);
    expect(e.verdict).toBe('unmeasured');
    expect(e.token).toBe('');
    expect(e.detail).toContain(`${CHILD_ID}.generation`);
    const r = auditRun();
    expect(r.code, r.stdout).toBe(1);
    const d = JSON.parse(r.stdout.trim()) as Record<string, unknown>;
    expect(d['verdict']).toBe('unmeasured');
    expect(d['generation']).toBeNull();
    expect(d['token']).toBeUndefined();
    fs.writeFileSync(genFile(), `${good}\n`);   // 37 bytes: present, and not the grammar
    expect(evalOf(h).verdict, 'a malformed generation').toBe('unmeasured');
    fs.writeFileSync(genFile(), good);
    interrupted(c, 'worktree');
    fs.rmSync(genFile());
    const v = h.sh(`${CHILD_STUBS} _ws_reclaim_resume_eval ${CHILD_ID} 0 ${CHILD_RUN} worktree >/dev/null;`
      + ' printf \'%s\\x1f%s\' "$REAP_VERDICT" "$REAP_TOKEN"');
    expect(v.split('\x1f'), 'the resume mints none either').toEqual(['unmeasured', '']);
  }, 120_000);

  it('every reclaim document says generation: the value on a measured row, null where rungs 1-2 refused first; no value leaks', () => {
    makeChild(h);
    const a = auditDoc();
    expect(Object.keys(a)).toContain('generation');
    expect(a['generation']).toBe(gen());
    expect(h.sh(`${CHILD_STUBS} _ws_reclaim_eval ${CHILD_ID} 0 '' >/dev/null; _ws_reclaim_eval demo-no-such-row 0 '' >/dev/null;`
      + ' printf \'[%s]\' "$RECLAIM_GENERATION"'), 'a refused eval never carries the last row’s value').toBe('[]');
    fs.rmSync(path.join(h.home, '.cc-sessions', `${CHILD_ID}.child`));
    const r = auditDoc();
    expect(r['verdict']).toBe('not-a-child');
    expect(r['generation']).toBeNull();
  }, 90_000);
});

describe('the read runs under the row\'s compaction lock, as every other generation read does', () => {
  /** The lock HELD by this same shell on its own descriptor: a second acquire
   *  opens another, which `flock` refuses until the wait runs out. */
  const HOLD = `COMPACT_LOCK_WAIT=1; _compact_lock_acquire ${CHILD_ID} 1 || exit 9; held="$COMPACT_LOCK_FD";`;
  const lockFile = (): string => path.join(h.home, '.cc-sessions', `.${CHILD_ID}.compactions.lock`);

  it('a held lock is a read that did not run: unmeasured, no token, the detail names the acquire — fresh and resume', () => {
    const c = makeChild(h);
    expect(evalOf(h, { pre: 'COMPACT_LOCK_WAIT=1;' }).verdict, 'the CONTROL: unheld, the same eval mints').toBe('reclaimable');
    const e = evalOf(h, { pre: HOLD });
    expect(e.verdict).toBe('unmeasured');
    expect(e.token).toBe('');
    expect(e.detail).toContain(`${CHILD_ID}.generation`);
    expect(e.detail).toContain('_compact_lock_acquire rc 1');
    interrupted(c, 'worktree');
    const v = h.sh(`${CHILD_STUBS} ${HOLD} _ws_reclaim_resume_eval ${CHILD_ID} 0 ${CHILD_RUN} worktree >/dev/null;`
      + ' printf \'%s\\x1f%s\\x1f%s\' "$REAP_VERDICT" "$REAP_TOKEN" "$REAP_DETAIL"').split('\x1f');
    expect(v.slice(0, 2), 'the resume mints none either').toEqual(['unmeasured', '']);
    expect(v[2]).toContain('_compact_lock_acquire rc 1');
  }, 90_000);

  it('the acquire\'s reason rides the detail, and the lock is released once the read is done', () => {
    makeChild(h);
    expect(h.sh(`${CHILD_STUBS} _ws_reclaim_eval ${CHILD_ID} 0 '' >/dev/null; printf '%s' "$REAP_VERDICT";`
      + ` _compact_lock_acquire ${CHILD_ID} 0 && printf ' released'`), 'a fresh acquire in the same shell, no wait')
      .toBe('reclaimable released');
    fs.rmSync(lockFile());
    fs.mkdirSync(lockFile());
    const e = evalOf(h);
    expect(e.verdict).toBe('unmeasured');
    expect(e.detail).toContain('(lock-path-occupied)');
  }, 90_000);

  it('a read that FAILED releases the lock too: an absent generation is rc 2, and the next acquire in the same shell takes it', () => {
    makeChild(h);
    fs.rmSync(genFile());
    expect(h.sh(`_ws_reclaim_generation ${CHILD_ID}; printf '%s' "$?";`
      + ` if _compact_lock_acquire ${CHILD_ID} 0; then printf ' released'; else printf ' held'; fi`), 'a fresh acquire in the same shell, no wait')
      .toBe('2 released');
  }, 90_000);
});

describe('the server reads the additive key absence-permits', () => {
  const TOK = 'a'.repeat(64);
  const base = { id: CHILD_ID, mode: 'reclaim', childOf: CHILD_RUN };
  it('parseChildReclaimAudit answers the same with the key, with null, and without it (an older ccd)', () => {
    const want = { kind: 'token', token: TOK, childOf: CHILD_RUN };
    for (const extra of [{}, { generation: '0123abcd-0123-4567-89ab-0123456789ab' }, { generation: null }]) {
      expect(parseChildReclaimAudit(CHILD_ID, JSON.stringify({ ...base, ...extra, verdict: 'reclaimable', detail: '', token: TOK })))
        .toEqual(want);
    }
    expect(parseChildReclaimAudit(CHILD_ID, JSON.stringify({ ...base, generation: null, verdict: 'not-a-child', detail: 'd' })))
      .toEqual({ kind: 'refused', token: 'not-a-child', detail: 'd' });
  });

  it('this build’s own document parses to its token', () => {
    makeChild(h);
    const out = auditRun().stdout.trim();
    expect(parseChildReclaimAudit(CHILD_ID, out))
      .toEqual({ kind: 'token', token: (JSON.parse(out) as { token: string }).token, childOf: CHILD_RUN });
  }, 60_000);
});
