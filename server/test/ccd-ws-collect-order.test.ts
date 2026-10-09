// `ws-collect`'s step 6 and the order after it (child reclamation wave 7, spec §5.10): the slot's leaf goes through
// the ONE removal helper with the witness's dev:ino and the alias; then the leaf is proven gone, the EMPTY slot is
// rmdir'd (never a recursive remove), the witness is compared and dropped (moved aside, read, unlinked only if it is
// the collected one), the witness writer's dead temp files of this id are reaped, and the record goes LAST.
// FIXTURE HOME ONLY; a case that narrows a directory's mode restores it in `finally`.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { eventsOf } from './lifecycleHelpers.js';
import {
  COL_ID, collectToken, collectVerb, docOf, gapAt, inoAt, linesOf, makeOrphan, origOf, quarantineOf, records,
  slots, witnessOf,
} from './wsCollectFixture.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-ws-collect-order-'); });
afterEach(() => { h.cleanup(); });

const LINUX = process.platform === 'linux';
const ROOT = process.getuid?.() === 0;
const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

describe.skipIf(!LINUX)('step 6 — the ONE removal helper, with the witness’s dev:ino and the alias', () => {
  it('is called as `_ws_leaf_remove <slot> leaf <dev:ino> <pre-move path> <accepted checkouts>`', () => {
    const o = makeOrphan(h);
    const spy = 'eval "$(declare -f _ws_leaf_remove | sed \'1s/^_ws_leaf_remove /_ws_leaf_remove_real /\')";'
      + ' _ws_leaf_remove() { printf \'%s\\x1f\' "$@" > "$HOME/remove-args"; _ws_leaf_remove_real "$@"; };';
    const r = collectVerb(h, collectToken(h), { pre: spy });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const slot = path.join(quarantineOf(h), `slot.${String(docOf(r.stdout)['record'])}`);
    expect(fs.readFileSync(path.join(h.home, 'remove-args'), 'utf8').split('\x1f').slice(0, -1))
      .toEqual([slot, 'leaf', `${o.dev}:${o.ino}`, origOf(h), '']);
  });

  for (const [what, swap] of [
    ['a symbolic link', 'mv "$3/leaf" "$HOME/real"; ln -s "$HOME/real" "$3/leaf"'],
    ['a regular file', 'mv "$3/leaf" "$HOME/real"; printf data > "$3/leaf"'],
  ] as const) {
    it(`${what} swapped into the slot after the last proof is NEVER unlinked: the helper refuses it under the alias — KEPT, failed quarantine-kept`, () => {
      // `_ws_leaf_remove` unlinks a link or file leaf for its tail callers; under the collector's alias it refuses one
      // (rc 1, untouched): the collector's leaf is the recorded directory and nothing else. The move back then refuses
      // at its own identity check, so what stands in the slot stays there with its record.
      const o = makeOrphan(h);
      const r = collectVerb(h, collectToken(h), { pre: gapAt('proven', swap) });
      expect(r.code, r.stdout + r.stderr).toBe(1);
      expect(docOf(r.stdout)['failed']).toBe('quarantine-kept');
      const sleaf = path.join(quarantineOf(h), slots(h)[0]!, 'leaf');
      expect(() => fs.lstatSync(sleaf), `${what} still stands in the slot`).not.toThrow();
      expect(fs.lstatSync(sleaf).isDirectory()).toBe(false);
      expect(inoAt(path.join(h.home, 'real')), 'the witnessed tree, where the swap put it').toBe(o.ino);
      expect(fs.readFileSync(path.join(h.home, 'real', 'scratch.txt'), 'utf8')).toBe('scratch\n');
      expect(records(h)).toHaveLength(1);
      expect(fs.readFileSync(witnessOf(h), 'utf8')).toBe(o.witness);
    });
  }

  it('a leaf the helper REFUSES (rc 1, nothing under it removed): moved back whole, containment-unproven', () => {
    const o = makeOrphan(h);
    const r = collectVerb(h, collectToken(h), { pre: "_ws_leaf_remove() { _WS_LEAF_WHY='stub: a checkout git records elsewhere'; return 1; };" });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(docOf(r.stdout)['refused']).toBe('containment-unproven');
    expect(inoAt(o.leaf)).toBe(o.ino);
    expect(slots(h)).toEqual([]);
    expect(records(h)).toEqual([]);
  });

  it('a helper that could not measure (rc 2 — an rm that failed part-way answers 2 too): the record and slot KEPT', () => {
    const o = makeOrphan(h);
    const r = collectVerb(h, collectToken(h), { pre: "_ws_leaf_remove() { _WS_LEAF_WHY='stub: rm exit 1'; return 2; };" });
    expect(r.code).toBe(1);
    expect(docOf(r.stdout)['failed']).toBe('quarantine-kept');
    expect(inoAt(path.join(quarantineOf(h), slots(h)[0]!, 'leaf'))).toBe(o.ino);
    expect(records(h)).toHaveLength(1);
  });

  for (const [rc, outcome, word] of [[1, 'refused', 'containment-unproven'], [2, 'failed', 'quarantine-kept']] as const) {
    it(`a reason the helper hands back with rc ${rc} is ONE line in the journal and the document: a raw newline never reaches either`, () => {
      makeOrphan(h);
      const r = collectVerb(h, collectToken(h), { pre: `_ws_leaf_remove() { _WS_LEAF_WHY=$'stub: first line\\nsecond line'; return ${rc}; };` });
      const doc = docOf(r.stdout);
      expect(doc[outcome], r.stdout + r.stderr).toBe(word);
      expect(String(doc['detail']), 'the document').toContain('stub: first line?second line');
      const last = eventsOf(h.home, 'collect').at(-1)!;
      expect([last['outcome'], last['refusal']]).toEqual([outcome, word]);
      expect(String(last['detail']), 'the journal').toContain('stub: first line?second line');
      expect(String(last['detail'])).not.toContain('\n');
    });
  }
});

