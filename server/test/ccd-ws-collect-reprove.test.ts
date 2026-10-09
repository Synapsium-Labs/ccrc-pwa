// `ws-collect`'s step 5 (child reclamation wave 7, spec §5.10): every proof re-asked AFTER the move, each made to fail
// in the exact gap (`_ws_collect_gap moved`), and the restore any doubt takes — one NOREPLACE rename back, PROVEN by
// lstat — or, when that cannot be proven, the record and the slot KEPT and nothing in them removed.
// FIXTURE HOME ONLY. A case that narrows `$REG`'s mode restores it in `finally`; a case that starts a real process
// kills it in `finally`.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { eventsOf } from './lifecycleHelpers.js';
import {
  COL_ID, MOUNTS_SEAM, PROBE_STUB, ROWS_CLEAR, ROWS_STUB, collectAudit, collectToken, collectVerb, docOf, gapAt, holderAt, inoAt,
  killHolder, leafOf, linesOf, makeOrphan, origOf, quarantineOf, realMounts, records, regOf, slots, witnessOf,
  type Orphan,
} from './wsCollectFixture.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-ws-collect-reprove-'); });
afterEach(() => { killHolder(h); h.cleanup(); });

const LINUX = process.platform === 'linux';
const ROOT = process.getuid?.() === 0;

/** The leaf is back at its own path, the same inode, untouched; its slot and its record are gone; its witness is kept. */
const back = (o: Orphan): void => {
  expect(inoAt(o.leaf), 'the leaf is back at its own path, the same inode').toBe(o.ino);
  expect(fs.readFileSync(path.join(o.leaf, 'scratch.txt'), 'utf8'), 'its scratch is untouched').toBe('scratch\n');
  expect(slots(h), 'its slot is gone').toEqual([]);
  expect(records(h), 'its record is gone').toEqual([]);
  expect(fs.readFileSync(witnessOf(h), 'utf8'), 'its witness is kept').toBe(o.witness);
};
/** The intent, then ONE outcome in the intent's own transaction. */
const journaled = (outcome: string, token: string): void => {
  const ev = eventsOf(h.home, 'collect');
  expect(ev.map((e) => [e['outcome'], e['refusal'] ?? null])).toEqual([['intent', null], [outcome, token]]);
  expect(ev[1]!['tx'], 'it closes the intent’s transaction').toBe(ev[0]!['tx']);
};
const slotLeaf = (): string => path.join(quarantineOf(h), slots(h)[0]!, 'leaf');

describe.skipIf(!LINUX)('(a) and (b) — the id is registered again', () => {
  it('a child marker after the move: registered, moved back', () => {
    const o = makeOrphan(h);
    const r = collectVerb(h, collectToken(h), { pre: gapAt('moved', 'printf 7 > "$REG/$2.child"') });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(docOf(r.stdout)['refused']).toBe('registered');
    back(o);
    journaled('refused', 'registered');
  });

  it('a registry row after the move: registered, moved back', () => {
    const o = makeOrphan(h);
    const r = collectVerb(h, collectToken(h), { pre: gapAt('moved', 'printf x > "$REG/$2.uuid"') });
    expect(docOf(r.stdout)['refused']).toBe('registered');
    back(o);
  });

  it.skipIf(ROOT)('a child marker under a $REG that can be searched but not listed: the DIRECT lookup sees it', () => {
    const o = makeOrphan(h);
    try {
      const r = collectVerb(h, collectToken(h), { pre: gapAt('moved', 'printf 7 > "$REG/$2.child"; chmod 0300 "$REG"') });
      expect(docOf(r.stdout)['refused']).toBe('registered');
    } finally { fs.chmodSync(regOf(h), 0o700); }
    back(o);
  });

  it.skipIf(ROOT)('a row under a $REG that cannot be listed: the direct lookups miss it, `_ws_slug_free` reads free, the listing control does not — moved back', () => {
    const o = makeOrphan(h);
    try {
      const r = collectVerb(h, collectToken(h), {
        pre: `${ROWS_CLEAR} ${gapAt('moved', 'printf x > "$REG/$2.hold"; chmod 0300 "$REG"')}`,
      });
      expect(r.code).toBe(1);
      const doc = docOf(r.stdout);
      expect(doc['failed']).toBe('probe-unmeasured');
      expect(String(doc['detail'])).toContain('wildcard listing');
    } finally { fs.chmodSync(regOf(h), 0o700); }
    back(o);
    journaled('failed', 'probe-unmeasured');
  });
});

