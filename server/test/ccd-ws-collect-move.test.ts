// `ws-collect`'s steps 2 to 4 (child reclamation wave 7, spec §5.10): the lstat of the leaf, the checkout question of
// the ORIGINAL path, the record before the slot, the slot made exclusively, and the ONE rename, proven by lstat and
// never by mv's exit code. A case forces its race into the exact gap through `_ws_collect_gap`, and shadows `mv` (or
// Task 4's `_ws_collect_mv`) with a shell FUNCTION for that one call where it needs a box whose mv misbehaves or a
// race inside the move itself. FIXTURE HOME ONLY.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { eventsOf } from './lifecycleHelpers.js';
import {
  COL_ID, GAP_LOG, WRONG_TOKEN, collectToken, collectVerb, docOf, evalSays, gapAt, gaps, inoAt, leafOf, linesOf,
  makeOrphan, origOf, quarantineOf, records, slots, witnessOf,
} from './wsCollectFixture.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-ws-collect-move-'); });
afterEach(() => { h.cleanup(); });

const LINUX = process.platform === 'linux';
const journal = (): unknown[][] => eventsOf(h.home, 'collect').map((e) => [e['outcome'], e['refusal'] ?? null]);

/** What stands in for the leaf at its own path: the witnessed tree moved to `$HOME/real` first. */
const SWAPS = [
  ['a symbolic link', 'mv "$HOME/.cc-tmp/$2" "$HOME/real"; ln -s "$HOME/real" "$HOME/.cc-tmp/$2"'],
  ['a regular file', 'mv "$HOME/.cc-tmp/$2" "$HOME/real"; printf data > "$HOME/.cc-tmp/$2"'],
  ['another directory', 'mv "$HOME/.cc-tmp/$2" "$HOME/real"; mkdir "$HOME/.cc-tmp/$2"'],
] as const;

describe.skipIf(!LINUX)('step 2 — a real directory with the witness’s identity, or nothing moves', () => {
  for (const [what, swap] of SWAPS) {
    it(`${what} at the leaf’s path: witness-mismatch before any record — never moved, never unlinked`, () => {
      makeOrphan(h);
      const r = collectVerb(h, collectToken(h), { pre: gapAt('consented', swap) });
      expect(r.code, r.stdout + r.stderr).toBe(0);
      expect(docOf(r.stdout)['refused']).toBe('witness-mismatch');
      expect(gaps(h), 'refused before the record').toEqual(['locked', 'consented']);
      expect(records(h)).toEqual([]);
      expect(slots(h)).toEqual([]);
      expect(fs.readFileSync(path.join(h.home, 'real', 'scratch.txt'), 'utf8'), 'the witnessed tree').toBe('scratch\n');
      expect(() => fs.lstatSync(leafOf(h)), `${what} still stands where it was`).not.toThrow();
    });
  }
});

describe.skipIf(!LINUX)('step 2 — a leaf that VANISHED after the evaluation saw it is a retry, never witness-mismatch (ruling R-f)', () => {
  it('nothing stands at step 2’s lstat: refused state-changed before any record — and the next audit takes the witness-without-leaf arm', () => {
    const o = makeOrphan(h);
    const r = collectVerb(h, collectToken(h), { pre: gapAt('consented', 'mv "$HOME/.cc-tmp/$2" "$HOME/real"') });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(docOf(r.stdout)['refused']).toBe('state-changed');
    expect(gaps(h), 'refused before the record').toEqual(['locked', 'consented']);
    expect(records(h)).toEqual([]);
    expect(slots(h)).toEqual([]);
    expect(fs.readFileSync(witnessOf(h), 'utf8'), 'the witness stands, unchanged').toBe(o.witness);
    expect(journal()).toEqual([['refused', 'state-changed']]);
    expect(docOf(collectVerb(h, collectToken(h)).stdout), 'the retry: the witness alone is compared and dropped')
      .toEqual({ collected: COL_ID, record: null, resumed: false, witness: 'dropped' });
    expect(fs.readFileSync(path.join(h.home, 'real', 'scratch.txt'), 'utf8'), 'what moved away is never touched')
      .toBe('scratch\n');
  });

  it('an absence that cannot be proven: failed probe-unmeasured at exit 1, never witness-mismatch — nothing moves', () => {
    const o = makeOrphan(h);
    // step 2's lstat answers "not it", and the absence proof that follows cannot be made. The stub replaces
    // `_ws_reclaim_absent` only from INSIDE step 2, after `_ws_collect_qdir` has asked it.
    const blind = '_ws_collect_ident() { _ws_reclaim_absent() { _WS_ABSENT_WHY=\'stub: the parent cannot be searched\'; return 2; };'
      + ' return 1; };';
    const r = collectVerb(h, WRONG_TOKEN, { pre: `${evalSays(WRONG_TOKEN)} ${blind}` });
    expect(r.code, r.stdout + r.stderr).toBe(1);
    const doc = docOf(r.stdout);
    expect(doc['failed']).toBe('probe-unmeasured');
    expect(String(doc['detail'])).toContain('stub: the parent cannot be searched');
    expect(records(h)).toEqual([]);
    expect(slots(h)).toEqual([]);
    expect(inoAt(o.leaf)).toBe(o.ino);
  });
});

