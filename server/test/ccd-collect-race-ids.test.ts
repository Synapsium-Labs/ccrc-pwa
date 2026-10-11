// IDS THAT ARE NOT WHAT THEY SEEM, AND A REGISTRY THAT CANNOT BE LISTED (child-workspace reclamation wave 7, spec
// 2026-09-22 §5.10). Ids admit dots, so a NESTED id (`p-calm-mesa.v2-quiet-river` beside `p-calm-mesa`) is legal: a
// record, a slot or a witness temp file is matched by an EXACT parse, never by an `<id>.*` prefix. A registry that can
// be searched but not listed (0300) blinds `_ws_slug_free` — measured: it answers free over a standing `.child` — so
// step 5 asks the marker rows (`.child`, `.uuid`) by direct lookup AND proves its own listing sees the reap lock it
// holds; otherwise the slug is unmeasured, never free. And a project named `cdk.out` is legal while the operator's
// `cdk.out*` sweep reaches depth 2 under `~/.cc-tmp`, where slots live: a slot is named `slot.…`, so no name-keyed rule
// meets it.
// FIXTURE HOME ONLY (`collectRaceFixture.ts`). Linux only, and only where `mv --no-copy` exists (spec §5.10).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import {
  COL_ID, G2_RUN, LINUX, NO_COPY, ROOT_USER, collectVerb, crashAt, crashedAt, devinoOf, docOf, gapAt, gapErrorsOf,
  gapsOf, lastVerdict, orphanLeaf, quarantineOf, recordsOf, regOf, settle, shownRounds, slotsOf, tmpRootOf, tokenOf, witnessOf,
} from './collectRaceFixture.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-collect-ids-'); });
afterEach(() => {
  try { fs.chmodSync(regOf(h), 0o700); } catch { /* gone */ }
  h.cleanup();
});

const A = 'p-calm-mesa';
const B = 'p-calm-mesa.v2-quiet-river';

describe.skipIf(!LINUX || !NO_COPY)('a NESTED id is never cross-matched', () => {
  it('records: B\'s kept `p-calm-mesa.v2-quiet-river.<ns>.<pid>` is never A\'s — not by the reader, not by A\'s collection', () => {
    expect(h.sh('_ws_project_valid p-calm-mesa.v2 && echo legal'), 'the CONTROL: the nested project is legal').toBe('legal');
    const a = orphanLeaf(h, A);
    const b = orphanLeaf(h, B);
    collectVerb(h, tokenOf(h, B), B, crashAt('moved'));
    expect(crashedAt(h), 'the CONTROL: B was killed in its slot').toBe('moved');
    const brec = recordsOf(h, B);
    const bslot = slotsOf(h, B);
    expect(brec, 'the CONTROL: B\'s record stands').toHaveLength(1);
    expect(bslot, 'the CONTROL: and its slot, `slot.<B>.<ns>.<pid>`').toHaveLength(1);
    const bkept = path.join(quarantineOf(h), bslot[0]!, 'leaf');
    expect(h.sh(`_ws_collect_records_of ${A}; :`), 'A has no record: B\'s is not one of A\'s').toBe('');
    expect(h.sh(`_ws_collect_records_of ${B}; :`).split('\n').filter(Boolean).map((p) => path.basename(p)),
      'B\'s, parsed exactly').toEqual(brec);
    const rounds = settle(h, A);
    expect(lastVerdict(rounds), shownRounds(rounds)).toBe('not-witnessed');
    expect(devinoOf(a.leaf), 'A was collected').toBeNull();
    expect(devinoOf(bkept), 'B\'s kept leaf is untouched').toBe(b.devino);
    expect(recordsOf(h, B), 'B\'s record stands').toEqual(brec);
    expect(slotsOf(h, B), 'and its slot').toEqual(bslot);
    expect(fs.existsSync(witnessOf(h, B)), 'and its witness').toBe(true);
    expect(lastVerdict(settle(h, B)), 'B finishes on its own').toBe('not-witnessed');
    expect(devinoOf(bkept)).toBeNull();
  }, 240_000);

  it('the witness writer\'s temp files: only `.<id>.<digits>.<digits>.tmp`, an hour old, is reaped — never a nested id\'s, a fresh one, or another shape', () => {
    orphanLeaf(h, A);
    orphanLeaf(h, B);
    const dir = path.join(regOf(h), 'tmproots');
    const names = {
      stale: `.${A}.4242.17.tmp`, fresh: `.${A}.4243.18.tmp`, nested: `.${B}.4244.19.tmp`,
      oneField: `.${A}.4245.tmp`, suffix: `.${A}.4246.20.tmp.x`,
    };
    const old = new Date(Date.now() - 2 * 3_600_000);
    for (const [k, n] of Object.entries(names)) {
      const p = path.join(dir, n);
      fs.writeFileSync(p, 'v=1 id=partial');
      if (k !== 'fresh') fs.utimesSync(p, old, old);
    }
    expect(lastVerdict(settle(h, A)), 'A was collected').toBe('not-witnessed');
    expect(fs.readdirSync(dir).filter((n) => n.startsWith('.')).sort(), 'only A\'s stale temp file went')
      .toEqual([names.fresh, names.nested, names.oneField, names.suffix].sort());
  }, 240_000);
});

