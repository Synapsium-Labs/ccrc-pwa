// `ws-collect`, the temp-root collector's destructive verb (child reclamation wave 7, spec §5.10), end to end: a
// collection's whole order, the consent re-proved inside the reap lock, the pause read inside that lock, the
// population check that keeps it from ever taking a lock for a foreign name (spec §5.2's witnessed population), its
// argv, and off Linux. Every case builds a witnessed orphan in a FIXTURE HOME and runs the SOURCED verb; what is
// asserted is what stands on disk and in the journal afterwards, never the verb's word alone.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { CCD } from './ccdWsHelpers.js';
import { decOf, eventsOf } from './lifecycleHelpers.js';
import { LC_REFUSAL_WORD, isLcRefusalToken } from '../../shared/api.js';
import {
  COL_ID, GAP_LOG, IDLE_FLOOR_SEAM, WRONG_TOKEN, collectAudit, collectToken, collectVerb, crashAt, docOf, evalSays,
  gapAt, gaps, inoAt, leafOf, makeOrphan, quarantineOf, records, recordsDir, regOf, slots, witnessOf, type Run,
} from './wsCollectFixture.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-ws-collect-verb-'); });
afterEach(() => { h.cleanup(); });

const LINUX = process.platform === 'linux';
const ROOT = process.getuid?.() === 0;
const auditDoc = (): Record<string, unknown> =>
  JSON.parse(collectAudit(h).stdout.trim().split('\n').pop() || '{}') as Record<string, unknown>;
const rows = (): unknown[][] => eventsOf(h.home, 'collect').map((e) => [e['outcome'], e['refusal'] ?? null]);

describe.skipIf(!LINUX)('a collection, end to end', () => {
  it('the CONTROLS: this box’s mv offers --no-copy, and the evaluation leaves the witness it bound in the current shell', () => {
    expect(h.sh('LC_ALL=C mv --help'), 'without it every case below refuses for the wrong reason').toContain('--no-copy');
    const o = makeOrphan(h);
    expect(h.sh(`${IDLE_FLOOR_SEAM} exec 9>>"$REG/.reap-${COL_ID}.lock"; _ws_collect_fork ${COL_ID} >/dev/null;`
      + ' printf \'%s|%s|%s|%s\' "$REAP_VERDICT" "$_WS_WIT_INO" "${_WS_COLLECT_RECORD-}" "${_WS_COLLECT_LEAF-}"'))
      .toBe(`collectable|${o.ino}||present`);
  });

  it('collects: the leaf, its slot and its record go, the witness is dropped, and ONE done document says so', () => {
    const o = makeOrphan(h);
    const r = collectVerb(h, collectToken(h));
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const doc = docOf(r.stdout);
    expect(doc).toMatchObject({ collected: COL_ID, resumed: false, witness: 'dropped' });
    expect(String(doc['record'])).toMatch(/^demo-quiet-reef\.\d{19}\.\d+$/);
    expect(fs.existsSync(o.leaf), 'the leaf').toBe(false);
    expect(fs.existsSync(witnessOf(h)), 'the witness').toBe(false);
    expect(slots(h), 'no slot is left').toEqual([]);
    expect(records(h), 'no record is left').toEqual([]);
    expect(fs.statSync(quarantineOf(h)).mode & 0o777, 'the quarantine itself stays, private').toBe(0o700);
    const ev = eventsOf(h.home, 'collect');
    expect(ev.map((e) => [e['outcome'], e['verb']])).toEqual([['intent', 'ws-collect'], ['done', 'ws-collect']]);
    expect(ev[1]!['tx'], 'one transaction').toBe(ev[0]!['tx']);
    expect(String(ev[0]!['detail'])).toContain(`record ${String(doc['record'])}: moving `);
    expect(String(ev[1]!['detail'])).toMatch(/^witness dropped; 0 stale witness temp file\(s\) removed; collected /);
  });

  it('passes every step, in order, and never a restore', () => {
    makeOrphan(h);
    const r = collectVerb(h, collectToken(h), { pre: GAP_LOG });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(gaps(h)).toEqual(['locked', 'consented', 'recorded', 'slotted', 'moved', 'proven', 'removed', 'emptied', 'witnessed', 'dropped']);
  });

  it('--surface, --actor and --reason ride the intent row', () => {
    makeOrphan(h);
    const r = collectVerb(h, collectToken(h), { extra: "--surface agent --actor 'collect sweep' --reason tidy" });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(decOf(eventsOf(h.home, 'collect')[0]!)).toMatchObject({ surface: 'agent', actor: 'collect sweep', reason: 'tidy' });
  });

  it('a witness whose leaf is PROVEN absent, with no record: the witness alone is compared and dropped — no quarantine, record or slot', () => {
    makeOrphan(h);
    fs.rmSync(leafOf(h), { recursive: true });
    const r = collectVerb(h, collectToken(h), { pre: GAP_LOG });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(docOf(r.stdout)).toEqual({ collected: COL_ID, record: null, resumed: false, witness: 'dropped' });
    expect(fs.existsSync(witnessOf(h)), 'the witness').toBe(false);
    expect(fs.existsSync(quarantineOf(h)), 'no quarantine is made for it').toBe(false);
    expect(records(h)).toEqual([]);
    expect(gaps(h)).toEqual(['locked', 'consented', 'witnessed']);
    expect(eventsOf(h.home, 'collect').map((e) => e['outcome'])).toEqual(['intent', 'done']);
  });
});

