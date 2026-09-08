// Spec §5.4.4. `io.readdir` answers `string[] | null` and folds "the directory
// is not there" into "the directory would not list" (`io.ts:96` — the one read
// with no measured sibling). This reader splits them ONE LEVEL UP, off the
// registry root listing the caller already took, the same trick `readLimits`
// plays for `-disabled` markers. Getting that split wrong in the permissive
// direction silently LIFTS every project's pool constraint, which is the whole
// class of defect this feature exists inside.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { localIO } from '../src/io.js';
import { CCD_ARGV } from '../src/ccdargv.js';
import {
  POOLS_DIR_NAME, poolFor, poolsEnforcement, poolsWire, readProjectPools,
} from '../src/pools.js';
import { absentReadIO, degradedReadIO } from './ioDoubles.js';
import { seedRoster } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

let home: string;
let reg: string;
let pools: string;

beforeEach(() => {
  home = mkTmp('ccrc-pools-read-');
  seedRoster(home);
  reg = path.join(home, '.cc-sessions');
  pools = path.join(reg, POOLS_DIR_NAME);
  mkdirSync(reg, { recursive: true });
});

afterEach(() => { rmSync(home, { recursive: true, force: true }); });

const cfg = () => loadConfig({ CCRC_HOME: home });
const rootNames = async (): Promise<string[] | null> => localIO.readdir(reg);
const tag = (project: string, bytes: string): void => {
  mkdirSync(pools, { recursive: true });
  writeFileSync(path.join(pools, project), bytes);
};

describe('readProjectPools — absent, unlistable and the four per-entry states', () => {
  it('a null ROOT listing is listed:false — the registry itself could not be read', async () => {
    const read = await readProjectPools(localIO, cfg(), null);
    expect(read).toEqual({ listed: false });
    expect(poolFor(read, 'demo')).toEqual({ state: 'unreadable' });
  });

  it('a root listing WITHOUT pools/ is a MEASURED absence — every project untagged', async () => {
    // Ruling 3: nothing strands on rollout. Nobody has tagged anything, and
    // that is a positive answer, not a failure to look.
    const read = await readProjectPools(localIO, cfg(), await rootNames());
    expect(read).toEqual({ listed: true, tags: new Map() });
    expect(poolFor(read, 'demo')).toEqual({ state: 'untagged' });
  });

  it('pools/ present at the root but unlistable is listed:false — never a fleet of untagged projects', async () => {
    // A REGULAR FILE planted where the directory belongs: `localIO.readdir`
    // answers null for it, exactly as it does for EACCES and exactly as
    // `remote/io.ts` answers for a whitelist refusal (`remote/io.ts:104-112`).
    // The permissive reading — an empty map — would lift every tag on the box.
    writeFileSync(pools, 'not a directory');
    const read = await readProjectPools(localIO, cfg(), await rootNames());
    expect(read).toEqual({ listed: false });
    expect(poolFor(read, 'demo')).toEqual({ state: 'unreadable' });
  });

  it('reads a tag, strips a trailing newline, and refuses a leading space', async () => {
    // `printf '%s'` is the verb's writer, `echo` is the 2am writer (ruling 2),
    // so trailing whitespace is stripped — TRAILING ONLY. A leading space is
    // malformed on both sides or the two readers disagree.
    //
    // AGREEMENT IS DECIDED ONE LINE EARLIER THAN THIS COMMENT USED TO SAY.
    // It read "byte for byte with `_project_pool_state`'s
    // `v=${v%"${v##*[![:space:]]}"}`", and that quote is still VERBATIM
    // correct — what stopped being true is its SUFFICIENCY. Wave 2a inserted a
    // 64-byte read cap ABOVE the strip (`grep -n "read -r -d '' -n 64" ccd/ccd`,
    // D-1850), and the strip cannot see it: a valid name padded with 58+ bytes
    // of trailing whitespace is `malformed` to `ccd` and would strip back to a
    // clean tag here. The cap is mirrored below, and the padded case is one of
    // the cases in this describe.
    tag('demo', 'pool-a');
    tag('quiet-basin', 'pool-b\n');
    tag('acct-a-demo', ' pool-a');
    const read = await readProjectPools(localIO, cfg(), await rootNames());
    expect(poolFor(read, 'demo')).toEqual({ state: 'tagged', name: 'pool-a' });
    expect(poolFor(read, 'quiet-basin')).toEqual({ state: 'tagged', name: 'pool-b' });
    expect(poolFor(read, 'acct-a-demo')).toEqual({ state: 'malformed' });
  });

  it('a tag padded to 64 bytes is malformed, and 63 still strips to a name', async () => {
    // RULING 1's case, and the one that decides the CAP rather than the strip.
    // `ccd`'s `IFS= read -r -d '' -n 64` succeeds AT 64 characters, so 64 is
    // already `malformed` there (measured: 63 -> rc 1, 64 -> rc 0). The pair
    // below is deliberately one byte apart, because a cap written `> 64`
    // passes the 64 case, strips it, and answers `tagged` — agreeing with
    // `ccd` on 65 and disagreeing on exactly the boundary (D-2010).
    tag('demo', 'pool-a' + ' '.repeat(58));        // 6 + 58 = 64
    tag('quiet-basin', 'pool-b' + ' '.repeat(57)); // 6 + 57 = 63
    // THE NUL, AND WHAT THIS ASSERTION DOES NOT MEASURE — said here because a
    // green expectation that cannot fail is worse than no expectation at all,
    // and this one cannot. `ccd` needs the NUL arm: `read -d ''` STOPS at the
    // delimiter, so `pool-a\0junk` would otherwise yield the valid prefix
    // `pool-a` and place on a pool the file does not name. The SERVER cannot
    // reach that state — it holds the whole string — and `POOL_NAME_RE`
    // (`/^[a-z][a-z0-9-]{0,31}$/`, anchored, and its class excludes `\0`) already
    // answers `malformed` for every NUL-bearing content. `\s` does not include
    // `\0` either, so the strip cannot remove one. MEASURED: delete
    // `.includes('\0')` from the mirror and this whole file stays green.
    // The arm is kept because ruling 1 requires it and because it states the
    // parity at the site, but it is a DOCUMENTED NO-OP, not a pinned guard —
    // the same treatment C1's M19 got rather than a case written to look red.
    // VOID (i.e. it becomes load-bearing, and this comment becomes wrong) if
    // `POOL_NAME_RE` ever admits a NUL, or if the cap is ever applied to the
    // STRIPPED value, or if this reader ever stops holding the whole string.
    tag('acct-a-demo', 'pool-a\0pool-b');
    const read = await readProjectPools(localIO, cfg(), await rootNames());
    expect(poolFor(read, 'demo')).toEqual({ state: 'malformed' });
    expect(poolFor(read, 'quiet-basin')).toEqual({ state: 'tagged', name: 'pool-b' });
    expect(poolFor(read, 'acct-a-demo'),
      'malformed — but by the name grammar, not by the cap: see above').toEqual({ state: 'malformed' });
  });

  it('two tokens, uppercase and an empty file are all malformed — never untagged', async () => {
    tag('demo', 'pool a');
    tag('quiet-basin', 'Pool-A');
    tag('acct-a-demo', '');
    const read = await readProjectPools(localIO, cfg(), await rootNames());
    for (const p of ['demo', 'quiet-basin', 'acct-a-demo']) {
      expect(poolFor(read, p), p).toEqual({ state: 'malformed' });
    }
  });

  it('an entry whose bytes never came back is unreadable, and only that entry', async () => {
    tag('demo', 'pool-a');
    tag('quiet-basin', 'pool-b');
    const io = degradedReadIO((p) => p.endsWith(`${POOLS_DIR_NAME}/quiet-basin`));
    const read = await readProjectPools(io, cfg(), await rootNames());
    expect(poolFor(read, 'demo')).toEqual({ state: 'tagged', name: 'pool-a' });
    expect(poolFor(read, 'quiet-basin')).toEqual({ state: 'unreadable' });
  });

  it('an entry that vanished between the listing and its own read is a SKIP — absence is untag', async () => {
    // The `--clear` that landed mid-read. A proven ENOENT is a proven untag,
    // which is exactly what `readFileMeasured` exists to be able to say.
    tag('demo', 'pool-a');
    const io = absentReadIO((p) => p.endsWith(`${POOLS_DIR_NAME}/demo`));
    const read = await readProjectPools(io, cfg(), await rootNames());
    expect(read.listed && read.tags.has('demo')).toBe(false);
    expect(poolFor(read, 'demo')).toEqual({ state: 'untagged' });
  });

  it('skips dot-leading entries — the disclosed tmp leak is not a project', async () => {
    // `$REG/pools/.<project>.$BASHPID.tmp` after a SIGKILL between write and
    // rename. No project may lead with a dot (`_ws_project_valid`), so the
    // skip is exact.
    tag('demo', 'pool-a');
    tag('.demo.4242.tmp', 'pool-b');
    const read = await readProjectPools(localIO, cfg(), await rootNames());
    expect(read.listed && [...read.tags.keys()]).toEqual(['demo']);
  });

  it('poolFor answers untagged for a project with no entry, on a listed read', async () => {
    tag('demo', 'pool-a');
    const read = await readProjectPools(localIO, cfg(), await rootNames());
    expect(poolFor(read, 'quiet-basin')).toEqual({ state: 'untagged' });
  });
});