describe.skipIf(!LINUX || !NO_COPY || ROOT_USER)('a registry that can be SEARCHED but not LISTED (0300): the slug proof is unmeasured, never free', () => {
  /** Step 5's row rule, answered "clear", so the slug proof is the ONLY question an unlistable registry can trip. */
  const ROWS_CLEAR = "_ws_collect_rows_clear() { _WS_COLLECT_ROWS_WHY=''; return 0; };";

  it('the CONTROL, measured: at 0300 a direct lookup still sees `.child`, while `_ws_slug_free` answers FREE over it', () => {
    const out = h.sh(`_reg_set ${COL_ID} child ${G2_RUN}; chmod 0300 "$REG";`
      + ` [[ -e "$REG/${COL_ID}.child" ]] && echo seen; _ws_slug_free demo calm-mesa; echo "rc=$?"; chmod 0700 "$REG"`);
    expect(out.split('\n'), 'if `_ws_slug_free` ever learns to see this, step 5\'s listing control is still the spec\'s rule')
      .toEqual(['seen', 'rc=0']);
    expect(h.sh('_ws_slug_free demo calm-mesa; echo "rc=$?"'), 'and at 0700 it sees it').toBe('rc=1');
  });

  it('a row lands at `moved` behind 0300: `_ws_slug_free` reads free, the listing cannot see the held lock — unmeasured; the leaf goes back', () => {
    const o = orphanLeaf(h);
    // A `.hold`: a row step 5's direct lookups (`.child`, `.uuid`) never ask, so only the listing can see it, and the
    // listing control is the one guard left (Task 5's own rung case plants the same).
    const r = collectVerb(h, tokenOf(h), COL_ID,
      `${ROWS_CLEAR} ${gapAt({ moved: `: > "$REG/${COL_ID}.hold" && chmod 0300 "$REG"` })}`);
    fs.chmodSync(regOf(h), 0o700);
    expect(gapsOf(h), 'the CONTROL: the seam fired at `moved`').toContain('moved');
    expect(gapErrorsOf(h), 'the CONTROL: the injection ran').toEqual([]);
    expect(fs.existsSync(path.join(regOf(h), `${COL_ID}.hold`)), 'the CONTROL: the row landed').toBe(true);
    expect(r.code, r.stdout + r.stderr).toBe(1);
    expect(docOf(r.stdout)['failed'], r.stdout).toBe('probe-unmeasured');
    expect(devinoOf(o.leaf), 'restored at the id').toBe(o.devino);
    expect(recordsOf(h)).toEqual([]);
    expect(slotsOf(h)).toEqual([]);
  }, 120_000);

  it('the CONTROL: the same row at 0700 — `_ws_slug_free` sees it: `registered`, the leaf goes back', () => {
    const o = orphanLeaf(h);
    const r = collectVerb(h, tokenOf(h), COL_ID, `${ROWS_CLEAR} ${gapAt({ moved: `: > "$REG/${COL_ID}.hold"` })}`);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(docOf(r.stdout)['refused'], r.stdout).toBe('registered');
    expect(devinoOf(o.leaf)).toBe(o.devino);
  }, 120_000);

  it('a `.child` lands at `moved` while `_ws_slug_free` is BLIND (stubbed free): step 5\'s DIRECT lookup alone sees it — `registered`, the leaf goes back', () => {
    const o = orphanLeaf(h);
    const r = collectVerb(h, tokenOf(h), COL_ID,
      `${ROWS_CLEAR} _ws_slug_free() { return 0; }; ${gapAt({ moved: `_reg_set ${COL_ID} child ${G2_RUN}` })}`);
    expect(gapErrorsOf(h)).toEqual([]);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(docOf(r.stdout)['refused'], r.stdout).toBe('registered');
    expect(devinoOf(o.leaf)).toBe(o.devino);
    expect(recordsOf(h)).toEqual([]);
  }, 120_000);
});

describe.skipIf(!LINUX || !NO_COPY)('a project named `cdk.out`', () => {
  it('its kept slot is `slot.cdk.out-…`, so the operator\'s `cdk.out*` sweep at depth 2 never matches it', () => {
    expect(h.sh('_ws_project_valid cdk.out && echo legal'), 'the CONTROL: the name is legal').toBe('legal');
    const id = 'cdk.out-calm-mesa';
    orphanLeaf(h, id);
    const target = path.join(tmpRootOf(h), 'demo-quiet-river', 'cdk.out');   // the sweep's own kind of target
    fs.mkdirSync(target, { recursive: true });
    collectVerb(h, tokenOf(h, id), id, crashAt('moved'));
    expect(crashedAt(h), 'the CONTROL: killed with the leaf in its slot').toBe('moved');
    // Everything in the quarantine, and the sweep's own target, made old enough for `-mmin +60`: only a NAME can
    // keep an entry out of the sweep now.
    const old = new Date(Date.now() - 2 * 3_600_000);
    for (const n of fs.readdirSync(quarantineOf(h))) fs.utimesSync(path.join(quarantineOf(h), n), old, old);
    fs.utimesSync(target, old, old);
    // The operator's unit, verbatim but for `-exec rm -rf` (here `-print`) and `%U` (here this uid).
    const swept = h.sh('find "$HOME/.cc-tmp" -mindepth 2 -maxdepth 2 -type d -name \'cdk.out*\' -user "$(id -u)" -mmin +60 -print')
      .split('\n').filter(Boolean);
    expect(swept, 'the sweep finds its own target, and never the slot').toEqual([target]);
    const slots = slotsOf(h, id);
    expect(slots, 'one slot, named `slot.<id>.<ns>.<pid>`').toHaveLength(1);
    expect(slots[0]).toMatch(/^slot\.cdk\.out-calm-mesa\.[0-9]+\.[0-9]+$/);
    const rounds = settle(h, id);
    expect(lastVerdict(rounds), shownRounds(rounds)).toBe('not-witnessed');
    expect(slotsOf(h, id)).toEqual([]);
  }, 240_000);
});