describe.skipIf(!LINUX)('stdout is ONE JSON line', () => {
  it('on every arm — refused, failed, resumed, collected and witness-only — exactly one line, and it parses', () => {
    // `docOf` reads the LAST line, so a stray line above the document (a helper printing to stdout) would pass every
    // other case unseen. Each answer is read whole here.
    const one = (r: Run, label: string): Record<string, unknown> => {
      const ls = r.stdout.replace(/\n$/, '').split('\n');
      expect(ls, `${label}: ${r.stdout}${r.stderr}`).toHaveLength(1);
      return JSON.parse(ls[0]!) as Record<string, unknown>;
    };
    makeOrphan(h);
    expect(one(collectVerb(h, WRONG_TOKEN), 'refused')['refused']).toBe('state-changed');
    expect(one(collectVerb(h, WRONG_TOKEN, { pre: `${evalSays(WRONG_TOKEN)} CCD_OS=darwin;` }), 'failed')['failed'])
      .toBe('probe-unmeasured');
    expect(collectVerb(h, collectToken(h), { pre: crashAt('moved') }).code).toBe(137);
    expect(one(collectVerb(h, collectToken(h)), 'resumed')).toMatchObject({ collected: COL_ID, resumed: true });
    makeOrphan(h);
    expect(one(collectVerb(h, collectToken(h)), 'collected')).toMatchObject({ collected: COL_ID, resumed: false });
    makeOrphan(h);
    fs.rmSync(leafOf(h), { recursive: true });
    expect(one(collectVerb(h, collectToken(h)), 'witness-only')).toMatchObject({ collected: COL_ID, record: null });
  });
});