describe('the registry question itself (Task 5’s `_ws_collect_registered`, asked by step 5)', () => {
  it('an id that is not <project>-<slug> is never asked as another id: unmeasured, never free', () => {
    // `_ws_slug_free p s` asks `p-s`; split from a dash-less id, it would ask `nodash-nodash` and answer free.
    expect(h.sh('exec 9>>"$REG/.reap-nodash.lock";'
      + ' _ws_collect_registered nodash; printf \'%s\' "$?"')).toBe('2');
  });
});

describe.skipIf(!LINUX)('(c) — nobody uses it, on BOTH spellings', () => {
  it('a user of the path TMPDIR names (the probe’s string arm): in-use, moved back', () => {
    const o = makeOrphan(h);
    const r = collectVerb(h, collectToken(h),
      { pre: `${PROBE_STUB} ${gapAt('moved', 'printf \'%s\' "$HOME/.cc-tmp/$2" > "$HOME/busy-now"')}` });
    expect(docOf(r.stdout)['refused']).toBe('in-use');
    back(o);
    journaled('refused', 'in-use');
  });

  it('a user of the slot’s leaf (a cwd or an open file follows a rename): in-use, moved back', () => {
    const o = makeOrphan(h);
    const r = collectVerb(h, collectToken(h),
      { pre: `${PROBE_STUB} ${gapAt('moved', 'printf \'%s\' \'*/.ccd-quarantine/slot.*/leaf\' > "$HOME/busy-now"')}` });
    expect(docOf(r.stdout)['refused']).toBe('in-use');
    back(o);
  });

  it('a REAL process whose cwd is inside the moved tree: in-use, and the tree goes back with it', () => {
    const o = makeOrphan(h);
    const hold = holderAt('cd "$3/leaf" && exec sleep 30', '[[ "$(readlink "/proc/$_hp/cwd" 2>/dev/null)" == "$3/leaf" ]]');
    const r = collectVerb(h, collectToken(h), { pre: gapAt('moved', hold) });
    expect(docOf(r.stdout)['refused'], r.stdout + r.stderr).toBe('in-use');
    back(o);
  });

  it('a REAL process whose TMPDIR is the PHYSICAL original path (a `~/.cc-tmp` that is a link): in-use, moved back', () => {
    // `_ws_path_users` compares each path it is asked as given AND its physical twin (the parent resolved, the leaf
    // not followed), so step 5's ask of the TMPDIR spelling `_child_tmpdir` composes also asks the physical original
    // path, through the link, while nothing stands at either.
    const real = path.join(h.home, 'cctmp-real');
    fs.mkdirSync(real);
    fs.symlinkSync(real, path.join(h.home, '.cc-tmp'));
    const o = makeOrphan(h);
    expect(origOf(h), 'the CONTROL: the two spellings differ').not.toBe(leafOf(h));
    const phys = origOf(h);
    const hold = holderAt(`TMPDIR='${phys}' exec sleep 30`,
      `tr '\\0' '\\n' < "/proc/$_hp/environ" 2>/dev/null | grep -qxF 'TMPDIR=${phys}'`);
    const r = collectVerb(h, collectToken(h), { pre: gapAt('moved', hold) });
    expect(docOf(r.stdout)['refused'], r.stdout + r.stderr).toBe('in-use');
    back(o);
    journaled('refused', 'in-use');
  });

  it('a probe that could not measure: probe-unmeasured at exit 1, moved back', () => {
    const o = makeOrphan(h);
    const r = collectVerb(h, collectToken(h), { pre: `${PROBE_STUB} ${gapAt('moved', 'touch "$HOME/unmeasured-now"')}` });
    expect(r.code).toBe(1);
    expect(docOf(r.stdout)['failed']).toBe('probe-unmeasured');
    back(o);
    journaled('failed', 'probe-unmeasured');
  });
});