describe.skipIf(!LINUX)('then the order: the leaf proven gone, the EMPTY slot, the witness, the record LAST', () => {
  const LOOK = '_ws_collect_gap() { local s=0 l=0 w=0 n;'
    + ' [[ -n "${3-}" && -e "$3" ]] && s=1; [[ -n "${3-}" && -e "$3/leaf" ]] && l=1; [[ -e "$REG/tmproots/$2" ]] && w=1;'
    + ' n=$(ls -A "$REG/tmpquarantine" 2>/dev/null | wc -l);'
    + ' printf \'%s slot=%s leaf=%s witness=%s record=%s\\n\' "$1" "$s" "$l" "$w" "${n// /}" >> "$HOME/looks"; };';

  it('in exactly that order', () => {
    makeOrphan(h);
    const r = collectVerb(h, collectToken(h), { pre: LOOK });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(linesOf(h, 'looks').filter((l) => /^(removed|emptied|witnessed) /.test(l))).toEqual([
      'removed slot=1 leaf=0 witness=1 record=1',
      'emptied slot=0 leaf=0 witness=1 record=1',
      'witnessed slot=0 leaf=0 witness=0 record=1',
    ]);
    expect(records(h)).toEqual([]);
  });

  it('rmdir, never a recursive remove: a slot holding a stray entry after the removal is KEPT, with its record and witness', () => {
    const o = makeOrphan(h);
    const r = collectVerb(h, collectToken(h), { pre: gapAt('removed', 'printf s > "$3/stray"') });
    expect(r.code).toBe(1);
    expect(docOf(r.stdout)['failed']).toBe('quarantine-kept');
    expect(fs.readFileSync(path.join(quarantineOf(h), slots(h)[0]!, 'stray'), 'utf8')).toBe('s');
    expect(records(h)).toHaveLength(1);
    expect(fs.readFileSync(witnessOf(h), 'utf8'), 'the witness stays until the slot is gone').toBe(o.witness);
  });

  it('a record that cannot be dropped: quarantine-kept — and the next pass finishes it from the record', () => {
    makeOrphan(h);
    const r1 = collectVerb(h, collectToken(h), { pre: '_ws_collect_record_drop() { return 1; };' });
    expect(r1.code).toBe(1);
    expect(docOf(r1.stdout)['failed']).toBe('quarantine-kept');
    expect(records(h)).toHaveLength(1);
    const r2 = collectVerb(h, collectToken(h));
    expect(r2.code, r2.stdout + r2.stderr).toBe(0);
    expect(docOf(r2.stdout)).toMatchObject({ collected: COL_ID, resumed: true, witness: 'absent' });
    expect(records(h)).toEqual([]);
  });
});