describe.skipIf(!LINUX)('a witness whose leaf is gone, beside a quarantine slot of its id that NO record names', () => {
  // The witness-without-leaf arm refuses while a slot of the id stands: with no record naming it, that slot (which
  // may hold the leaf) is the operator's, and dropping the witness would leave it for no audit to visit again.
  const slotFor = (id: string): string => path.join(quarantineOf(h), `slot.${id}.1791000000000000000.4242`);

  it('a slot of this id: refused quarantine-kept at the audit and at the verb — the witness kept, the slot untouched', () => {
    const o = makeOrphan(h);
    fs.mkdirSync(quarantineOf(h), { mode: 0o700 });
    fs.mkdirSync(slotFor(COL_ID), { mode: 0o700 });
    fs.renameSync(o.leaf, path.join(slotFor(COL_ID), 'leaf'));
    expect(auditDoc()['verdict'], 'the audit').toBe('quarantine-kept');
    const r = collectVerb(h, WRONG_TOKEN);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const doc = docOf(r.stdout);
    expect(doc['refused']).toBe('quarantine-kept');
    expect(String(doc['detail'])).toMatch(/^kept as it stands, listed for the operator, and the witness of demo-quiet-reef stays: /);
    expect(fs.readFileSync(witnessOf(h), 'utf8'), 'the witness, kept').toBe(o.witness);
    expect(inoAt(path.join(slotFor(COL_ID), 'leaf')), 'the slot and the leaf in it, untouched').toBe(o.ino);
    expect(records(h)).toEqual([]);
    expect(rows(), 'the audit’s and the verb’s refusal').toEqual([['refused', 'quarantine-kept'], ['refused', 'quarantine-kept']]);
  });

  it('a NESTED id’s slot is another id’s, never this one’s: not counted — the witness alone is collected, that slot untouched', () => {
    // `slot.<id>.*` would match `slot.<id>.v2-quiet-river.<ns>.<pid>`; the exact parse reads its id as
    // `<id>.v2-quiet-river`.
    makeOrphan(h);
    fs.rmSync(leafOf(h), { recursive: true });
    fs.mkdirSync(quarantineOf(h), { mode: 0o700 });
    const other = slotFor(`${COL_ID}.v2-quiet-river`);
    fs.mkdirSync(path.join(other, 'leaf'), { recursive: true, mode: 0o700 });
    const r = collectVerb(h, collectToken(h));
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(docOf(r.stdout)).toEqual({ collected: COL_ID, record: null, resumed: false, witness: 'dropped' });
    expect(fs.existsSync(path.join(other, 'leaf')), 'the other id’s slot').toBe(true);
  });

  it('a quarantine that is a link: unmeasured at the audit, failed probe-unmeasured at the verb — never "no slot", the witness kept', () => {
    const o = makeOrphan(h);
    fs.rmSync(leafOf(h), { recursive: true });
    fs.mkdirSync(path.join(h.home, 'elsewhere-q'), { mode: 0o700 });
    fs.symlinkSync(path.join(h.home, 'elsewhere-q'), quarantineOf(h));
    const audit = auditDoc();
    expect([audit['verdict'], (audit['collect'] as Record<string, unknown>)['unmeasured']]).toEqual(['unmeasured', 'quarantine']);
    const r = collectVerb(h, WRONG_TOKEN);
    expect(r.code, r.stdout + r.stderr).toBe(1);
    expect(docOf(r.stdout)['failed']).toBe('probe-unmeasured');
    expect(fs.readFileSync(witnessOf(h), 'utf8')).toBe(o.witness);
  });

  it.skipIf(ROOT)('a quarantine that cannot be listed: unmeasured, never "no slot" — the witness kept', () => {
    const o = makeOrphan(h);
    fs.rmSync(leafOf(h), { recursive: true });
    fs.mkdirSync(quarantineOf(h), { mode: 0o700 });
    try {
      fs.chmodSync(quarantineOf(h), 0o300);
      const audit = auditDoc();
      expect([audit['verdict'], (audit['collect'] as Record<string, unknown>)['unmeasured']]).toEqual(['unmeasured', 'quarantine']);
      expect(String(audit['detail'])).toContain('could not list');
    } finally { fs.chmodSync(quarantineOf(h), 0o700); }
    expect(fs.readFileSync(witnessOf(h), 'utf8')).toBe(o.witness);
  });
});