describe.skipIf(!LINUX)('(d) — no registry row at, inside or through the leaf, on its PRE-MOVE spelling', () => {
  it('is asked AFTER the move, of the LOGICAL pre-move spelling `_child_tmpdir` hands out, while nothing stands there', () => {
    makeOrphan(h);
    const r = collectVerb(h, collectToken(h), { pre: ROWS_STUB });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(linesOf(h, 'rows-asked').at(-1)).toBe(`${COL_ID}|${leafOf(h)}|absent`);
  });

  it('a row it finds: containment-unproven, moved back', () => {
    const o = makeOrphan(h);
    const r = collectVerb(h, collectToken(h), { pre: `${ROWS_STUB} ${gapAt('moved', 'printf 1 > "$HOME/rows-now"')}` });
    expect(docOf(r.stdout)['refused']).toBe('containment-unproven');
    back(o);
  });

  it('a row it cannot place: probe-unmeasured, moved back', () => {
    const o = makeOrphan(h);
    const r = collectVerb(h, collectToken(h), { pre: `${ROWS_STUB} ${gapAt('moved', 'printf 2 > "$HOME/rows-now"')}` });
    expect(docOf(r.stdout)['failed']).toBe('probe-unmeasured');
    back(o);
  });

  it('the real rule: another session’s row inside the pre-move spelling, written after the move — moved back, nothing removed', () => {
    const o = makeOrphan(h);
    const plant = 'printf x > "$REG/demo-other.uuid"; printf demo > "$REG/demo-other.project";'
      + ' printf \'%s\\n\' "$HOME/.cc-tmp/$2/repo" > "$REG/demo-other.workdir"';
    const r = collectVerb(h, collectToken(h), { pre: gapAt('moved', plant) });
    const doc = docOf(r.stdout);
    // Task 4's rule answers a row it places inside the leaf `containment-unproven`, and a row it cannot place (its
    // workdir moved with the leaf) unmeasured. Either way the leaf goes back, and that is what this pins.
    expect(['containment-unproven', 'probe-unmeasured']).toContain(doc['refused'] ?? doc['failed']);
    back(o);
  });
});

describe.skipIf(!LINUX)('(e) — nothing mounted at or under the slot’s leaf, in the kernel’s own table', () => {
  const mountAt = (sub: string): string =>
    gapAt('moved', `printf '9999 1 0:99 / %s rw,relatime - tmpfs tmpfs rw\\n' "$3/${sub}" >> "$HOME/mountinfo"`);

  for (const sub of ['leaf/mnt', 'leaf']) {
    it(`a mount at <slot>/${sub}: moved back, then probe-unmeasured (ruling T6 OPEN8)`, () => {
      const o = makeOrphan(h);
      realMounts(h);
      const r = collectVerb(h, collectToken(h), { pre: `${MOUNTS_SEAM} ${mountAt(sub)}` });
      expect(r.code).toBe(1);
      expect(docOf(r.stdout)['failed']).toBe('probe-unmeasured');
      back(o);
      journaled('failed', 'probe-unmeasured');
    });
  }

  it('the CONTROL: a mount at a SIBLING of the leaf is not under it — collected', () => {
    makeOrphan(h);
    realMounts(h);
    const r = collectVerb(h, collectToken(h), { pre: `${MOUNTS_SEAM} ${mountAt('leafy')}` });
    expect(docOf(r.stdout)['collected']).toBe(COL_ID);
  });

  it('mount points are compared ENCODED, as the kernel writes them — a space, a tab, a backslash', () => {
    // `_ws_collect_mounts_clear` compares text and never touches the path, so the directory need not exist.
    const dir = path.join(h.home, 'vol with\tspace\\and');
    const enc = (p: string): string =>
      p.replace(/\\/g, '\\134').replace(/ /g, '\\040').replace(/\t/g, '\\011').replace(/\n/g, '\\012');
    realMounts(h);
    fs.appendFileSync(path.join(h.home, 'mountinfo'), `9999 1 0:99 / ${enc(dir)}/leaf/mnt rw - tmpfs tmpfs rw\n`);
    const ask = (d: string): string => h.sh(`${MOUNTS_SEAM} _ws_collect_mounts_clear '${d}'; printf '%s' "$?"`);
    expect(ask(`${dir}/leaf`), 'the encoded line names a mount under it').toBe('1');
    expect(ask(`${dir}/leafy`), 'the CONTROL: a sibling is not under it').toBe('0');
  });

  it('a table that cannot be read: probe-unmeasured, moved back', () => {
    const o = makeOrphan(h);
    const r = collectVerb(h, collectToken(h), { pre: '_ws_collect_mountinfo() { printf \'%s\' "$HOME/no-such-table"; };' });
    expect(docOf(r.stdout)['failed']).toBe('probe-unmeasured');
    back(o);
  });

  it('a table with no mount in it: probe-unmeasured, moved back', () => {
    const o = makeOrphan(h);
    realMounts(h);
    const r = collectVerb(h, collectToken(h), { pre: `${MOUNTS_SEAM} ${gapAt('moved', ': > "$HOME/mountinfo"')}` });
    expect(docOf(r.stdout)['failed']).toBe('probe-unmeasured');
    back(o);
  });
});

