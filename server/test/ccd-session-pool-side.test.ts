// The Overlord W1 pool set, PR A2 (plan `docs/superpowers/plans/2026-11-14-overlord-w1/w1-pool-set.md`, Task 3): the one
// reader of a session's pool side, `ccd/lib/pool-set.sh#_session_pool_side`, and the two sentences a set side renders.
//
// What it must hold (Review Focus 1 and 2): a `poolset` entry that EXISTS is never "no set". A link, a directory, a FIFO or
// an unreadable file answers `set-unreadable`; bytes that are not one spelling (a NUL, zero bytes, past the cap, a CR, a
// trailing newline) answer `set-malformed`; neither falls back to the project, which for the Overlord is an untagged project
// every account serves. Without an entry the answer is the project's word, exactly as `_project_pool_state` gives it today.
//
// Pool names are the fixture table's (`pool-a`, `pool-b`); no real pool, account or path appears here.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';
import { itLinux } from './platformFixtures.js';

let h: CcdHarness;
let reg: string;
beforeEach(() => {
  h = makeCcdHarness('ccrc-ccd-session-pool-side-');
  reg = path.join(h.home, '.cc-sessions');
  fs.mkdirSync(reg, { recursive: true });
});
afterEach(() => {
  // A case that took `x` off the registry, or `r` off a field, gives it back before the harness removes the tree.
  try { fs.chmodSync(reg, 0o755); } catch { /* absent */ }
  h.cleanup();
});

const ID = 'claude-overlord';
const PROJECT = 'project-a';
const setFile = (): string => path.join(reg, `${ID}.poolset`);
const plantSet = (bytes: string | Buffer): void => { fs.writeFileSync(setFile(), bytes); };
const tagProject = (bytes: string): void => {
  fs.mkdirSync(path.join(reg, 'pools'), { recursive: true });
  fs.writeFileSync(path.join(reg, 'pools', PROJECT), bytes);
};
/** The reader's word, with its exit status, called with the project passed (the form every user of Task 4 takes). */
const side = (extra = ''): string => h.sh(`out=$(_session_pool_side ${ID} ${PROJECT} ${extra}); printf '%s|rc=%s' "$out" "$?"`);
/** The same with no project argument: the row's own `project` field is read. */
const sideOfRow = (): string => h.sh(`out=$(_session_pool_side ${ID}); printf '%s|rc=%s' "$out" "$?"`);

/** The project's four words, each planted the way `_project_pool_state` reads it. */
const PROJECT_STATES: ReadonlyArray<readonly [string, () => void, string]> = [
  ['untagged (no tag file)', () => {}, 'untagged'],
  ['named pool-a', () => tagProject('pool-a\n'), 'named pool-a'],
  ['unreadable (a directory at the tag path)', () => fs.mkdirSync(path.join(reg, 'pools', PROJECT), { recursive: true }), 'unreadable'],
  ['malformed (off the name grammar)', () => tagProject('Pool-A\n'), 'malformed'],
];