describe.skipIf(!LINUX)('the stop arms before the move', () => {
  it.skipIf(ROOT)('a witness-only drop whose compare-and-drop cannot move the witness aside: failed probe-unmeasured — nothing removed, the witness kept', () => {
    const o = makeOrphan(h);
    fs.rmSync(leafOf(h), { recursive: true });
    const t = collectToken(h);
    try {
      const r = collectVerb(h, t, { pre: gapAt('consented', 'chmod 0500 "$REG/tmproots"') });
      expect(r.code, r.stdout + r.stderr).toBe(1);
      const doc = docOf(r.stdout);
      expect(doc['failed']).toBe('probe-unmeasured');
      expect(String(doc['detail'])).toMatch(/^nothing was removed: the witness of demo-quiet-reef, whose leaf is gone, could not be compared and dropped: /);
    } finally { fs.chmodSync(path.dirname(witnessOf(h)), 0o700); }
    expect(fs.readFileSync(witnessOf(h), 'utf8')).toBe(o.witness);
    expect(rows()).toEqual([['intent', null], ['failed', 'probe-unmeasured']]);
  });

  it('a quarantine that is not a real directory of this uid at 0700: failed probe-unmeasured before any record — nothing moved', () => {
    const o = makeOrphan(h);
    fs.mkdirSync(path.join(h.home, 'elsewhere-q'), { mode: 0o700 });
    fs.symlinkSync(path.join(h.home, 'elsewhere-q'), quarantineOf(h));
    const r = collectVerb(h, collectToken(h));
    expect(r.code, r.stdout + r.stderr).toBe(1);
    const doc = docOf(r.stdout);
    expect(doc['failed']).toBe('probe-unmeasured');
    expect(String(doc['detail'])).toMatch(/^nothing was moved: .* is not a real directory/);
    expect(inoAt(o.leaf)).toBe(o.ino);
    expect(records(h)).toEqual([]);
    expect(fs.readdirSync(path.join(h.home, 'elsewhere-q')), 'nothing went through the link').toEqual([]);
    expect(rows()).toEqual([['failed', 'probe-unmeasured']]);
  });
});

describe.skipIf(!LINUX)('the consent, recomputed inside the lock before anything moves', () => {
  it('a token that is not the one recomputed in the lock: state-changed, nothing moves', () => {
    const o = makeOrphan(h);
    const r = collectVerb(h, WRONG_TOKEN, { pre: GAP_LOG });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(docOf(r.stdout)['refused']).toBe('state-changed');
    expect(inoAt(o.leaf)).toBe(o.ino);
    expect(gaps(h), 'refused at the verdict point').toEqual(['locked']);
    expect(records(h)).toEqual([]);
    expect(rows()).toEqual([['refused', 'state-changed']]);
  });

  it('a tree written to after the audit: state-changed — the token binds its newest ctime and its count', () => {
    const o = makeOrphan(h);
    const t = collectToken(h);
    fs.writeFileSync(path.join(o.leaf, 'late.txt'), 'written after the audit\n');
    const r = collectVerb(h, t);
    expect(docOf(r.stdout)['refused']).toBe('state-changed');
    expect(fs.readFileSync(path.join(o.leaf, 'late.txt'), 'utf8')).toBe('written after the audit\n');
  });

  it('a ladder refusal passes through as ONE refusal document and ONE refused row, nothing touched', () => {
    const o = makeOrphan(h);
    fs.writeFileSync(path.join(regOf(h), `${COL_ID}.uuid`), 'deadbeef-0000-4000-8000-000000000000\n');
    const r = collectVerb(h, WRONG_TOKEN, { pre: GAP_LOG });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(docOf(r.stdout)['refused']).toBe('registered');
    expect(gaps(h)).toEqual(['locked']);
    expect(inoAt(o.leaf)).toBe(o.ino);
    expect(rows()).toEqual([['refused', 'registered']]);
    expect(eventsOf(h.home, 'collect')[0]!['verb']).toBe('ws-collect');
  });

  it('the ladder’s unmeasured is a failed probe-unmeasured at exit 1, with no intent — and never a crumb', () => {
    makeOrphan(h);
    const unmeasured = "_WS_RCL_CRUMB=true; _ws_collect_fork() { REAP_VERDICT=unmeasured; REAP_TOKEN='';"
      + " REAP_DETAIL='stub: the walk timed out'; _WS_COLLECT_RECORD=''; return 1; };";
    const r = collectVerb(h, WRONG_TOKEN, { pre: unmeasured });
    expect(r.code).toBe(1);
    const doc = docOf(r.stdout);
    expect(doc['failed']).toBe('probe-unmeasured');
    expect(doc, 'a collection has no breadcrumb, whatever the shared tail left in the global').not.toHaveProperty('crumb');
    expect(eventsOf(h.home, 'collect').map((e) => [e['outcome'], e['refusal'], e['verb']]))
      .toEqual([['failed', 'probe-unmeasured', 'ws-collect']]);
  });
});