describe.skipIf(!LINUX)('step 3a — the checkout question, of the ORIGINAL path, before anything moves', () => {
  // The evaluation is stubbed: the real one asks `_ws_leaf_checkouts` of the leaf itself, inside the lock, and the
  // stub below would answer it there, at the verdict point, before step 3a is ever reached.
  const ASK = (rc: number): string => '_ws_leaf_checkouts() { printf \'%s\\n\' "$1" >> "$HOME/checkouts-asked";'
    + ` _WS_CHECKOUTS_WHY='stub: a checkout git records elsewhere'; return ${rc}; };`;

  it('a refusal: containment-unproven; nothing moves; the question named the physical original path', () => {
    const o = makeOrphan(h);
    const r = collectVerb(h, WRONG_TOKEN, { pre: `${GAP_LOG} ${evalSays(WRONG_TOKEN)} ${ASK(1)}` });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(docOf(r.stdout)['refused']).toBe('containment-unproven');
    expect(linesOf(h, 'checkouts-asked')).toEqual([origOf(h)]);
    expect(gaps(h)).toEqual(['locked', 'consented']);
    expect(inoAt(o.leaf)).toBe(o.ino);
    expect(records(h)).toEqual([]);
  });

  it('an unmeasured answer: probe-unmeasured at exit 1; nothing moves', () => {
    const o = makeOrphan(h);
    const r = collectVerb(h, WRONG_TOKEN, { pre: `${GAP_LOG} ${evalSays(WRONG_TOKEN)} ${ASK(2)}` });
    expect(r.code).toBe(1);
    expect(docOf(r.stdout)['failed']).toBe('probe-unmeasured');
    expect(String(docOf(r.stdout)['detail'])).toContain('stub: a checkout git records elsewhere');
    expect(gaps(h)).toEqual(['locked', 'consented']);
    expect(inoAt(o.leaf)).toBe(o.ino);
    expect(records(h)).toEqual([]);
  });
});