describe('_session_pool_side: no set stands, so the project decides as it does today (Review Focus 2)', () => {
  it.each(PROJECT_STATES)('no poolset entry: %s answers the project\'s word', (_n, plant, want) => {
    plant();
    expect(side()).toBe(`${want}|rc=0`);
    // The same word `_project_pool_state` prints: the reader adds nothing for a session without a set.
    expect(h.sh(`_project_pool_state ${PROJECT}`)).toBe(want);
  });

  it('a $REG that cannot be searched answers unreadable (a passed project, as _project_pool_state answers there)', () => {
    tagProject('pool-a\n');
    plantSet('pool-b');
    fs.chmodSync(reg, 0o600);
    const got = side();
    fs.chmodSync(reg, 0o755);
    expect(got).toBe('unreadable|rc=0');
  });

  it('a $REG that cannot be searched answers unreadable whatever the project argument, an empty one included (review 2134 F2)', () => {
    // It cannot know whether a set stands, so it never answers the empty project's `untagged`, which would ignore one.
    plantSet('pool-b');
    h.sh(`_reg_set ${ID} project ${PROJECT}`);
    fs.chmodSync(reg, 0o600);
    const empty = h.sh(`out=$(_session_pool_side ${ID} ''); printf '%s|rc=%s' "$out" "$?"`);
    const none = sideOfRow();
    fs.chmodSync(reg, 0o755);
    expect(empty).toBe('unreadable|rc=0');
    expect(none).toBe('unreadable|rc=0');
  });

  it('a passed EMPTY project is a project argument, not "no project": the row\'s field is not read', () => {
    tagProject('pool-a\n');
    h.sh(`_reg_set ${ID} project ${PROJECT}`);
    expect(h.sh(`out=$(_session_pool_side ${ID} ''); printf '%s|rc=%s' "$out" "$?"`)).toBe('untagged|rc=0');
    expect(sideOfRow(), 'the control: with no argument the row names the tagged project').toBe('named pool-a|rc=0');
  });

  it('no project argument and the row has no project field: the empty name, which reads untagged (as _swap_target reads it)', () => {
    tagProject('pool-a\n');
    expect(sideOfRow()).toBe('untagged|rc=0');
  });

  it('no project argument and the row\'s project field cannot be read: unreadable while a project can be tagged', () => {
    tagProject('pool-a\n');
    fs.mkdirSync(path.join(reg, `${ID}.project`));   // a directory at a field path is _reg_read's rc 2
    expect(sideOfRow()).toBe('unreadable|rc=0');
  });

  it('…and the empty name (untagged) when no project can be tagged at all (_pool_untaggable)', () => {
    fs.mkdirSync(path.join(reg, `${ID}.project`));
    expect(fs.existsSync(path.join(reg, 'pools'))).toBe(false);
    expect(sideOfRow()).toBe('untagged|rc=0');
  });
});

describe('_session_pool_side: a readable set binds, and the project\'s tag does not', () => {
  it.each(PROJECT_STATES)('a valid poolset answers its spelling whatever the project is: %s', (_n, plant) => {
    plant();
    plantSet('pool-b');
    expect(side()).toBe('set pool-b|rc=0');
  });

  it.each(['pool-a,pool-b', 'pool-b+untagged', '+untagged', 'pool-a,pool-ab+untagged'])('%s reads back as itself', (spelling) => {
    plantSet(spelling);
    expect(side()).toBe(`set ${spelling}|rc=0`);
  });

  it('a spelling of exactly 1,024 bytes (the cap) is read whole and binds', () => {
    const at = Array.from({ length: 205 }, (_, i) => `p${String(i).padStart(3, '0')}`).join(',');
    expect(at.length).toBe(1024);
    plantSet(at);
    expect(side()).toBe(`set ${at}|rc=0`);
  });

  it('with no project argument the set is read before the row\'s project field is ever asked', () => {
    plantSet('pool-b');
    fs.mkdirSync(path.join(reg, `${ID}.project`));
    expect(sideOfRow()).toBe('set pool-b|rc=0');
  });
});

describe('_session_pool_side: a set that exists but cannot be read is undecidable, never the project (Review Focus 1)', () => {
  // Every row tags the project `pool-a`, so a fall-back would print `named pool-a` and be told apart from the right answer.
  beforeEach(() => { tagProject('pool-a\n'); });

  it('mode 000', () => {
    plantSet('pool-b');
    fs.chmodSync(setFile(), 0o000);
    expect(side()).toBe('set-unreadable|rc=0');
  });
  it('a directory at the field path', () => {
    fs.mkdirSync(setFile());
    expect(side()).toBe('set-unreadable|rc=0');
  });
  it('a dangling symlink', () => {
    fs.symlinkSync(path.join(h.home, 'nowhere'), setFile());
    expect(side()).toBe('set-unreadable|rc=0');
  });
  it('a symlink to a readable file holding a valid spelling (a link is not a field)', () => {
    const elsewhere = path.join(h.home, 'elsewhere');
    fs.writeFileSync(elsewhere, 'pool-a');
    fs.symlinkSync(elsewhere, setFile());
    expect(side()).toBe('set-unreadable|rc=0');
  });
  itLinux('a FIFO (never opened: the type test comes first, so the reader cannot block)', () => {
    execFileSync('mkfifo', [setFile()]);
    expect(side()).toBe('set-unreadable|rc=0');
  });
});