describe.skipIf(!LINUX)('(f) — identity, asked LAST, directly before the removal', () => {
  it('the slot’s leaf swapped after the move: nothing removed, nothing moved back — KEPT, refused quarantine-kept (ruling T8 OPEN5)', () => {
    const o = makeOrphan(h);
    const r = collectVerb(h, collectToken(h), { pre: gapAt('moved', 'mv "$3/leaf" "$3/leaf.orig"; mkdir "$3/leaf"') });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const doc = docOf(r.stdout);
    expect(doc['refused']).toBe('quarantine-kept');
    expect(String(doc['detail'])).toContain('not the witnessed');
    const slot = path.join(quarantineOf(h), slots(h)[0]!);
    expect(inoAt(path.join(slot, 'leaf.orig')), 'the witnessed tree, kept in its slot').toBe(o.ino);
    expect(fs.existsSync(path.join(slot, 'leaf')), 'what the slot held, kept there').toBe(true);
    expect(fs.existsSync(o.leaf), 'nothing went to the leaf’s path').toBe(false);
    expect(records(h), 'its record, kept').toHaveLength(1);
    journaled('refused', 'quarantine-kept');
  });

  it('the slot’s leaf GONE after the move is no swap: failed probe-unmeasured at exit 1, nothing moved back, the record and slot standing — and the next pass finishes from them', () => {
    // `_ws_collect_ident`'s rc 1 is also "nothing stands, PROVEN". A leaf that left its slot is not something else
    // standing there, and there is nothing to move back: no restore is tried, the word is the resume's own for the
    // same vanish, and the next pass reads the phase `removed` off the disk and finishes the order.
    makeOrphan(h);
    const r = collectVerb(h, collectToken(h), { pre: gapAt('moved', 'rm -rf -- "$3/leaf"') });
    expect(r.code, r.stdout + r.stderr).toBe(1);
    const doc = docOf(r.stdout);
    expect(doc['failed']).toBe('probe-unmeasured');
    expect(String(doc['detail'])).toMatch(/^the record and its slot stand, and nothing was moved back or removed: .*vanished/);
    expect(records(h)).toHaveLength(1);
    expect(fs.readdirSync(path.join(quarantineOf(h), slots(h)[0]!)), 'the slot stands, empty').toEqual([]);
    expect(fs.existsSync(leafOf(h)), 'nothing was moved back').toBe(false);
    journaled('failed', 'probe-unmeasured');
    const r2 = collectVerb(h, collectToken(h));
    expect(r2.code, r2.stdout + r2.stderr).toBe(0);
    expect(docOf(r2.stdout)).toMatchObject({ collected: COL_ID, resumed: true, witness: 'dropped' });
    expect(slots(h)).toEqual([]);
    expect(records(h)).toEqual([]);
  });
});