describe.skipIf(!LINUX)('the pause, the lock, and never a lock for a foreign name', () => {
  it('reclaim-paused refuses paused INSIDE the lock — even over a ladder that answers collectable', () => {
    const o = makeOrphan(h);
    fs.writeFileSync(path.join(regOf(h), 'reclaim-paused'), '');
    const r = collectVerb(h, WRONG_TOKEN, { pre: `${GAP_LOG} ${evalSays(WRONG_TOKEN)}` });
    expect(docOf(r.stdout)['refused']).toBe('paused');
    expect(gaps(h), 'read after the lock, before the ladder').toEqual(['locked']);
    expect(inoAt(o.leaf)).toBe(o.ino);
    expect(rows()).toEqual([['refused', 'paused']]);
  });

  it('another holder of the reap lock: refused in-progress, journaled, nothing moves', () => {
    const o = makeOrphan(h);
    const r = collectVerb(h, WRONG_TOKEN, { pre: `exec 9>>"$REG/.reap-${COL_ID}.lock"; flock -n 9 || exit 99;` });
    expect(docOf(r.stdout)['refused']).toBe('in-progress');
    expect(inoAt(o.leaf)).toBe(o.ino);
    expect(rows()).toEqual([['refused', 'in-progress']]);
  });

  it('the locked body runs CONTAINED: every git call beneath it is hook-free and reads only the repository it names', () => {
    expect(fs.readFileSync(CCD, 'utf8')).toMatch(/\n  _ws_reclaim_contained _ws_collect_locked "\$token" "\$id" /);
  });

  it('an id with neither a witness nor a record: refused not-witnessed BEFORE any lock — none is created', () => {
    const r = collectVerb(h, WRONG_TOKEN, { id: 'demo-quiet-none' });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(docOf(r.stdout)['refused']).toBe('not-witnessed');
    expect(fs.existsSync(path.join(regOf(h), '.reap-demo-quiet-none.lock'))).toBe(false);
    expect(eventsOf(h.home, 'collect').map((e) => [e['id'], e['refusal']])).toEqual([['demo-quiet-none', 'not-witnessed']]);
  });

  it('no witness, and records that cannot be listed: failed probe-unmeasured BEFORE any lock — none is created for a name that may be foreign', () => {
    // `tmpquarantine/` is a link, which the record lister never follows: it answers 2, never "no record". With no
    // witness either, nothing proves the id the collector's, so its reap lock is never opened (and so never made).
    fs.mkdirSync(path.join(h.home, 'elsewhere'));
    fs.symlinkSync(path.join(h.home, 'elsewhere'), recordsDir(h));
    const r = collectVerb(h, WRONG_TOKEN);
    expect(r.code, r.stdout + r.stderr).toBe(1);
    expect(fs.existsSync(path.join(regOf(h), `.reap-${COL_ID}.lock`)), 'the reap lock file').toBe(false);
    const doc = docOf(r.stdout);
    expect(doc['failed']).toBe('probe-unmeasured');
    expect(String(doc['detail'])).toContain('no lock was taken');
    expect(rows()).toEqual([['failed', 'probe-unmeasured']]);
  });

  it('a `tmproots/` that is itself a link: failed probe-unmeasured BEFORE any lock, as the audit answers — the link is never followed', () => {
    // A witness read THROUGH a linked `tmproots/` is not one ccd wrote, so it puts no id in the population: the
    // audit answers unmeasured (`witness`) here, and the verb, which never reaches its evaluation, does the same.
    const o = makeOrphan(h);
    const real = path.join(h.home, 'tmproots-elsewhere');
    fs.renameSync(path.dirname(witnessOf(h)), real);
    fs.symlinkSync(real, path.dirname(witnessOf(h)));
    const r = collectVerb(h, WRONG_TOKEN, { pre: evalSays(WRONG_TOKEN) });
    expect(r.code, r.stdout + r.stderr).toBe(1);
    const doc = docOf(r.stdout);
    expect(doc['failed']).toBe('probe-unmeasured');
    expect(String(doc['detail'])).toContain('no lock was taken');
    expect(fs.existsSync(path.join(regOf(h), `.reap-${COL_ID}.lock`)), 'the reap lock file').toBe(false);
    expect(inoAt(o.leaf)).toBe(o.ino);
    expect(fs.existsSync(path.join(real, COL_ID)), 'the witness it reaches, untouched').toBe(true);
    expect(rows()).toEqual([['failed', 'probe-unmeasured']]);
  });

  it('argv: four positionals only, no --defer-expired; a malformed or dot-leading id and a bad token die first, journaling nothing', () => {
    makeOrphan(h);
    for (const [args, err] of [
      [`--expect ${WRONG_TOKEN} --session ${COL_ID} --defer-expired`, 'usage: ccd ws-collect'],
      [`--expect ${WRONG_TOKEN} --session .hidden`, 'bad session id'],
      [`--expect ${WRONG_TOKEN} --session 'a/b'`, 'bad session id'],
      [`--expect nothex --session ${COL_ID}`, 'bad token'],
    ] as const) {
      const r = h.run(`cmd_ws_collect ${args}`);
      expect(r.code, args).toBe(1);
      expect(r.stderr, args).toContain(err);
      expect(r.stdout, `${args}: nothing on stdout`).toBe('');
    }
    expect(eventsOf(h.home, 'collect')).toEqual([]);
  });
});