describe('L3 may not narrow — four states in, four states out', () => {
  it('every state a marker can be in survives to the wire', async () => {
    tag('demo', 'pool-a');            // tagged
    tag('quiet-basin', 'Pool A');     // malformed
    tag('acct-a-demo', 'pool-b');     // -> made unreadable below
    const io = degradedReadIO((p) => p.endsWith(`${POOLS_DIR_NAME}/acct-a-demo`));
    const read = await readProjectPools(io, cfg(), await rootNames());
    expect([
      poolFor(read, 'demo').state,
      poolFor(read, 'quiet-basin').state,
      poolFor(read, 'acct-a-demo').state,
      poolFor(read, 'nothing-here').state,
    ]).toEqual(['tagged', 'malformed', 'unreadable', 'untagged']);
  });
});

describe('poolsEnforcement — the three-state shape lifecycleState uses', () => {
  it('null caps is unknown, never unavailable', () => {
    // `lifecycleState`'s own ruling (`coord/mirrorplan.ts:207`): `unavailable`
    // is a MEASURED absence an operator may act on; a null list is no evidence,
    // and a reader must stay silent on it.
    expect(poolsEnforcement(null)).toBe('unknown');
  });

  it('the verb present is enforced, the verb absent is unavailable', () => {
    const verb = CCD_ARGV.projectPoolClear('demo')[0]!;
    expect(poolsEnforcement([verb, 'swap'])).toBe('enforced');
    expect(poolsEnforcement(['swap', 'start'])).toBe('unavailable');
  });
});

describe('poolsWire', () => {
  it('carries the map as a plain object when listed, and the enforcement either way', async () => {
    tag('demo', 'pool-a');
    const read = await readProjectPools(localIO, cfg(), await rootNames());
    expect(poolsWire(read, 'enforced')).toEqual({
      listed: true, byProject: { demo: { state: 'tagged', name: 'pool-a' } }, enforcement: 'enforced',
    });
    expect(poolsWire({ listed: false }, 'unknown')).toEqual({ listed: false, enforcement: 'unknown' });
  });
});