describe('_session_pool_side: bytes that are not one spelling are set-malformed, never the project (Review Focus 1)', () => {
  beforeEach(() => { tagProject('pool-a\n'); });

  it.each<readonly [string, string | Buffer]>([
    ['unsorted', 'pool-b,pool-a'],
    ['a repeat', 'pool-a,pool-a'],
    ['zero bytes', ''],
    // The coordinator's ruling for A2: the bounded read, never `_route_get`/`_route_peek`, which drop trailing newlines and
    // NULs before validating, so these two would otherwise read as `pool-a`.
    ['a trailing newline', 'pool-a\n'],
    ['a trailing NUL', Buffer.from('pool-a\0')],
    ['a NUL inside', Buffer.from('pool-a\0+untagged')],
    ['a CR', 'pool-a\r'],
    ['CRLF', 'pool-a\r\n'],
    ['one byte past the cap (1,025)', `${Array.from({ length: 205 }, (_, i) => `p${String(i).padStart(3, '0')}`).join(',')}x`],
    ['far past the cap (5,000 bytes)', 'a'.repeat(5000)],
    ['a name off POOL_NAME_RE', 'Pool-A'],
  ])('%s', (_n, bytes) => {
    plantSet(bytes);
    expect(side()).toBe('set-malformed|rc=0');
  });

  itLinux('an open that fails inside the bounded read leaves zero bytes, which is set-malformed (fail-closed)', () => {
    // The type and mode tests pass, then the open itself fails: with no free descriptor the redirection cannot open the
    // file, so the read never runs. Nothing else in the function opens a file before it. (No redirection on the call
    // itself: bash saves the old descriptor first, which would fail the same way and run nothing at all.)
    plantSet('pool-b');
    expect(h.sh(`out=$( ulimit -n 3; _session_pool_side ${ID} ${PROJECT} ); printf '%s' "$out"`))
      .toBe('set-malformed');
    // The control: the same call with descriptors to spare reads the set.
    expect(h.sh(`out=$( _session_pool_side ${ID} ${PROJECT} ); printf '%s' "$out"`)).toBe('set pool-b');
  });

  const enUs = ((): string | undefined => {
    try { return execFileSync('locale', ['-a'], { encoding: 'utf8' }).split('\n').map((l) => l.trim()).find((l) => /^en_US\.utf-?8$/i.test(l)); }
    catch { return undefined; }
  })();
  it.runIf(enUs !== undefined)('the same bytes give the same word under LC_ALL=C and en_US.UTF-8', () => {
    // `pool-b,poola` ascends in bytes but not in en_US collation; `poola,pool-b` the reverse; U+3000 is not one byte.
    for (const [bytes, want] of [['pool-b,poola', 'set pool-b,poola'], ['poola,pool-b', 'set-malformed'], ['pool-a　', 'set-malformed']] as const) {
      plantSet(bytes);
      const c = h.sh(`_session_pool_side ${ID} ${PROJECT}`, { LC_ALL: 'C' });
      const u = h.sh(`_session_pool_side ${ID} ${PROJECT}`, { LC_ALL: enUs! });
      expect(c, bytes).toBe(want);
      expect(u, bytes).toBe(want);
    }
  });

  it('the reader holds its locale and field splitting itself (local LC_ALL=C IFS=\' \', as A1\'s parsers do)', () => {
    const body = h.sh('declare -f _session_pool_side');
    expect(body).toMatch(/local LC_ALL=C IFS=' '/);
    plantSet('pool-a,pool-b');
    expect(h.sh(`IFS=,; _session_pool_side ${ID} ${PROJECT}`)).toBe('set pool-a,pool-b');
  });
});