describe.skipIf(!LINUX)('compare-and-drop — the witness this collection acted on goes, and nothing else', () => {
  it('a witness a recycled spawn rewrote is NOT dropped: moved aside, read, moved back', () => {
    makeOrphan(h);
    const r = collectVerb(h, collectToken(h), { pre: gapAt('emptied', 'sed -i "s/ run=7 / run=8 /" "$REG/tmproots/$2"') });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(docOf(r.stdout)).toMatchObject({ collected: COL_ID, witness: 'kept' });
    expect(fs.readFileSync(witnessOf(h), 'utf8')).toMatch(/ run=8 /);
    expect(fs.readdirSync(path.dirname(witnessOf(h))), 'no aside is left').toEqual([COL_ID]);
  });

  it('the collected one is moved ASIDE by one NOREPLACE rename and unlinked there — the live name is never rm’d', () => {
    makeOrphan(h);
    const spy = 'rm() { printf \'%s\\n\' "$*" >> "$HOME/rm-calls"; command rm "$@"; };'
      + ' mv() { printf \'%s\\n\' "$*" >> "$HOME/mv-calls"; command mv "$@"; };';
    const r = collectVerb(h, collectToken(h), { pre: spy });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const w = witnessOf(h);
    const aside = `${esc(path.dirname(w))}/\\.${esc(COL_ID)}\\.drop\\.\\d+`;
    expect(linesOf(h, 'mv-calls')).toContainEqual(expect.stringMatching(new RegExp(`^-T -n --no-copy -- ${esc(w)} ${aside}$`)));
    expect(linesOf(h, 'rm-calls')).toContainEqual(expect.stringMatching(new RegExp(`^-f -- ${aside}$`)));
    expect(linesOf(h, 'rm-calls').filter((l) => l.endsWith(` ${w}`)), 'never the live name').toEqual([]);
  });

  it('a newer witness written while ours was aside is never clobbered', () => {
    makeOrphan(h);
    const race = `mv() { command mv "$@"; local rc=$?; if [[ "\${@: -1}" == */tmproots/.${COL_ID}.drop.* ]]; then`
      + ` sed 's/ run=7 / run=9 /' "\${@: -1}" > "$REG/tmproots/${COL_ID}"; fi; return $rc; };`;
    const r = collectVerb(h, collectToken(h), { pre: race });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(docOf(r.stdout)['witness'], 'ours was the collected one').toBe('dropped');
    expect(fs.readFileSync(witnessOf(h), 'utf8'), 'the newer one stands').toMatch(/ run=9 /);
  });

  it.skipIf(ROOT)('a witness that cannot be moved aside keeps the record: quarantine-kept, the next pass finishes', () => {
    makeOrphan(h);
    const dir = path.dirname(witnessOf(h));
    try {
      const r = collectVerb(h, collectToken(h), { pre: gapAt('emptied', 'chmod 0500 "$REG/tmproots"') });
      expect(r.code).toBe(1);
      expect(docOf(r.stdout)['failed']).toBe('quarantine-kept');
    } finally { fs.chmodSync(dir, 0o700); }
    expect(records(h)).toHaveLength(1);
    expect(fs.existsSync(witnessOf(h))).toBe(true);
    const r2 = collectVerb(h, collectToken(h));
    expect(r2.code, r2.stdout + r2.stderr).toBe(0);
    expect(docOf(r2.stdout)).toMatchObject({ collected: COL_ID, resumed: true, witness: 'dropped' });
    expect(records(h)).toEqual([]);
  });
});

describe.skipIf(!LINUX)('the witness writer’s dead temp files — the exact shape, an hour old, of this id, while the slug reads free', () => {
  const OLD = ['.demo-quiet-reef.123.456.tmp', '.demo-quiet-reef.v2-quiet-river.4242.17.tmp', '.demo-quiet-reef.1.2.3.tmp',
    '.demo-quiet-reef.12.tmp', '.demo-quiet-reef.drop.99', '.demo-quiet-other.1.2.tmp'];
  const FRESH = ['.demo-quiet-reef.123.457.tmp'];
  const plant = (): void => {
    const d = path.dirname(witnessOf(h));
    const old = Date.now() / 1000 - 7200;
    for (const n of OLD) { fs.writeFileSync(path.join(d, n), 'x'); fs.utimesSync(path.join(d, n), old, old); }
    for (const n of FRESH) fs.writeFileSync(path.join(d, n), 'x');
  };

  it('only `.<id>.<digits>.<digits>.tmp` at least an hour old goes', () => {
    makeOrphan(h);
    plant();
    const r = collectVerb(h, collectToken(h));
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(fs.readdirSync(path.dirname(witnessOf(h))).sort()).toEqual([...OLD.slice(1), ...FRESH].sort());
    expect(String(eventsOf(h.home, 'collect').at(-1)!['detail'])).toContain('1 stale witness temp file(s) removed');
  });

  it('none goes while the slug does not read free at that instant', () => {
    makeOrphan(h);
    plant();
    const r = collectVerb(h, collectToken(h), { pre: gapAt('witnessed', 'printf 8 > "$REG/$2.child"') });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(fs.existsSync(path.join(path.dirname(witnessOf(h)), OLD[0]!))).toBe(true);
  });
});