describe('off Linux, or without --no-copy, nothing moves', () => {
  it('a box that is not Linux: probe-unmeasured before any quarantine, record or slot — even over a ladder that answers collectable', () => {
    const o = makeOrphan(h);
    const r = collectVerb(h, WRONG_TOKEN, { pre: `${evalSays(WRONG_TOKEN)} CCD_OS=darwin;` });
    expect(r.code).toBe(1);
    expect(docOf(r.stdout)['failed']).toBe('probe-unmeasured');
    expect(fs.existsSync(quarantineOf(h)), 'the quarantine').toBe(false);
    expect(records(h)).toEqual([]);
    expect(inoAt(o.leaf)).toBe(o.ino);
  });

  it.skipIf(!LINUX)('a box whose mv offers no --no-copy: likewise — the collector never copies', () => {
    const o = makeOrphan(h);
    const oldMv = 'mv() { if [[ "$1" == --help ]]; then echo "Usage: mv [OPTION]... SOURCE DEST"; return 0; fi; command mv "$@"; };';
    const r = collectVerb(h, WRONG_TOKEN, { pre: `${evalSays(WRONG_TOKEN)} ${oldMv}` });
    expect(r.code).toBe(1);
    expect(String(docOf(r.stdout)['detail'])).toContain('--no-copy');
    expect(fs.existsSync(quarantineOf(h)), 'the quarantine').toBe(false);
    expect(inoAt(o.leaf)).toBe(o.ino);
  });
});

describe('the three RETRYABLE words are declared with their first journal sites, each with a sentence true under any server', () => {
  it.each(['not-witnessed', 'registered', 'changed-recently'] as const)('%s', (t) => {
    expect(isLcRefusalToken(t)).toBe(true);
    expect(LC_REFUSAL_WORD[t]).toMatch(/Nothing was removed/);
    expect(LC_REFUSAL_WORD[t], `${t} echoes its own token at a person`).not.toContain(t);
  });
});