describe('the sentences: today\'s project and account arms, unchanged (characterization, green on main)', () => {
  it('_pool_undecidable_why: the project arm names the tag file', () => {
    for (const st of ['unreadable', 'malformed']) {
      expect(h.sh(`_pool_undecidable_why project ${st} ${PROJECT} claude`))
        .toBe(`pool tag for ${PROJECT} is ${st}: ${reg}/pools/${PROJECT} — fix or clear it`);
    }
  });
  it('_pool_undecidable_why: the account arms name the projection and say the project tag reads fine', () => {
    const tail = `project '${PROJECT}' is tagged and its tag reads fine`;
    expect(h.sh(`_pool_undecidable_why account stale ${PROJECT} claude`))
      .toBe(`the pool projection for claude is stale: ${reg}/pool-epoch is past its lease — the remedy is the control-plane link (the pool sync), not this file; ${tail}`);
    expect(h.sh(`_pool_undecidable_why account malformed ${PROJECT} claude`))
      .toBe(`the pool projection for claude is malformed: ${reg}/pool-epoch is off the grammar — re-sync or remove it; ${tail}`);
    expect(h.sh(`_pool_undecidable_why account unreadable ${PROJECT} claude`))
      .toBe(`the pool projection for claude is unreadable: ${reg}/pool-epoch is absent or unreadable — this node may never have synced; check that and the file's permissions; ${tail}`);
  });
  it('_pool_mismatch_why: a project side names both pools', () => {
    expect(h.sh(`_pool_mismatch_why claude 'named pool-a' ${PROJECT} 'named pool-b'`))
      .toBe(`claude is in pool 'pool-a' (measured from the projection, ${reg}/pool-epoch — not the declared roster) and project '${PROJECT}' is in pool 'pool-b'`);
  });
});

describe('the sentences: a set side names the route record and its remedy (Review Focus 4)', () => {
  it('_pool_undecidable_why\'s set arm names $REG/<id>.poolset, its two remedies, and that the project\'s tag is not involved', () => {
    for (const st of ['unreadable', 'malformed', 'unrecognised']) {
      const s = h.sh(`_pool_undecidable_why set ${st} ${PROJECT} claude ${ID}`);
      expect(s, st).toBe(`the pool set for session ${ID} is ${st}: ${reg}/${ID}.poolset — the server writes it again at its next sweep, or the operator saves the set again in Settings; the project's tag is not involved`);
      expect(s, 'never the project\'s tag file').not.toContain(`pools/${PROJECT}`);
    }
  });
  it('the account arms, given the session id after a set decided, say the set decided, never that the project\'s tag reads fine (review 2134 F1)', () => {
    // The id is passed only when the session's side is a set: an undecidable ACCOUNT under a valid set. Without it the
    // sentences are today's, byte for byte (the characterization block above).
    const tail = 'the session\'s pool set decided; the project\'s tag is not involved';
    expect(h.sh(`_pool_undecidable_why account stale ${PROJECT} claude ${ID}`))
      .toBe(`the pool projection for claude is stale: ${reg}/pool-epoch is past its lease — the remedy is the control-plane link (the pool sync), not this file; ${tail}`);
    expect(h.sh(`_pool_undecidable_why account malformed ${PROJECT} claude ${ID}`))
      .toBe(`the pool projection for claude is malformed: ${reg}/pool-epoch is off the grammar — re-sync or remove it; ${tail}`);
    expect(h.sh(`_pool_undecidable_why account unreadable ${PROJECT} claude ${ID}`))
      .toBe(`the pool projection for claude is unreadable: ${reg}/pool-epoch is absent or unreadable — this node may never have synced; check that and the file's permissions; ${tail}`);
    for (const st of ['stale', 'malformed', 'unreadable']) {
      expect(h.sh(`_pool_undecidable_why account ${st} ${PROJECT} claude ${ID}`), st).not.toContain('tag reads fine');
      expect(h.sh(`_pool_undecidable_why account ${st} ${PROJECT} claude`), st).toContain(`project '${PROJECT}' is tagged and its tag reads fine`);
    }
  });
  it('_pool_mismatch_why for a set names the spelling, and says the account\'s pool is not in it', () => {
    expect(h.sh(`_pool_mismatch_why claude 'named pool-a' ${PROJECT} 'set pool-b,pool-c'`))
      .toBe(`claude is in pool 'pool-a' (measured from the projection, ${reg}/pool-epoch) and that pool is not in the session's pool set 'pool-b,pool-c'`);
  });
  it('…or that the account is in no pool and the set does not admit untagged accounts', () => {
    expect(h.sh(`_pool_mismatch_why claude-d untagged ${PROJECT} 'set pool-b'`))
      .toBe('claude-d is in no pool and the session\'s pool set \'pool-b\' does not admit untagged accounts');
  });
});