describe.skipIf(!LINUX)('steps 3b and 3c — the record, then the slot, made exclusively, both before the move', () => {
  const LOOK = '_ws_collect_gap() { local n s=0 l=0 i; n=$(ls -A "$REG/tmpquarantine" 2>/dev/null | wc -l);'
    + ' [[ -n "${3-}" && -d "$3" ]] && s=1; [[ -e "$HOME/.cc-tmp/$2" ]] && l=1;'
    + ' i=$(cat "$REG"/.lifecycle/journal-*.ndjson 2>/dev/null | grep -c \'"outcome":"intent"\');'
    + ' printf \'%s rec=%s slot=%s leaf=%s intent=%s\\n\' "$1" "${n// /}" "$s" "$l" "$i" >> "$HOME/looks"; };';

  it('the record, then the slot, then the intent, then the move', () => {
    makeOrphan(h);
    const r = collectVerb(h, collectToken(h), { pre: LOOK });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(linesOf(h, 'looks').filter((l) => /^(recorded|slotted|moved) /.test(l))).toEqual([
      'recorded rec=1 slot=0 leaf=1 intent=0',
      'slotted rec=1 slot=1 leaf=1 intent=0',
      'moved rec=1 slot=1 leaf=0 intent=1',
    ]);
  });

  it('a record that cannot be written stops everything: probe-unmeasured, no slot, the leaf where it was', () => {
    const o = makeOrphan(h);
    const r = collectVerb(h, collectToken(h), { pre: `${GAP_LOG} _ws_collect_record_write() { return 1; };` });
    expect(r.code).toBe(1);
    const doc = docOf(r.stdout);
    expect(doc['failed']).toBe('probe-unmeasured');
    expect(String(doc['detail'])).toContain('could not be written');
    expect(gaps(h)).toEqual(['locked', 'consented']);
    expect(slots(h)).toEqual([]);
    expect(inoAt(o.leaf)).toBe(o.ino);
  });

  it('the record is written from the witness read IMMEDIATELY before it, under the lock: a witness rewritten since the evaluation stops everything', () => {
    // The writer reads the caller's `_WS_WIT_*`, which carry no id; so the verb reads the witness again with nothing
    // between that read and the write. A witness a recycled spawn rewrote after the evaluation is not the one the
    // consent bound: the read-back sees it, the record is dropped, and nothing moves.
    const o = makeOrphan(h);
    const rewrite = gapAt('consented', 'sed -i "s/ run=7 / run=8 /" "$REG/tmproots/$2"');
    const r = collectVerb(h, collectToken(h), { pre: rewrite });
    expect(r.code, r.stdout + r.stderr).toBe(1);
    const doc = docOf(r.stdout);
    expect(doc['failed']).toBe('probe-unmeasured');
    expect(String(doc['detail'])).toContain('did not read back as written');
    expect(records(h)).toEqual([]);
    expect(slots(h)).toEqual([]);
    expect(inoAt(o.leaf)).toBe(o.ino);
  });

  it('a record that does not read back as written stops everything, and is dropped', () => {
    const o = makeOrphan(h);
    const bad = '_ws_collect_record_write() { mkdir -p "$(_ws_collect_qrec_dir)";'
      + ' printf \'v=1 id=%s\\n\' "$1" > "$(_ws_collect_qrec_dir)/${2##*/slot.}"; };';
    const r = collectVerb(h, collectToken(h), { pre: `${GAP_LOG} ${bad}` });
    expect(r.code).toBe(1);
    expect(String(docOf(r.stdout)['detail'])).toContain('did not read back as written');
    expect(String(docOf(r.stdout)['detail']), 'what was measured').toMatch(/^nothing was moved, and the record was dropped: /);
    expect(gaps(h)).toEqual(['locked', 'consented', 'recorded']);
    expect(records(h)).toEqual([]);
    expect(slots(h)).toEqual([]);
    expect(inoAt(o.leaf)).toBe(o.ino);
  });

  const NO_DROP = "_ws_collect_record_drop() { _WS_QREC_WHY='stub: not proven gone'; return 2; };";
  const BAD_WRITE = '_ws_collect_record_write() { mkdir -p "$(_ws_collect_qrec_dir)";'
    + ' printf \'v=1 id=%s\\n\' "$1" > "$(_ws_collect_qrec_dir)/${2##*/slot.}"; };';
  for (const [what, pre] of [
    ['a record that does not read back', `${BAD_WRITE} ${NO_DROP}`],
    ['a slot that already stood', `${gapAt('recorded', 'mkdir "$3"')} ${NO_DROP}`],
  ] as const) {
    it(`${what}, then a record drop that cannot be proven: the detail says the record could NOT be dropped, never that it was`, () => {
      const o = makeOrphan(h);
      const r = collectVerb(h, collectToken(h), { pre });
      expect(r.code, r.stdout + r.stderr).toBe(1);
      const doc = docOf(r.stdout);
      expect(doc['failed']).toBe('probe-unmeasured');
      expect(String(doc['detail'])).toMatch(/^nothing was moved, and the record could not be dropped \(stub: not proven gone\): the next pass clears it: /);
      expect(records(h), 'the record the drop could not prove gone').toHaveLength(1);
      expect(inoAt(o.leaf)).toBe(o.ino);
    });
  }

  it('the slot is made EXCLUSIVELY: a name that already stands is never adopted and, not being this verb’s, never removed', () => {
    const o = makeOrphan(h);
    const r = collectVerb(h, collectToken(h), { pre: gapAt('recorded', 'mkdir "$3"') });
    expect(r.code).toBe(1);
    expect(docOf(r.stdout)['failed']).toBe('probe-unmeasured');
    expect(slots(h), 'the slot that stood').toHaveLength(1);
    expect(fs.readdirSync(path.join(quarantineOf(h), slots(h)[0]!)), 'and nothing was moved into it').toEqual([]);
    expect(records(h), 'the record is dropped').toEqual([]);
    expect(inoAt(o.leaf)).toBe(o.ino);
  });
});