describe.skipIf(!LINUX)('the record, re-read after the move as the authority', () => {
  it('a record PROVEN gone after the move (the reader’s rc 1): failed quarantine-kept, the leaf kept in its slot — and the next audit refuses that slot as the operator’s', () => {
    // Only an actor that does not take the reap lock removes a record. The leaf stays in its slot, nothing is moved
    // back or removed, and with no record naming the slot the next audit answers it TERMINAL, the witness kept.
    const o = makeOrphan(h);
    const r = collectVerb(h, collectToken(h), { pre: gapAt('moved', 'rm -f -- "$REG/tmpquarantine/${3##*/slot.}"') });
    expect(r.code, r.stdout + r.stderr).toBe(1);
    const doc = docOf(r.stdout);
    expect(doc['failed']).toBe('quarantine-kept');
    expect(String(doc['detail'])).toMatch(/^the leaf stays in its slot .*: its quarantine record .* vanished after the move$/);
    expect(inoAt(slotLeaf()), 'the leaf, still in its slot').toBe(o.ino);
    expect(fs.readFileSync(witnessOf(h), 'utf8')).toBe(o.witness);
    journaled('failed', 'quarantine-kept');
    const audit = JSON.parse(collectAudit(h).stdout.trim().split('\n').pop()!) as Record<string, unknown>;
    expect(audit['verdict'], 'a slot with no record is the operator’s').toBe('quarantine-kept');
    expect(inoAt(slotLeaf())).toBe(o.ino);
    expect(fs.readFileSync(witnessOf(h), 'utf8')).toBe(o.witness);
  });

  it('a record that no longer reads as ccd writes it after the move (the reader’s rc 2): failed quarantine-kept, the record and the leaf kept in its slot', () => {
    const o = makeOrphan(h);
    const r = collectVerb(h, collectToken(h),
      { pre: gapAt('moved', 'printf \'v=1 junk\\n\' > "$REG/tmpquarantine/${3##*/slot.}"') });
    expect(r.code, r.stdout + r.stderr).toBe(1);
    const doc = docOf(r.stdout);
    expect(doc['failed']).toBe('quarantine-kept');
    expect(String(doc['detail'])).toMatch(/^the quarantine record \S+ is kept, and nothing further was removed: .*could not be read back after the move$/);
    expect(records(h)).toHaveLength(1);
    expect(inoAt(slotLeaf()), 'the leaf, still in its slot').toBe(o.ino);
    expect(fs.existsSync(o.leaf)).toBe(false);
    journaled('failed', 'quarantine-kept');
  });

  it('a re-read whose slot cannot be derived (the reader’s rc 3, ruling R-a): failed probe-unmeasured — the record and its slot stand, nothing moved or removed', () => {
    const o = makeOrphan(h);
    const unresolved = gapAt('moved', "_ws_collect_record_read() { _WS_QPATH_WHY='stub: ~/.cc-tmp cannot be resolved'; return 3; }");
    const r = collectVerb(h, collectToken(h), { pre: unresolved });
    expect(r.code, r.stdout + r.stderr).toBe(1);
    const doc = docOf(r.stdout);
    expect(doc['failed']).toBe('probe-unmeasured');
    expect(String(doc['detail'])).toContain('stub: ~/.cc-tmp cannot be resolved');
    expect(records(h), 'the record stands').toHaveLength(1);
    expect(inoAt(slotLeaf()), 'the leaf, still in its slot').toBe(o.ino);
    expect(fs.existsSync(o.leaf), 'nothing moved back').toBe(false);
    expect(fs.readFileSync(witnessOf(h), 'utf8')).toBe(o.witness);
    journaled('failed', 'probe-unmeasured');
    expect(docOf(collectVerb(h, collectToken(h)).stdout), 'resolvable again, the next pass finishes from the record')
      .toMatchObject({ collected: COL_ID, resumed: true });
  });
});

describe.skipIf(!LINUX)('the restore — NOREPLACE, proven by lstat, or the record and the slot KEPT', () => {
  it('a path retaken since the move is never clobbered: TERMINAL — refused quarantine-kept at exit 0 (ruling T8 OPEN4)', () => {
    const o = makeOrphan(h);
    const retake = 'printf 7 > "$REG/$2.child"; mkdir -p "$HOME/.cc-tmp/$2"; echo new > "$HOME/.cc-tmp/$2/new.txt"';
    const r = collectVerb(h, collectToken(h), { pre: gapAt('moved', retake) });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(docOf(r.stdout)['refused']).toBe('quarantine-kept');
    expect(fs.readFileSync(path.join(o.leaf, 'new.txt'), 'utf8'), 'the new leaf is untouched').toBe('new\n');
    expect(inoAt(slotLeaf()), 'the witnessed leaf, kept in its slot').toBe(o.ino);
    expect(records(h)).toHaveLength(1);
    journaled('refused', 'quarantine-kept');
  });

  it('a restore that mv claims and does not make is not a restore: KEPT', () => {
    const o = makeOrphan(h);
    const noop = 'mv() { if [[ "$1" != --help && "${@: -2:1}" == */.ccd-quarantine/slot.*/leaf ]]; then return 0; fi; command mv "$@"; };';
    const r = collectVerb(h, collectToken(h), { pre: `${noop} ${gapAt('moved', 'printf 7 > "$REG/$2.child"')}` });
    expect(docOf(r.stdout)['failed']).toBe('quarantine-kept');
    expect(inoAt(slotLeaf())).toBe(o.ino);
    expect(fs.existsSync(o.leaf)).toBe(false);
    expect(records(h)).toHaveLength(1);
  });

  it('a restore that put the leaf anywhere but its own path is not a restore: KEPT', () => {
    const o = makeOrphan(h);
    const astray = 'mv() { if [[ "$1" != --help && "${@: -2:1}" == */.ccd-quarantine/slot.*/leaf ]]; then'
      + ' command mv -- "${@: -2:1}" "$HOME/astray" && mkdir "${@: -1}"; return 0; fi; command mv "$@"; };';
    const r = collectVerb(h, collectToken(h), { pre: `${astray} ${gapAt('moved', 'printf 7 > "$REG/$2.child"')}` });
    expect(docOf(r.stdout)['failed']).toBe('quarantine-kept');
    expect(inoAt(path.join(h.home, 'astray'))).toBe(o.ino);
    expect(records(h), 'the record that knows where it was').toHaveLength(1);
  });

  it('a slot that holds anything besides its leaf is never emptied by force: KEPT, what it holds stands', () => {
    const o = makeOrphan(h);
    const seam = '_ws_collect_gap() { case "$1" in moved) printf 7 > "$REG/$2.child" ;; restoring) printf s > "$3/stray" ;; esac; };';
    const r = collectVerb(h, collectToken(h), { pre: seam });
    expect(docOf(r.stdout)['failed']).toBe('quarantine-kept');
    expect(inoAt(o.leaf), 'the leaf itself did go back').toBe(o.ino);
    expect(fs.readFileSync(path.join(quarantineOf(h), slots(h)[0]!, 'stray'), 'utf8')).toBe('s');
    expect(records(h)).toHaveLength(1);
  });
});

describe.skipIf(!LINUX)('the test holder is killed only while it is the holder', () => {
  it('`killHolder` signals the pid in holder.pid only while its cmdline is `sleep 30`: a reused pid is never killed', async () => {
    const other = spawn('sleep', ['31'], { stdio: 'ignore' });
    const holder = spawn('sleep', ['30'], { stdio: 'ignore' });
    const holderExit = new Promise<string | null>((res) => { holder.once('exit', (_c, sig) => res(sig)); });
    try {
      await new Promise((r) => { setTimeout(r, 200); });
      fs.writeFileSync(path.join(h.home, 'holder.pid'), `${other.pid}\n`);
      killHolder(h);
      fs.writeFileSync(path.join(h.home, 'holder.pid'), `${holder.pid}\n`);
      killHolder(h);
      expect(await holderExit, 'the holder itself is killed').toBe('SIGKILL');
      expect([other.exitCode, other.signalCode], 'another process under the recorded pid is left alone').toEqual([null, null]);
    } finally {
      other.kill('SIGKILL'); holder.kill('SIGKILL');
      fs.rmSync(path.join(h.home, 'holder.pid'), { force: true });
    }
  });
});