describe.skipIf(!LINUX)('step 4 — ONE rename, proven by lstat, never by mv’s exit code', () => {
  /** `mv` for the one call that moves INTO a slot's leaf; every other call is the real mv. */
  const intoSlot = (body: string): string =>
    `mv() { if [[ "$1" != --help && "\${@: -1}" == */.ccd-quarantine/slot.*/leaf ]]; then ${body}; fi; command mv "$@"; };`;

  it('the argv is exactly `mv -T -n --no-copy -- <physical leaf> <slot>/leaf`', () => {
    makeOrphan(h);
    const r = collectVerb(h, collectToken(h), { pre: intoSlot('printf \'%s\\x1f\' "$@" >> "$HOME/mv-into"') });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const slot = path.join(quarantineOf(h), `slot.${String(docOf(r.stdout)['record'])}`);
    expect(fs.readFileSync(path.join(h.home, 'mv-into'), 'utf8').split('\x1f').filter(Boolean))
      .toEqual(['-T', '-n', '--no-copy', '--', origOf(h), `${slot}/leaf`]);
  });

  for (const [what, body] of [
    ['answers 0 and moves nothing', 'return 0'],
    ['refuses the rename across mounts (EXDEV), as --no-copy makes it', "echo 'mv: cannot move: Invalid cross-device link' >&2; return 1"],
  ] as const) {
    it(`an mv that ${what}: nothing moved, the slot and the record cleared, probe-unmeasured`, () => {
      const o = makeOrphan(h);
      const r = collectVerb(h, collectToken(h), { pre: intoSlot(body) });
      expect(r.code).toBe(1);
      const doc = docOf(r.stdout);
      expect(doc['failed']).toBe('probe-unmeasured');
      expect(String(doc['detail'])).toContain('was not proven');
      expect(inoAt(o.leaf)).toBe(o.ino);
      expect(slots(h)).toEqual([]);
      expect(records(h)).toEqual([]);
      expect(fs.readFileSync(witnessOf(h), 'utf8')).toBe(o.witness);
      expect(journal()).toEqual([['intent', null], ['failed', 'probe-unmeasured']]);
    });
  }

  it('an mv that moves nothing, then a slot and record that cannot be cleared: failed quarantine-kept — the record KEPT, the leaf where it was', () => {
    // step 4's `1)` arm: proven NOT moved, and the unwind could not prove the record gone. Never "cleared".
    const o = makeOrphan(h);
    const nodrop = "_ws_collect_record_drop() { _WS_QREC_WHY='stub: not proven gone'; return 2; };";
    const r = collectVerb(h, collectToken(h), { pre: `${intoSlot('return 0')} ${nodrop}` });
    expect(r.code, r.stdout + r.stderr).toBe(1);
    const doc = docOf(r.stdout);
    expect(doc['failed']).toBe('quarantine-kept');
    expect(String(doc['detail'])).toMatch(/^the quarantine record \S+ is kept, and nothing further was removed: .*the move of demo-quiet-reef was not proven, and its slot or its record could not be cleared/);
    expect(records(h)).toHaveLength(1);
    expect(inoAt(o.leaf), 'the leaf, where it was').toBe(o.ino);
    expect(journal()).toEqual([['intent', null], ['failed', 'quarantine-kept']]);
  });

  it.skipIf(process.getuid?.() === 0)('a move that answers unmeasured, then a slot whose leaf cannot be looked at: failed quarantine-kept — the record and the slot KEPT, never cleared', () => {
    // step 4's `*)` arm: whether anything reached the slot could not be asked (the slot cannot be searched), so it is
    // neither refused as KEPT-foreign nor cleared as empty.
    const o = makeOrphan(h);
    const blind = "_ws_collect_move() { _WS_MOVE_WHY='stub: the move answered unmeasured'; chmod 000 \"${2%/leaf}\"; return 2; };";
    try {
      const r = collectVerb(h, collectToken(h), { pre: blind });
      expect(r.code, r.stdout + r.stderr).toBe(1);
      const doc = docOf(r.stdout);
      expect(doc['failed']).toBe('quarantine-kept');
      expect(String(doc['detail'])).toMatch(/^the quarantine record \S+ is kept, and nothing further was removed: .*whether anything reached its slot could not be asked/);
    } finally {
      for (const sl of slots(h)) fs.chmodSync(path.join(quarantineOf(h), sl), 0o700);
    }
    expect(slots(h), 'the slot, kept').toHaveLength(1);
    expect(records(h), 'the record, kept').toHaveLength(1);
    expect(inoAt(o.leaf), 'the leaf, where it was').toBe(o.ino);
  });

  it('an mv that COPIES: what reaches the slot is not the witnessed inode — KEPT there with its record, never moved back or unlinked', () => {
    const o = makeOrphan(h);
    const r = collectVerb(h, collectToken(h), {
      pre: intoSlot('cp -a -- "${@: -2:1}" "${@: -1}" && rm -rf -- "${@: -2:1}"; return'),
    });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const doc = docOf(r.stdout);
    expect(doc['refused'], 'anything not the witnessed leaf that reached a slot (ruling T8 OPEN5)').toBe('quarantine-kept');
    expect(String(doc['detail']), 'caught by the move’s own proof, before any re-proof').toContain('what reached');
    const slot = path.join(quarantineOf(h), slots(h)[0]!);
    expect(fs.readFileSync(path.join(slot, 'leaf', 'scratch.txt'), 'utf8'), 'the scratch, in the copy, kept in its slot').toBe('scratch\n');
    expect(inoAt(path.join(slot, 'leaf')), 'a copy is another inode').not.toBe(o.ino);
    expect(fs.existsSync(o.leaf), 'never moved back to the id’s path').toBe(false);
    expect(records(h), 'its record, kept').toHaveLength(1);
    expect(fs.readFileSync(witnessOf(h), 'utf8'), 'the witness stays: the slot is the operator’s').toBe(o.witness);
    expect(journal()).toEqual([['intent', null], ['refused', 'quarantine-kept']]);
  });

  it('a directory swapped in at the original path INSIDE the move — after its identity pre-check, before its rename — reaches the slot and is KEPT there', () => {
    // The one race that still lands a foreign object in a slot (ruling T8 OPEN5): Task 4's `_ws_collect_move` proves
    // the source is the witnessed leaf, and only then renames, so the swap must sit inside that window. The shim is
    // `_ws_collect_mv` itself, the ONE rename: it swaps the source, then runs the real `mv -T -n --no-copy`.
    const o = makeOrphan(h);
    const race = '_ws_collect_mv() { if [[ "$2" == */.ccd-quarantine/slot.*/leaf ]]; then'
      + ' command mv -- "$1" "$HOME/real" && mkdir -- "$1"; fi; mv -T -n --no-copy -- "$1" "$2"; };';
    const r = collectVerb(h, collectToken(h), { pre: race });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const doc = docOf(r.stdout);
    expect(doc['refused']).toBe('quarantine-kept');
    expect(String(doc['detail'])).toContain('what reached');
    const sleaf = path.join(quarantineOf(h), slots(h)[0]!, 'leaf');
    expect(fs.lstatSync(sleaf).isDirectory(), 'what the swap put at the path, now in the slot').toBe(true);
    expect(inoAt(sleaf)).not.toBe(o.ino);
    expect(fs.existsSync(o.leaf), 'never moved back to the id’s path').toBe(false);
    expect(fs.readFileSync(path.join(h.home, 'real', 'scratch.txt'), 'utf8'), 'the witnessed tree, where the swap put it')
      .toBe('scratch\n');
    expect(records(h), 'its record, kept').toHaveLength(1);
    expect(fs.readFileSync(witnessOf(h), 'utf8')).toBe(o.witness);
    expect(journal()).toEqual([['intent', null], ['refused', 'quarantine-kept']]);
  });

  for (const [what, swap] of SWAPS) {
    it(`${what} swapped in at the original path at the slotted gap never reaches a slot: the move refuses before renaming — probe-unmeasured, the empty slot and the record cleared`, () => {
      // Task 4's `_ws_collect_move` asks the source's identity BEFORE it renames (departure
      // move-asks-identity-before-the-rename), so what stands at the path is never renamed: the slot stays empty,
      // step 4's unmeasured arm clears it, and the swapped object stands untouched where it was put.
      const o = makeOrphan(h);
      const r = collectVerb(h, collectToken(h), { pre: gapAt('slotted', swap) });
      expect(r.code, r.stdout + r.stderr).toBe(1);
      const doc = docOf(r.stdout);
      expect(doc['failed']).toBe('probe-unmeasured');
      expect(String(doc['detail']), 'refused before anything was renamed').toContain('nothing reached its slot');
      expect(slots(h), 'the empty slot is cleared').toEqual([]);
      expect(records(h)).toEqual([]);
      expect(() => fs.lstatSync(leafOf(h)), `${what} still stands where it was`).not.toThrow();
      expect(inoAt(leafOf(h))).not.toBe(o.ino);
      expect(fs.readFileSync(path.join(h.home, 'real', 'scratch.txt'), 'utf8'), 'the witnessed tree').toBe('scratch\n');
      expect(fs.readFileSync(witnessOf(h), 'utf8')).toBe(o.witness);
      expect(journal()).toEqual([['intent', null], ['failed', 'probe-unmeasured']]);
    });
  }
});
