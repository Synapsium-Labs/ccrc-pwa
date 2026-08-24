import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { localIO, type FleetIO } from '../src/io.js';
import {
  readRegistry, readRegistryMeasured, readSessionRecord, measuredIdentity,
  HOLD_UNREADABLE, REGISTRY_UNMEASURED_STUCK_MS, SWAP_BLOCKED_NO_REASON,
  SUBSTRATE_UNREADABLE, SUBSTRATE_NO_REASON,
} from '../src/registry.js';
import { mkTmp } from './tmpHelpers.js';
import { seedRoster } from './helpers.js';
import { unreadableField, absentField } from './ioDoubles.js';

const seed = (dir: string, id: string, fields: Record<string, string>) => {
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(dir, `${id}.${k}`), v);
};

describe('readRegistry', () => {
  let home: string;
  beforeEach(() => {
    home = mkTmp('ccrc-');
    seedRoster(home);
    mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  });

  it('reads sessions enumerated by *.uuid with optional fields', async () => {
    const reg = path.join(home, '.cc-sessions');
    seed(reg, 'claude-a-MekWarLive', {
      wrapper: 'claude-a', project: 'MekWarLive', workdir: '/data/projects/MekWarLive',
      uuid: 'a0b5791d-0000-0000-0000-000000000001', started: '1',
      pool: 'claude claude-a', lastswap: '1784500000',
    });
    seed(reg, 'claude-b-demo-app-ts', {
      wrapper: 'claude-b', project: 'demo-app-ts',
      workdir: '/data/projects/demo-app-ts', uuid: 'b'.repeat(36), started: '1',
    });
    writeFileSync(path.join(reg, 'gpt-disabled'), '');   // noise: not a session file
    writeFileSync(path.join(reg, 'swap.log'), 'x');      // noise

    const out = await readRegistry(localIO, loadConfig({ CCRC_HOME: home }));
    expect(out.map((s) => s.id)).toEqual(['claude-a-MekWarLive', 'claude-b-demo-app-ts']);
    const mek = out[0];
    expect(mek.pool).toEqual(['claude', 'claude-a']);
    expect(mek.lastswap).toBe(1784500000);
    expect(out[1].pool).toBeNull();
    expect(out[1].home).toBeNull();
  });

  it('returns [] when registry dir missing', async () => {
    const out = await readRegistry(localIO, loadConfig({
      CCRC_HOME: path.join(home, 'nope'), CCRC_ACCOUNTS: path.join(home, '.ccrc', 'accounts.json'),
    }));
    expect(out).toEqual([]);
  });

  it('reads the branch a workspace was created on', async () => {
    const reg = path.join(home, '.cc-sessions');
    seed(reg, 'demo-quiet-mesa', {
      wrapper: 'claude', project: 'demo',
      workdir: '/home/x/worktrees/demo/quiet-mesa', uuid: 'c'.repeat(36), started: '1',
      workspace: 'quiet-mesa', branch: 'ws/quiet-mesa',
    });
    const out = await readRegistry(localIO, loadConfig({ CCRC_HOME: home }));
    expect(out[0].branch).toBe('ws/quiet-mesa');
  });

  it('leaves branch null for a main checkout that never had one written', async () => {
    const reg = path.join(home, '.cc-sessions');
    seed(reg, 'claude-demo', {
      wrapper: 'claude', project: 'demo',
      workdir: '/data/projects/demo', uuid: 'd'.repeat(36), started: '1',
    });
    const out = await readRegistry(localIO, loadConfig({ CCRC_HOME: home }));
    expect(out[0].branch).toBeNull();
  });

  // Wave 3 §3.2's prerequisite. `field()` collapses "the file is not there" and
  // "the file is there and its bytes did not come back" into the same null, and
  // `verifyDone`'s `branch-unmeasurable` refusal is a claim about the SECOND
  // one specifically. `names` is the listing `buildRecord` opened with, so it
  // proves PRESENCE independently of whether the read succeeded — the same
  // evidence the identity triple and `held` already use.
  it('marks a LISTED but unreadable .branch as unmeasured — never as absent', async () => {
    const reg = path.join(home, '.cc-sessions');
    seed(reg, 'demo-quiet-basin', {
      wrapper: 'claude', project: 'demo', workdir: '/w', uuid: 'e'.repeat(36),
      workspace: 'quiet-basin', branch: 'ws/quiet-basin',
    });
    const io = unreadableField('demo-quiet-basin', 'branch');
    const rec = (await readRegistry(io, loadConfig({ CCRC_HOME: home })))[0]!;
    expect(rec.branch, 'an unreadable field still reads null on its own value').toBeNull();
    expect(rec.branchEvidence).toBe('unreadable');
  });

  it('a genuinely absent .branch is absent, not unmeasured', async () => {
    // A project's MAIN checkout has no branch field at all. Calling that
    // "unmeasurable" would be the overclaim this distinction exists to stop.
    const reg = path.join(home, '.cc-sessions');
    seed(reg, 'claude-demo', { wrapper: 'claude', project: 'demo', workdir: '/w', uuid: 'f'.repeat(36) });
    const rec = (await readRegistry(localIO, loadConfig({ CCRC_HOME: home })))
      .find((r) => r.id === 'claude-demo')!;
    expect(rec.branch).toBeNull();
    expect(rec.branchEvidence).toBe('absent');
  });

  it('a readable branch is measured and its flag is false', async () => {
    const reg = path.join(home, '.cc-sessions');
    seed(reg, 'demo-quiet-basin', {
      wrapper: 'claude', project: 'demo', workdir: '/w', uuid: 'e'.repeat(36),
      workspace: 'quiet-basin', branch: 'ws/quiet-basin',
    });
    const rec = (await readRegistry(localIO, loadConfig({ CCRC_HOME: home })))[0]!;
    expect(rec.branch).toBe('ws/quiet-basin');
    expect(rec.branchEvidence).toBe('named');
  });

  // REVIEW FINDING, WAVE 3: the split above left a THIRD state collapsed.
  // `field()` returns `content.trim()`, so a zero-byte `.branch` comes back as
  // `''` — not null — and rode straight past both branches: `branch === null`
  // was false, so `branchUnmeasured` was false AND `verifyDone`'s null check
  // missed it, and `''` went on to be used AS A BRANCH NAME.
  //
  // Producible, not theoretical — though no longer by a torn write. `_reg_set`
  // writes a hidden tmp and `mv -fT`s it into place (registry-durability wave),
  // so a killed writer now leaves the WHOLE OLD value, never an empty file.
  // What still produces one: `touch $REG/<id>.branch`, a registry file left by
  // a build older than that change, or a power loss — `_reg_set` orders its
  // bytes but fsyncs neither the tmp nor the directory, and atomicity is a
  // concurrency property, not a durability one. See `BranchEvidence`'s
  // `'empty'` rung in registry.ts for the long form.
  describe('and a .branch that reads back EMPTY', () => {
    const seedEmptyBranch = (reg: string) => seed(reg, 'demo-quiet-basin', {
      wrapper: 'claude', project: 'demo', workdir: '/w', uuid: 'e'.repeat(36),
      workspace: 'quiet-basin', branch: '',
    });

    it('names no branch — `` is not a branch name and must not survive as one', async () => {
      const reg = path.join(home, '.cc-sessions');
      seedEmptyBranch(reg);
      const rec = (await readRegistry(localIO, loadConfig({ CCRC_HOME: home })))[0]!;
      // The bug this pins: `branch: ''` reached `readBranchTip` (a ref path
      // ending in a slash), `divergence`'s `head === r.branch` comparison
      // (which reported "the registry says , the worktree's own HEAD says
      // ws/quiet-basin" — a drift against nothing) and `fleet.ts`'s wire
      // field (an empty branch chip). One normalisation at the source, three
      // consumers fixed.
      expect(rec.branch).toBeNull();
    });

    it('is EMPTY evidence — not absent, and not unreadable either', async () => {
      // Empty is its own condition and it says something neither neighbour
      // says. Absent is the ordinary state of a main checkout; unreadable is
      // transient and asks to be retried. A zero-byte file is neither: its
      // bytes DID come back, and re-reading returns the same nothing. Folding
      // it into either one is the same defect this whole split exists to fix,
      // one state further along.
      const reg = path.join(home, '.cc-sessions');
      seedEmptyBranch(reg);
      const rec = (await readRegistry(localIO, loadConfig({ CCRC_HOME: home })))[0]!;
      expect(rec.branchEvidence).toBe('empty');
    });

    it('whitespace-only counts as empty too — `field()` trims before anyone sees it', async () => {
      const reg = path.join(home, '.cc-sessions');
      seed(reg, 'demo-quiet-basin', {
        wrapper: 'claude', project: 'demo', workdir: '/w', uuid: 'e'.repeat(36),
        workspace: 'quiet-basin', branch: '  \n',
      });
      const rec = (await readRegistry(localIO, loadConfig({ CCRC_HOME: home })))[0]!;
      expect(rec.branch).toBeNull();
      expect(rec.branchEvidence).toBe('empty');
    });

    it('degrades neither the identity triple nor the lifecycle read', async () => {
      const reg = path.join(home, '.cc-sessions');
      seedEmptyBranch(reg);
      const rec = (await readRegistry(localIO, loadConfig({ CCRC_HOME: home })))[0]!;
      expect(rec.unmeasured).toEqual([]);
      expect(rec.lifecycleUnmeasured).toEqual([]);
    });
  });

  // The two shapes it must NOT be conflated with, pinned so a later "tidy-up"
  // cannot fold it into either array.
  it('an unreadable branch degrades neither the identity triple nor the lifecycle read', async () => {
    const reg = path.join(home, '.cc-sessions');
    seed(reg, 'demo-quiet-basin', {
      wrapper: 'claude', project: 'demo', workdir: '/w', uuid: 'e'.repeat(36),
      workspace: 'quiet-basin', branch: 'ws/quiet-basin', started: '1',
    });
    const io = unreadableField('demo-quiet-basin', 'branch');
    const rec = (await readRegistry(io, loadConfig({ CCRC_HOME: home })))[0]!;
    expect(rec.unmeasured, '`unmeasured` is IdentityField[] and rides the wire — do not widen it')
      .toEqual([]);
    expect(rec.lifecycleUnmeasured,
      'a branch nobody could read says nothing about whether the session is running').toEqual([]);
  });
});

// Task 5 (docs/superpowers/plans/2026-08-20-fleetio-measured-read.md): the
// registry ladder now reads through `fieldMeasured`/`io.readFileMeasured`
// instead of `field`/`io.readFile`. THE GOVERNING RULE: `ok`/`absent` are
// POSITIVE answers that short-circuit; `unreadable` falls back to EXACTLY
// today's `names.includes(...)` rung. These tests pin the cases that were
// IMPOSSIBLE TO EXPRESS before `readFileMeasured` existed — a LISTED file
// whose read is measured `absent` — plus the compatibility pin (an
// old-agent-shaped io, every read `unreadable`, reproduces today's answers
// exactly) and, per migrated field, the not-listed+unreadable case that
// today's answer is unchanged.
describe('the measured read reaching the registry ladder (Task 5)', () => {
  let home: string;
  let reg: string;
  beforeEach(() => {
    home = mkTmp('ccrc-');
    seedRoster(home);
    reg = path.join(home, '.cc-sessions');
    mkdirSync(reg, { recursive: true });
  });

  const cfg = () => loadConfig({ CCRC_HOME: home });

  describe('branchEvidence', () => {
    it('a LISTED .branch whose measured read is absent reads `absent`, not `unreadable`', async () => {
      seed(reg, 'demo-quiet-basin', {
        wrapper: 'claude', project: 'demo', workdir: '/w', uuid: 'e'.repeat(36),
        workspace: 'quiet-basin', branch: 'ws/quiet-basin',
      });
      const io = absentField('demo-quiet-basin', 'branch');
      const rec = (await readRegistry(io, cfg()))[0]!;
      expect(rec.branchEvidence).toBe('absent');
      expect(rec.branch).toBeNull();
    });

    it('a NOT-LISTED .branch, measured unreadable, keeps today\'s answer: `absent`', async () => {
      // The file never existed at all — not seeded, so `names` never lists
      // it either — while the double still forces `unreadable`. Today's
      // fallback rung (`names.includes(...)`) settles it exactly as before.
      seed(reg, 'claude-demo', { wrapper: 'claude', project: 'demo', workdir: '/w', uuid: 'f'.repeat(36) });
      const io = unreadableField('claude-demo', 'branch');
      const rec = (await readRegistry(io, cfg())).find((r) => r.id === 'claude-demo')!;
      expect(rec.branchEvidence).toBe('absent');
    });
  });

  describe('held (D-112)', () => {
    it('a LISTED .hold whose measured read is absent reads null directly — no second listing', async () => {
      seed(reg, 'demo-quiet-basin', { wrapper: 'claude', project: 'demo', workdir: '/w', uuid: 'e'.repeat(36) });
      writeFileSync(path.join(reg, 'demo-quiet-basin.hold'), 'program:agent-evals wave:1/4');
      let listings = 0;
      const io: FleetIO = {
        ...absentField('demo-quiet-basin', 'hold'),
        readdir: async (p) => { listings += 1; return localIO.readdir(p); },
      };
      const rec = (await readRegistry(io, cfg()))[0]!;
      expect(rec.held).toBeNull();
      // Today, a LISTED+null hold is HOLD_UNREADABLE and triggers exactly one
      // extra (second) listing to reconfirm. A measured-absent hold is
      // proof enough on its own — D-112 — so the second listing never fires.
      expect(listings).toBe(1);
    });

    it('a NOT-LISTED .hold, measured unreadable, keeps today\'s answer: null', async () => {
      seed(reg, 'claude-demo', { wrapper: 'claude', project: 'demo', workdir: '/w', uuid: 'f'.repeat(36) });
      const io = unreadableField('claude-demo', 'hold');
      const rec = (await readRegistry(io, cfg())).find((r) => r.id === 'claude-demo')!;
      expect(rec.held).toBeNull();
    });
  });

  describe('substrate (D-113)', () => {
    it('a LISTED .substrate whose measured read is absent reads null', async () => {
      seed(reg, 'demo-quiet-basin', { wrapper: 'claude', project: 'demo', workdir: '/w', uuid: 'e'.repeat(36) });
      writeFileSync(path.join(reg, 'demo-quiet-basin.substrate'), '1755620112 protocol version mismatch');
      const io = absentField('demo-quiet-basin', 'substrate');
      const rec = (await readRegistry(io, cfg()))[0]!;
      expect(rec.substrate).toBeNull();
    });

    it('a NOT-LISTED .substrate, measured unreadable, keeps today\'s answer: null', async () => {
      seed(reg, 'claude-demo', { wrapper: 'claude', project: 'demo', workdir: '/w', uuid: 'f'.repeat(36) });
      const io = unreadableField('claude-demo', 'substrate');
      const rec = (await readRegistry(io, cfg())).find((r) => r.id === 'claude-demo')!;
      expect(rec.substrate).toBeNull();
    });
  });

  describe('the identity triple', () => {
    it('a LISTED .wrapper whose measured read is absent drops the row — never unmeasured', async () => {
      // Today (collapsed evidence): listed + null infers `unreadable`, and
      // the row is DEGRADED (kept, unmeasured: ['wrapper']). A measured
      // `absent` is proof the file is genuinely gone — the row is DROPPED,
      // the same end state `readRegistryMeasured`'s second-listing
      // reconfirm reaches for the collapsed case, one listing fewer.
      seed(reg, 'demo-quiet-basin', { wrapper: 'claude', project: 'demo', workdir: '/w', uuid: 'e'.repeat(36) });
      const io = absentField('demo-quiet-basin', 'wrapper');
      const out = await readRegistry(io, cfg());
      expect(out.find((r) => r.id === 'demo-quiet-basin')).toBeUndefined();
    });

    it('a NOT-LISTED .wrapper, measured unreadable, keeps today\'s answer: dropped', async () => {
      seed(reg, 'demo-quiet-basin', { project: 'demo', workdir: '/w', uuid: 'e'.repeat(36) }); // no .wrapper at all
      const io = unreadableField('demo-quiet-basin', 'wrapper');
      const out = await readRegistry(io, cfg());
      expect(out).toEqual([]);
    });

    it('a LISTED .uuid whose measured read is absent drops the row, and readSessionRecord ' +
       'reports {found:false, reason:\'absent\'} (B4)', async () => {
      // `.uuid` is the one identity-triple member `buildRecord`'s own
      // docstring calls TRUE BY CONSTRUCTION — `names.includes(id+'.uuid')`
      // holds for every id either caller ever derives `id` from, so before
      // `readFileMeasured` existed a measured-absent `.uuid` specifically was
      // unreachable: the only way to get there was `raw === null`, which the
      // by-construction guarantee always paired with `names.includes(...) ===
      // true`, landing on `unmeasured`, never the drop. A measured `absent`
      // is the race that guarantee never covered — reaped between the
      // listing this function opened with and `.uuid`'s own read — and this
      // pins the already-correct behaviour (probed by the reviewer, not a
      // bug) rather than manufacturing a red: GREEN on first run.
      seed(reg, 'demo-quiet-basin', { wrapper: 'claude', project: 'demo', workdir: '/w', uuid: 'e'.repeat(36) });
      const io = absentField('demo-quiet-basin', 'uuid');
      const out = await readRegistry(io, cfg());
      expect(out.find((r) => r.id === 'demo-quiet-basin')).toBeUndefined();
      expect(await readSessionRecord(io, cfg(), 'demo-quiet-basin')).toEqual({ found: false, reason: 'absent' });
    });
  });

  describe('lifecycleUnmeasured', () => {
    it('a LISTED .started whose measured read is absent is NOT pushed to lifecycleUnmeasured', async () => {
      // Today: listed + null infers `unreadable`, pushed as unmeasured. A
      // measured `absent` is the ordinary "never started" answer instead —
      // a positive result, not a fault.
      seed(reg, 'demo-quiet-basin', { wrapper: 'claude', project: 'demo', workdir: '/w', uuid: 'e'.repeat(36) });
      writeFileSync(path.join(reg, 'demo-quiet-basin.started'), '1');
      const io = absentField('demo-quiet-basin', 'started');
      const rec = (await readRegistry(io, cfg()))[0]!;
      expect(rec.lifecycleUnmeasured).toEqual([]);
      expect(rec.started).toBe(false);
    });

    it('a NOT-LISTED .started, measured unreadable, keeps today\'s answer: not pushed', async () => {
      seed(reg, 'demo-quiet-basin', { wrapper: 'claude', project: 'demo', workdir: '/w', uuid: 'e'.repeat(36) });
      const io = unreadableField('demo-quiet-basin', 'started');
      const rec = (await readRegistry(io, cfg()))[0]!;
      expect(rec.lifecycleUnmeasured).toEqual([]);
    });

    it('a LISTED .stopped whose measured read is absent is NOT pushed — the wide net does not fire on absence', async () => {
      seed(reg, 'demo-quiet-basin', { wrapper: 'claude', project: 'demo', workdir: '/w', uuid: 'e'.repeat(36) });
      writeFileSync(path.join(reg, 'demo-quiet-basin.stopped'), '1785300000 pwa');
      const io = absentField('demo-quiet-basin', 'stopped');
      const rec = (await readRegistry(io, cfg()))[0]!;
      expect(rec.lifecycleUnmeasured).toEqual([]);
      expect(rec.stopped).toBeNull();
    });

    it('a NOT-LISTED .stopped, measured unreadable, keeps today\'s answer: not pushed', async () => {
      seed(reg, 'demo-quiet-basin', { wrapper: 'claude', project: 'demo', workdir: '/w', uuid: 'e'.repeat(36) });
      const io = unreadableField('demo-quiet-basin', 'stopped');
      const rec = (await readRegistry(io, cfg()))[0]!;
      expect(rec.lifecycleUnmeasured).toEqual([]);
      expect(rec.stopped).toBeNull();
    });
  });

  // 5.2 — THE GOVERNING RULE, mechanised: an io shaped like an OLDER agent
  // (its `read` response never carries the `absent` marker at all, so every
  // `readFileMeasured` call answers `unreadable`, regardless of path) must
  // reproduce EXACTLY the answers this ladder gave before Task 5 — the
  // fail-shut argument the whole wave depends on (an agent mid-deploy-window
  // degrades to today's behaviour, never past it).
  describe('the compatibility pin — an old-agent-shaped io reproduces today\'s ladder exactly', () => {
    it('walks every migrated field and matches the pre-migration answer, field by field', async () => {
      seed(reg, 'demo-quiet-basin', {
        wrapper: 'claude', project: 'demo', workdir: '/w', uuid: 'e'.repeat(36), started: '1',
        home: 'home1', pool: 'claude claude-a', lastswap: '1784500000', workspace: 'quiet-basin',
        branch: 'ws/quiet-basin', base: 'origin/main', prphase: 'merged', prnumber: '42',
        prcheckedat: '1785300000000', archived: '1785300123',
        archivemanifest: '{"worktreeBytes":123}',
        hold: 'program:agent-evals wave:1/4',
        stopped: '1785300000 pwa', supervised: '1785300100',
        swapblocked: '1785299000 no transcript found for uuid under claude', spawn: '1785299500 4',
        substrate: '1755620112 protocol version mismatch',
      });
      // Every readFileMeasured call fails 'unreadable', for EVERY path — the
      // shape an older agent's read response produces once `readFile`
      // derives from it (Task 1), regardless of what predicate a narrower
      // double would have matched.
      const oldAgentShapedIO: FleetIO = {
        ...localIO,
        readFileMeasured: async () => ({ ok: false, reason: 'unreadable' }),
      };
      const rec = (await readRegistry(oldAgentShapedIO, cfg()))[0]!;

      // Identity triple: every member listed + unreadable -> degraded, kept,
      // never dropped (today's ladder, unchanged).
      expect(rec.unmeasured).toEqual(['uuid', 'wrapper', 'workdir']);
      expect(rec.uuid).toBe('');
      expect(rec.wrapper).toBe('');
      expect(rec.workdir).toBe('');
      // Every OTHER field also collapses through the same derived readFile —
      // project falls back to the id, exactly as an absent/unreadable
      // project always has.
      expect(rec.project).toBe('demo-quiet-basin');
      expect(rec.started).toBe(false);
      expect([rec.home, rec.pool, rec.lastswap, rec.workspace, rec.base]).toEqual([null, null, null, null, null]);
      expect([rec.prPhase, rec.prNumber, rec.prCheckedAt, rec.archivedAt, rec.archivedBytes])
        .toEqual([null, null, null, null, null]);
      // branchEvidence: listed + unreadable -> 'unreadable', branch null.
      expect(rec.branchEvidence).toBe('unreadable');
      expect(rec.branch).toBeNull();
      // held: listed + unreadable -> HOLD_UNREADABLE, fail-shut.
      expect(rec.held).toBe(HOLD_UNREADABLE);
      // substrate: listed + unreadable -> SUBSTRATE_UNREADABLE, fail-shut.
      expect(rec.substrate).toEqual({ at: 0, text: SUBSTRATE_UNREADABLE });
      // lifecycleUnmeasured: started/supervised/stopped all listed +
      // unreadable -> all three pushed; the packed stamps themselves null.
      expect(rec.lifecycleUnmeasured.slice().sort()).toEqual(['started', 'stopped', 'supervised']);
      expect(rec.stopped).toBeNull();
      expect(rec.supervisedAt).toBeNull();
      // Unmigrated fields (still `field()`/`io.readFile`, same derivation)
      // also collapse to null, unaffected by Task 5 either way.
      expect(rec.swapBlocked).toBeNull();
      expect(rec.spawn).toBeNull();
    });
  });
});

describe('workspace on the wire', () => {
  let home: string;
  beforeEach(() => {
    home = mkTmp('ccrc-');
    seedRoster(home);
    mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  });

  it('reads the workspace field when present', async () => {
    const reg = path.join(home, '.cc-sessions');
    seed(reg, 'demo-quiet-mesa', {
      wrapper: 'claude-a', project: 'demo', workdir: '/w/demo/quiet-mesa',
      uuid: 'a'.repeat(36), workspace: 'quiet-mesa',
    });
    const [rec] = await readRegistry(localIO, loadConfig({ CCRC_HOME: home }));
    expect(rec.workspace).toBe('quiet-mesa');
  });

  it('leaves workspace null for a legacy main-checkout session', async () => {
    const reg = path.join(home, '.cc-sessions');
    seed(reg, 'claude-a-demo', {
      wrapper: 'claude-a', project: 'demo', workdir: '/p/demo', uuid: 'b'.repeat(36),
    });
    const [rec] = await readRegistry(localIO, loadConfig({ CCRC_HOME: home }));
    expect(rec.workspace).toBeNull();
  });
});

describe('PR and archive fields', () => {
  it('reads base, prphase, prnumber, prcheckedat and archived off disk', async () => {
    const home = mkTmp('ccrc-');
    seedRoster(home);
    const reg = path.join(home, '.cc-sessions');
    mkdirSync(reg, { recursive: true });
    const put = (f: string, v: string): void => writeFileSync(path.join(reg, `demo-quiet-basin.${f}`), v);
    put('uuid', 'u'); put('wrapper', 'claude'); put('workdir', '/w'); put('project', 'demo');
    put('workspace', 'quiet-basin'); put('branch', 'ws/quiet-basin');
    put('base', 'origin/main'); put('prphase', 'merged'); put('prnumber', '42');
    put('prcheckedat', '1785300000000'); put('archived', '1785300123');
    const [r] = await readRegistry(localIO, loadConfig({ CCRC_HOME: home }));
    expect(r!.base).toBe('origin/main');
    expect(r!.prPhase).toBe('merged');
    expect(r!.prNumber).toBe(42);
    expect(r!.prCheckedAt).toBe(1785300000000);
    expect(r!.archivedAt).toBe(1785300123);
  });

  it('nulls a prphase that is not one of the eight known phases', async () => {
    // The file is written by ccd on another box. A version skew that writes a
    // phase this build does not know must degrade to "unchecked", never leak a
    // string the PWA will switch on and render as nothing.
    const home = mkTmp('ccrc-');
    seedRoster(home);
    const reg = path.join(home, '.cc-sessions');
    mkdirSync(reg, { recursive: true });
    for (const [f, v] of [['uuid', 'u'], ['wrapper', 'claude'], ['workdir', '/w'], ['prphase', 'exploded']]) {
      writeFileSync(path.join(reg, `demo-x.${f}`), v!);
    }
    const [r] = await readRegistry(localIO, loadConfig({ CCRC_HOME: home }));
    expect(r!.prPhase).toBeNull();
  });

  it('nulls a zero-byte or non-numeric field instead of 0 / NaN', async () => {
    // Both of numOrNull's guards, which nothing else pins. An interrupted
    // `_reg_set` leaves a zero-byte field, and `Number('')` is 0 — `archivedAt: 0`
    // reads as archived-in-1970, so the UI would offer "clean up workspace" on a
    // workspace whose archive never finished. A non-numeric field is NaN, which
    // JSON.stringify puts on the wire as `null` while the type still says
    // `number` — the silent lie the comment on numOrNull claims to prevent.
    const home = mkTmp('ccrc-');
    seedRoster(home);
    const reg = path.join(home, '.cc-sessions');
    mkdirSync(reg, { recursive: true });
    const put = (f: string, v: string): void => writeFileSync(path.join(reg, `demo-quiet-basin.${f}`), v);
    put('uuid', 'u'); put('wrapper', 'claude'); put('workdir', '/w'); put('project', 'demo');
    put('archived', ''); put('prcheckedat', 'oops'); put('prnumber', '  ');

    const [r] = await readRegistry(localIO, loadConfig({ CCRC_HOME: home }));
    expect(r!.archivedAt).toBeNull();
    expect(r!.prCheckedAt).toBeNull();
    expect(r!.prNumber).toBeNull();
  });

  it('leaves every new field null on a session that has none of them', async () => {
    const home = mkTmp('ccrc-');
    seedRoster(home);
    const reg = path.join(home, '.cc-sessions');
    mkdirSync(reg, { recursive: true });
    for (const [f, v] of [['uuid', 'u'], ['wrapper', 'claude'], ['workdir', '/w']]) {
      writeFileSync(path.join(reg, `claude-demo.${f}`), v!);
    }
    const [r] = await readRegistry(localIO, loadConfig({ CCRC_HOME: home }));
    expect([r!.base, r!.prPhase, r!.prNumber, r!.prCheckedAt, r!.archivedAt])
      .toEqual([null, null, null, null, null]);
  });
});

// C0.3: readSessionRecord is the SAME parser (buildRecord) as readRegistry,
// narrowed to one id — one readdir plus that id's 22 field reads instead of
// a whole-fleet sweep. These pin that it agrees with readRegistry's own
// per-record answer, id-by-id, rather than re-testing every field this file
// already covers above.
describe('readSessionRecord', () => {
  let home: string;
  beforeEach(() => {
    home = mkTmp('ccrc-');
    seedRoster(home);
    mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  });

  it('reads the same record readRegistry would, for one id among several', async () => {
    const reg = path.join(home, '.cc-sessions');
    seed(reg, 'claude-a-MekWarLive', {
      wrapper: 'claude-a', project: 'MekWarLive', workdir: '/data/projects/MekWarLive',
      uuid: 'a0b5791d-0000-0000-0000-000000000001', started: '1',
      pool: 'claude claude-a', lastswap: '1784500000',
    });
    seed(reg, 'claude-b-demo-app-ts', {
      wrapper: 'claude-b', project: 'demo-app-ts',
      workdir: '/data/projects/demo-app-ts', uuid: 'b'.repeat(36), started: '1',
    });
    const cfg = loadConfig({ CCRC_HOME: home });

    const whole = await readRegistry(localIO, cfg);
    const single = await readSessionRecord(localIO, cfg, 'claude-a-MekWarLive');

    expect(single).toEqual({ found: true, record: whole.find((r) => r.id === 'claude-a-MekWarLive') });
    expect(single.found && single.record.pool).toEqual(['claude', 'claude-a']);
    expect(single.found && single.record.lastswap).toBe(1784500000);
  });

  it('answers {found:false, reason:\'absent\'} for an id with no .uuid in the registry, without reading any of its fields', async () => {
    const reg = path.join(home, '.cc-sessions');
    let fieldReads = 0;
    const countingIO: FleetIO = {
      ...localIO,
      readFileMeasured: async (p) => { fieldReads++; return localIO.readFileMeasured(p); },
    };
    seed(reg, 'claude-a-MekWarLive', {
      wrapper: 'claude-a', project: 'MekWarLive', workdir: '/data/projects/MekWarLive',
      uuid: 'a'.repeat(36),
    });
    const cfg = loadConfig({ CCRC_HOME: home });

    const rec = await readSessionRecord(countingIO, cfg, 'nope');
    expect(rec).toEqual({ found: false, reason: 'absent' });
    // A miss must not fire the 22-field Promise.all `buildRecord` would — the
    // whole point of checking the listing FIRST.
    expect(fieldReads).toBe(0);
  });

  it('answers {found:false, reason:\'unlistable\'} when the registry dir cannot be listed', async () => {
    const cfg = loadConfig({
      CCRC_HOME: path.join(home, 'nope'), CCRC_ACCOUNTS: path.join(home, '.ccrc', 'accounts.json'),
    });
    expect(await readSessionRecord(localIO, cfg, 'claude-demo')).toEqual({ found: false, reason: 'unlistable' });
  });

  it('answers {found:false, reason:\'absent\'} for an incomplete entry (own field never written, not just ' +
     'unreadable), same as readRegistry dropping it', async () => {
    const reg = path.join(home, '.cc-sessions');
    seed(reg, 'claude-demo', { uuid: 'c'.repeat(36), wrapper: 'claude' }); // no workdir file at all
    const cfg = loadConfig({ CCRC_HOME: home });
    expect(await readSessionRecord(localIO, cfg, 'claude-demo')).toEqual({ found: false, reason: 'absent' });
  });

  it('costs exactly one readdir plus the one id\'s 22 field reads — never a per-session Promise.all for a sibling', async () => {
    const reg = path.join(home, '.cc-sessions');
    seed(reg, 'claude-a-MekWarLive', {
      wrapper: 'claude-a', project: 'MekWarLive', workdir: '/data/projects/MekWarLive', uuid: 'a'.repeat(36),
    });
    seed(reg, 'claude-b-demo-app-ts', {
      wrapper: 'claude-b', project: 'demo-app-ts',
      workdir: '/data/projects/demo-app-ts', uuid: 'b'.repeat(36),
    });
    let readdirCalls = 0;
    let fieldReads: string[] = [];
    const countingIO: FleetIO = {
      ...localIO,
      readdir: async (p) => { readdirCalls++; return localIO.readdir(p); },
      readFileMeasured: async (p) => { fieldReads.push(p); return localIO.readFileMeasured(p); },
    };
    const cfg = loadConfig({ CCRC_HOME: home });

    await readSessionRecord(countingIO, cfg, 'claude-a-MekWarLive');

    expect(readdirCalls).toBe(1);
    // 17 + D3's four stamps (stopped, supervised, swapblocked, spawn) + the
    // substrate marker (D-B8-14) — the substrate file joined the sweep. The
    // number is pinned rather than derived because it IS the remote-mode cost:
    // one round trip each, per session, per 2-second tick.
    expect(fieldReads).toHaveLength(22);
    expect(fieldReads.every((p) => p.includes('claude-a-MekWarLive'))).toBe(true);
  });

  it('re-confirms a still-unreadable hold with one second listing, same as readRegistry', async () => {
    const reg = path.join(home, '.cc-sessions');
    seed(reg, 'demo-quiet-basin', {
      wrapper: 'claude', project: 'demo', workdir: '/w', uuid: 'd'.repeat(36),
    });
    writeFileSync(path.join(reg, 'demo-quiet-basin.hold'), 'program:agent-evals wave:1/4');
    const holdUnreadableIO: FleetIO = {
      ...localIO,
      readFileMeasured: async (p) => (p.endsWith('.hold') ? { ok: false, reason: 'unreadable' } : localIO.readFileMeasured(p)),
    };
    const cfg = loadConfig({ CCRC_HOME: home });
    const rec = await readSessionRecord(holdUnreadableIO, cfg, 'demo-quiet-basin');
    expect(rec.found && rec.record.held).toBe(HOLD_UNREADABLE);
  });
});

// Architecture doc, increment 1's second half (spec:
// docs/superpowers/specs/2026-08-10-architecture-ddd-clean-solid.md):
// DEGRADE-AND-HEAL for a listed-but-unreadable identity field, narrowed
// (logged) DROP for a field that is neither readable nor listed, or reads
// back measured-empty. `registry.ts:123`'s old blanket rule ("missing
// wrapper/workdir/uuid" -> drop) had NO pin before this file — these tests
// are written FIRST and confirmed red against that old rule (a triple member
// null+listed used to drop the whole row; here it must degrade it instead).
describe('the identity ladder (unmeasured evidence)', () => {
  let home: string;
  beforeEach(() => {
    home = mkTmp('ccrc-');
    seedRoster(home);
    mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  });

  it('degrades — never drops — a row whose wrapper is listed but unreadable', async () => {
    const reg = path.join(home, '.cc-sessions');
    seed(reg, 'demo-quiet-basin', { wrapper: 'claude', project: 'demo', workdir: '/w', uuid: 'e'.repeat(36) });
    const cfg = loadConfig({ CCRC_HOME: home });
    const out = await readRegistry(unreadableField('demo-quiet-basin', 'wrapper'), cfg);
    expect(out).toHaveLength(1);
    const rec = out[0]!;
    expect(rec.unmeasured).toEqual(['wrapper']);
    // A degraded field's OWN value is '' — never null, and never any real
    // wrapper — so a stray `=== ''` comparison can never be fooled by it,
    // and every OTHER field (measured) stays exactly what was written.
    expect(rec.wrapper).toBe('');
    expect(rec.uuid).toBe('e'.repeat(36));
    expect(rec.workdir).toBe('/w');
  });

  it('degrades a row whose uuid is listed but unreadable — the case guaranteed reachable by construction', async () => {
    const reg = path.join(home, '.cc-sessions');
    seed(reg, 'demo-quiet-basin', { wrapper: 'claude', project: 'demo', workdir: '/w', uuid: 'e'.repeat(36) });
    const cfg = loadConfig({ CCRC_HOME: home });
    const out = await readRegistry(unreadableField('demo-quiet-basin', 'uuid'), cfg);
    expect(out).toHaveLength(1);
    expect(out[0]!.unmeasured).toEqual(['uuid']);
    expect(out[0]!.uuid).toBe('');
  });

  it('drops (still, now logged) a row whose workdir file was never written at all', async () => {
    const reg = path.join(home, '.cc-sessions');
    // No `.workdir` file on disk — genuinely absent, not merely unreadable.
    seed(reg, 'demo-quiet-basin', { wrapper: 'claude', project: 'demo', uuid: 'e'.repeat(36) });
    const cfg = loadConfig({ CCRC_HOME: home });
    const out = await readRegistry(localIO, cfg);
    expect(out).toEqual([]);
  });

  it('drops (still, now logged) a row whose wrapper reads back measured-empty — a permanent fault, not a read failure', async () => {
    const reg = path.join(home, '.cc-sessions');
    seed(reg, 'demo-quiet-basin', { wrapper: '   ', project: 'demo', workdir: '/w', uuid: 'e'.repeat(36) });
    const cfg = loadConfig({ CCRC_HOME: home });
    const out = await readRegistry(localIO, cfg);
    expect(out).toEqual([]);
  });

  it('measuredIdentity returns the bundled triple when fully measured, and null the instant any member is degraded', async () => {
    const reg = path.join(home, '.cc-sessions');
    seed(reg, 'demo-quiet-basin', { wrapper: 'claude', project: 'demo', workdir: '/w', uuid: 'e'.repeat(36) });
    const cfg = loadConfig({ CCRC_HOME: home });

    const clean = (await readRegistry(localIO, cfg))[0]!;
    expect(measuredIdentity(clean)).toEqual({ uuid: 'e'.repeat(36), wrapper: 'claude', workdir: '/w' });

    const degraded = (await readRegistry(unreadableField('demo-quiet-basin', 'workdir'), cfg))[0]!;
    expect(measuredIdentity(degraded)).toBeNull();
  });

  it('twice-observed absence retires a degraded row within the SAME readRegistry call', async () => {
    // First listing: `.wrapper` is there but unreadable — degraded. By the
    // time the second (confirmatory) listing runs, the WHOLE session has
    // been reaped — `.uuid` itself is gone. That is proof, not a guess: the
    // row is dropped from the result rather than kept degraded forever.
    const reg = path.join(home, '.cc-sessions');
    seed(reg, 'demo-quiet-basin', { wrapper: 'claude', project: 'demo', workdir: '/w', uuid: 'e'.repeat(36) });
    const cfg = loadConfig({ CCRC_HOME: home });
    let listings = 0;
    const reapedMidRead: FleetIO = {
      ...localIO,
      readdir: async (p) => {
        const names = await localIO.readdir(p);
        if (names === null) return names;
        listings += 1;
        if (listings === 1) return names;
        return names.filter((n) => !n.startsWith('demo-quiet-basin.'));
      },
      readFileMeasured: async (p) => (p.endsWith('.wrapper') ? { ok: false, reason: 'unreadable' } : localIO.readFileMeasured(p)),
    };
    const out = await readRegistry(reapedMidRead, cfg);
    expect(out).toEqual([]);
    expect(listings).toBe(2);
  });

  it('a second listing that FAILS proves nothing and changes nothing — the degraded row stays, fail-shut', async () => {
    const reg = path.join(home, '.cc-sessions');
    seed(reg, 'demo-quiet-basin', { wrapper: 'claude', project: 'demo', workdir: '/w', uuid: 'e'.repeat(36) });
    const cfg = loadConfig({ CCRC_HOME: home });
    let listings = 0;
    const secondListingFails: FleetIO = {
      ...localIO,
      readdir: async (p) => {
        listings += 1;
        if (listings === 1) return localIO.readdir(p);
        return null;
      },
      readFileMeasured: async (p) => (p.endsWith('.wrapper') ? { ok: false, reason: 'unreadable' } : localIO.readFileMeasured(p)),
    };
    const out = await readRegistry(secondListingFails, cfg);
    expect(out).toHaveLength(1);
    expect(out[0]!.unmeasured).toEqual(['wrapper']);
    expect(listings).toBe(2);
  });

  it('readSessionRecord retires a degraded row to {found:false, reason:\'absent\'} on twice-observed absence', async () => {
    const reg = path.join(home, '.cc-sessions');
    seed(reg, 'demo-quiet-basin', { wrapper: 'claude', project: 'demo', workdir: '/w', uuid: 'e'.repeat(36) });
    const cfg = loadConfig({ CCRC_HOME: home });
    let listings = 0;
    const reapedMidRead: FleetIO = {
      ...localIO,
      readdir: async (p) => {
        const names = await localIO.readdir(p);
        if (names === null) return names;
        listings += 1;
        if (listings === 1) return names;
        return names.filter((n) => !n.startsWith('demo-quiet-basin.'));
      },
      readFileMeasured: async (p) => (p.endsWith('.wrapper') ? { ok: false, reason: 'unreadable' } : localIO.readFileMeasured(p)),
    };
    expect(await readSessionRecord(reapedMidRead, cfg, 'demo-quiet-basin')).toEqual({ found: false, reason: 'absent' });
  });
});

describe('readRegistryMeasured / RegistryRead', () => {
  let home: string;
  beforeEach(() => {
    home = mkTmp('ccrc-');
    seedRoster(home);
    mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  });

  it('answers {listed:true, records} on an ordinary read, and readRegistry unwraps it', async () => {
    const reg = path.join(home, '.cc-sessions');
    seed(reg, 'demo-quiet-basin', { wrapper: 'claude', project: 'demo', workdir: '/w', uuid: 'e'.repeat(36) });
    const cfg = loadConfig({ CCRC_HOME: home });
    const read = await readRegistryMeasured(localIO, cfg);
    expect(read.listed).toBe(true);
    expect(read.listed && read.records.map((r) => r.id)).toEqual(['demo-quiet-basin']);
    expect(await readRegistry(localIO, cfg)).toEqual(read.listed ? read.records : []);
  });

  it('answers {listed:false} — the whole-fleet collapse — distinct from a registry that genuinely lists ' +
     'nobody, and readRegistry\'s old signature still collapses it to []', async () => {
    const cfg = loadConfig({
      CCRC_HOME: path.join(home, 'nope'), CCRC_ACCOUNTS: path.join(home, '.ccrc', 'accounts.json'),
    });
    const read = await readRegistryMeasured(localIO, cfg);
    expect(read).toEqual({ listed: false });
    expect(await readRegistry(localIO, cfg)).toEqual([]);
  });

  // BUILD 4, D-B4-10. `watch.ts`'s `emitCoord` needs a NON-session fact out of
  // this same directory — `coordinator-paused` and `mail-disabled`, neither of
  // which is a `*.uuid` and so neither of which survives into `records`. A
  // second `readdir` for that would be a second clock for one fact, and the two
  // would disagree on exactly the ticks that matter.
  it('carries the RAW listing it derived the records from, so a caller needing a non-session '
     + 'fact out of the same directory shares the one readdir', async () => {
    const reg = path.join(home, '.cc-sessions');
    seed(reg, 'demo-quiet-basin', { wrapper: 'claude', project: 'demo', workdir: '/w', uuid: 'e'.repeat(36) });
    writeFileSync(path.join(reg, 'coordinator-paused'), '');
    const cfg = loadConfig({ CCRC_HOME: home });
    let listings = 0;
    const counted: FleetIO = {
      ...localIO,
      readdir: async (p) => { listings += 1; return localIO.readdir(p); },
    };
    const read = await readRegistryMeasured(counted, cfg);
    expect(read.listed).toBe(true);
    expect(read.listed && [...read.names].sort()).toEqual(
      (await localIO.readdir(reg))!.sort(),
    );
    // The marker is IN it — the whole point, and the thing `records` cannot say.
    expect(read.listed && read.names).toContain('coordinator-paused');
    // …and it cost exactly the one listing this function always took.
    expect(listings).toBe(1);
  });

  it('carries the FIRST listing even when the reap-race re-listing ran', async () => {
    // The second read (`registry.ts`'s hold/identity resolution) exists to
    // settle a per-row reap race, runs on SOME calls only, and hanging the
    // markers' clock on it would make the pause banner's cadence depend on
    // whether an unrelated session happened to be mid-reap.
    const reg = path.join(home, '.cc-sessions');
    seed(reg, 'demo-quiet-basin', { wrapper: 'claude', project: 'demo', workdir: '/w', uuid: 'e'.repeat(36) });
    writeFileSync(path.join(reg, 'coordinator-paused'), '');
    const cfg = loadConfig({ CCRC_HOME: home });
    let listings = 0;
    const markerVanishesOnRelist: FleetIO = {
      ...localIO,
      readdir: async (p) => {
        const names = await localIO.readdir(p);
        if (names === null) return names;
        listings += 1;
        // The first listing is the honest one; the second drops the marker AND
        // the row's `.uuid`, which is what forces the re-listing branch to run
        // at all (an unmeasured identity triple + a twice-observed absence).
        return listings === 1 ? names : names.filter((n) => n !== 'coordinator-paused' && !n.endsWith('.uuid'));
      },
      readFileMeasured: async (p) => (p.endsWith('.wrapper') ? { ok: false, reason: 'unreadable' } : localIO.readFileMeasured(p)),
    };
    const read = await readRegistryMeasured(markerVanishesOnRelist, cfg);
    expect(listings).toBe(2);          // the re-listing really did run
    expect(read.listed).toBe(true);
    expect(read.listed && read.names).toContain('coordinator-paused');
  });
});

describe('observability (warnOnce, escalation, the whole-fleet episode)', () => {
  let home: string;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    home = mkTmp('ccrc-obs-');
    seedRoster(home);
    mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.useFakeTimers({ toFake: ['Date'] });
  });
  afterEach(() => {
    warnSpy.mockRestore();
    errorSpy.mockRestore();
    vi.useRealTimers();
  });

  it('warns once on entry to degraded, and stays silent on an immediate repeat within the cooldown', async () => {
    const reg = path.join(home, '.cc-sessions');
    seed(reg, 'obs-warnonce-a', { wrapper: 'claude', project: 'demo', workdir: '/w', uuid: 'f'.repeat(36) });
    const cfg = loadConfig({ CCRC_HOME: home });
    const io = unreadableField('obs-warnonce-a', 'wrapper');

    await readRegistry(io, cfg);
    const afterFirst = warnSpy.mock.calls.length;
    expect(afterFirst).toBeGreaterThan(0);

    await readRegistry(io, cfg);
    // Still within the 60s cooldown — no NEW warn line for the same id#field.
    expect(warnSpy.mock.calls.length).toBe(afterFirst);
  });

  it('warns again once the cooldown has elapsed', async () => {
    const reg = path.join(home, '.cc-sessions');
    seed(reg, 'obs-warnonce-b', { wrapper: 'claude', project: 'demo', workdir: '/w', uuid: 'f'.repeat(36) });
    const cfg = loadConfig({ CCRC_HOME: home });
    const io = unreadableField('obs-warnonce-b', 'wrapper');

    await readRegistry(io, cfg);
    const afterFirst = warnSpy.mock.calls.length;
    vi.setSystemTime(Date.now() + 61_000);
    await readRegistry(io, cfg);
    expect(warnSpy.mock.calls.length).toBeGreaterThan(afterFirst);
  });

  it('escalates to console.error exactly once per stuck episode, after REGISTRY_UNMEASURED_STUCK_MS', async () => {
    const reg = path.join(home, '.cc-sessions');
    seed(reg, 'obs-escalate', { wrapper: 'claude', project: 'demo', workdir: '/w', uuid: 'f'.repeat(36) });
    const cfg = loadConfig({ CCRC_HOME: home });
    const io = unreadableField('obs-escalate', 'wrapper');

    await readRegistry(io, cfg);
    expect(errorSpy).not.toHaveBeenCalled();
    // Short of the ceiling: still just a warn.
    vi.setSystemTime(Date.now() + REGISTRY_UNMEASURED_STUCK_MS - 1_000);
    await readRegistry(io, cfg);
    expect(errorSpy).not.toHaveBeenCalled();
    // Past the ceiling: exactly one error.
    vi.setSystemTime(Date.now() + 2_000);
    await readRegistry(io, cfg);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    // And it does not repeat on the very next read.
    vi.setSystemTime(Date.now() + 1_000);
    await readRegistry(io, cfg);
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it('prunes a degraded id\'s warn state once it is no longer listed at all — a RECYCLED id (`ws-reap` ' +
     'draws only from free slugs, so the same id can name a wholly different incarnation later) does not ' +
     'inherit the retired incarnation\'s escalation clock', async () => {
    const reg = path.join(home, '.cc-sessions');
    const id = 'obs-prune-recycled';
    seed(reg, id, { wrapper: 'claude', project: 'demo', workdir: '/w', uuid: 'f'.repeat(36) });
    const cfg = loadConfig({ CCRC_HOME: home });
    const io = unreadableField(id, 'wrapper');
    await readRegistry(io, cfg);   // degrades id#wrapper#degraded, firstAt = T0
    expect(errorSpy).not.toHaveBeenCalled();

    // The incarnation is torn down — every registry file for `id` removed,
    // the ordinary shape of a reap.
    for (const f of ['wrapper', 'project', 'workdir', 'uuid']) {
      rmSync(path.join(reg, `${id}.${f}`), { force: true });
    }
    // A read while `id` is absent from the listing is what prunes its entry
    // — this call must not itself re-create one (nothing to build for an id
    // with no `.uuid`).
    await readRegistry(io, cfg);

    // Time passes well beyond the escalation ceiling, THEN the SAME id is
    // reused for a wholly unrelated NEW incarnation, ALSO wrapper-degraded.
    vi.setSystemTime(Date.now() + REGISTRY_UNMEASURED_STUCK_MS + 1_000);
    seed(reg, id, { wrapper: 'claude', project: 'other-project', workdir: '/w2', uuid: 'g'.repeat(36) });
    await readRegistry(io, cfg);
    // Without pruning, the stale entry's `firstAt` (T0) is still on file, and
    // `now - firstAt` already exceeds the ceiling — this would escalate on
    // what is, in truth, a BRAND NEW incarnation's very first observation.
    // Pruned correctly, this degrade starts its own clock and must not.
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('logs the whole-fleet unlistable episode on entry and exit, never per tick', async () => {
    const cfg = loadConfig({ CCRC_HOME: home });   // registry dir exists — deleted below
    const listable = { ...localIO };
    const unlistable: FleetIO = { ...localIO, readdir: async () => null };

    await readRegistry(listable, cfg);   // baseline: an ordinary, listable read logs nothing about this
    const before = errorSpy.mock.calls.length;

    await readRegistry(unlistable, cfg);
    await readRegistry(unlistable, cfg);
    await readRegistry(unlistable, cfg);
    // ENTRY: exactly one error, however many ticks stayed unlistable.
    expect(errorSpy.mock.calls.length).toBe(before + 1);

    const warnsBefore = warnSpy.mock.calls.length;
    await readRegistry(listable, cfg);
    // EXIT: exactly one warn.
    expect(warnSpy.mock.calls.length).toBe(warnsBefore + 1);
    await readRegistry(listable, cfg);
    await readRegistry(listable, cfg);
    // No further exit logging on subsequent, already-recovered reads.
    expect(warnSpy.mock.calls.length).toBe(warnsBefore + 1);
  });
});

// D3, spec §4.1/§4.2/§2.4/§3.1. Four stamps ccd writes and nothing read: the
// deliberate stop (`<epoch> <surface>`), the supervisor heartbeat (`<epoch>`),
// the swap refusal (`<epoch> <reason>`) and the last spawn verdict
// (`<epoch> <rc>`). Epoch and payload share ONE field per stamp on purpose —
// the registry is read per-field per-session on a 2s tick, and packing is what
// keeps `stopped` one read instead of two.
describe('the lifecycle stamps (D3)', () => {
  let home: string;
  let reg: string;
  beforeEach(() => {
    home = mkTmp('ccrc-');
    seedRoster(home);
    reg = path.join(home, '.cc-sessions');
    mkdirSync(reg, { recursive: true });
    seed(reg, 'demo-quiet-basin', {
      uuid: 'a'.repeat(36), wrapper: 'claude', workdir: '/w', project: 'demo',
    });
  });

  const read = async (io = localIO) =>
    (await readRegistry(io, loadConfig({ CCRC_HOME: home })))[0]!;

  it('reads all four stamps off disk, splitting epoch from payload', () => {
    // Kills the mutant that reads the whole file as the epoch (NaN -> null,
    // so every stamp in the fleet would vanish) and the one that reads the
    // whole file as the payload (a surface of "1785300000 pwa").
    seed(reg, 'demo-quiet-basin', {
      stopped: '1785300000 pwa',
      supervised: '1785300100',
      swapblocked: '1785299000 no transcript found for uuid under claude',
      spawn: '1785299500 4',
    });
    return read().then((r) => {
      expect(r.stopped).toEqual({ at: 1785300000, surface: 'pwa' });
      expect(r.supervisedAt).toBe(1785300100);
      expect(r.swapBlocked).toEqual({
        at: 1785299000, reason: 'no transcript found for uuid under claude',
      });
      expect(r.spawn).toEqual({ at: 1785299500, rc: 4 });
      expect(r.lifecycleUnmeasured).toEqual([]);
    });
  });

  it('normalizes a stop surface this build does not know, and one that is missing entirely, to `unknown`', async () => {
    // §4.1: the word is text FROM THE WIRE being written into the registry, so
    // it is validated on read as well as on write — a version-skewed ccd is the
    // ordinary case on this box. `unknown` is a real member of the union, so
    // there is somewhere honest to land; the epoch survives either way.
    seed(reg, 'demo-quiet-basin', { stopped: '1785300000 slack' });
    expect((await read()).stopped).toEqual({ at: 1785300000, surface: 'unknown' });
    seed(reg, 'demo-quiet-basin', { stopped: '1785300000' });
    expect((await read()).stopped).toEqual({ at: 1785300000, surface: 'unknown' });
  });

  it('nulls a stamp whose epoch is missing or non-numeric — a torn write is not a fact', async () => {
    // An empty or garbage field reaches this reader by the routes
    // `BranchEvidence`'s `'empty'` rung sets out — an older build's file, a
    // hand-edit, a power loss — never any more by an interrupted `_reg_set`,
    // which renames rather than truncates.
    // `Number('')` is 0, and `stoppedAt: 0` classifies a live session as
    // stopped-in-1970 — the same silent lie `numOrNull` exists to refuse.
    for (const bad of ['', '   ', 'pwa', 'notanepoch pwa']) {
      seed(reg, 'demo-quiet-basin', { stopped: bad, supervised: bad });
      const r = await read();
      expect(r.stopped, JSON.stringify(bad)).toBeNull();
      expect(r.supervisedAt, JSON.stringify(bad)).toBeNull();
    }
  });

  it('gives a swap refusal with no reason a sentence, never an empty display string', async () => {
    // Same ruling as HOLD_NO_REASON, for the same reason: the reason string IS
    // the display (spec §2.4 — the field is the durable half of the refusal,
    // rendered on the row), and `reason: ''` renders as a banner with nothing
    // in it on every surface while every consumer still shows it.
    seed(reg, 'demo-quiet-basin', { swapblocked: '1785299000' });
    expect((await read()).swapBlocked).toEqual({ at: 1785299000, reason: SWAP_BLOCKED_NO_REASON });
    seed(reg, 'demo-quiet-basin', { swapblocked: '1785299000    ' });
    expect((await read()).swapBlocked).toEqual({ at: 1785299000, reason: SWAP_BLOCKED_NO_REASON });
  });

  it('nulls a spawn stamp whose rc is not a number — a verdict that does not parse is not a verdict', async () => {
    seed(reg, 'demo-quiet-basin', { spawn: '1785299500 exploded' });
    expect((await read()).spawn).toBeNull();
    seed(reg, 'demo-quiet-basin', { spawn: '1785299500' });
    expect((await read()).spawn).toBeNull();
  });

  it('marks a LISTED but unreadable lifecycle field unmeasured — never absent', async () => {
    // The identity ladder's own evidence rule, applied to the three fields
    // §4.3's classifier reads: the directory listing proves PRESENCE
    // independently of whether the bytes came back. Without this the ladder
    // sees "no stop stamp" for a stop that was recorded and prints `orphan` —
    // rule (b)'s exact prohibition.
    seed(reg, 'demo-quiet-basin', { stopped: '1785300000 pwa', supervised: '1785300100', started: '1' });
    for (const f of ['stopped', 'supervised', 'started']) {
      const r = await read(unreadableField('demo-quiet-basin', f));
      expect(r.lifecycleUnmeasured, f).toEqual([f]);
    }
  });

  it('leaves every stamp null and lifecycleUnmeasured empty on a session that has none of them', async () => {
    // The overwhelming majority of rows the day this ships, and every row a
    // pre-D3 ccd ever wrote. Absence is absence.
    const r = await read();
    expect([r.stopped, r.supervisedAt, r.swapBlocked, r.spawn]).toEqual([null, null, null, null]);
    expect(r.lifecycleUnmeasured).toEqual([]);
  });

  // BINDING FINDING #1 from task-8's review (task-9-brief does not draft this
  // case — routed here deliberately, DISPATCH context for task 9). ccd's own
  // `_session_state` tests ONLY `[[ -e "$REG/$id.stopped" ]]` —
  // existence, never content — while `.supervised`'s bash reader
  // already guards with `^[0-9]+$` before trusting it, the same guard
  // `numOrNull` gives it here. `.stopped` has no such guard on the bash side,
  // and its own write (`_reg_set "$id" stopped "$(date +%s) $surface"`, in
  // `_ws_unsupervise`) is atomic now but not durable — so a zero-byte or
  // garbage `.stopped` is still a
  // PROVEN divergence: bash confidently answers `stopped` for this exact
  // on-disk state. A reader that collapsed the same bytes to `stoppedAt: null`
  // would let `dead + started -> orphan` fire about a row bash calls stopped —
  // rule (b)'s exact prohibition, MEASURED (task-9-report.md): a dead, started
  // row with a zero-byte `.stopped` made this exact reader answer `orphan`
  // before this test and the ladder fix below existed.
  it('routes a present-but-unparseable .stopped into lifecycleUnmeasured, never a bare null', async () => {
    for (const bad of ['', 'garbage no epoch here']) {
      seed(reg, 'demo-quiet-basin', { stopped: bad, started: '1' });
      const r = await read();
      expect(r.stopped, JSON.stringify(bad)).toBeNull();
      expect(r.lifecycleUnmeasured, JSON.stringify(bad)).toEqual(['stopped']);
    }
  });
});

// D-B8-14, spec §2 (docs/superpowers/specs/2026-08-19-substrate-unreachable-design.md):
// `$REG/<id>.substrate` is a supervisor's own "I could not reach tmux" record —
// `<epoch-seconds> <verbatim reason>`, written by `_substrate_mark` on every
// unknown tick, removed by `_substrate_clear` on the first live one. The
// `.hold` listed-vs-readable ladder applies verbatim, and with the same
// polarity stakes: "no fault recorded" (null) re-enables every destructive
// affordance downstream, so it must never be the misreading of "the marker
// would not read".
describe('SessionRecord.substrate — presence from the LISTING, never from a non-null read (spec §2)', () => {
  let home: string;
  let reg: string;
  beforeEach(() => {
    home = mkTmp('ccrc-');
    seedRoster(home);
    reg = path.join(home, '.cc-sessions');
    mkdirSync(reg, { recursive: true });
    seed(reg, 'demo-quiet-basin', {
      uuid: 'a'.repeat(36), wrapper: 'claude', workdir: '/w', project: 'demo',
    });
  });

  const read = async (io = localIO) =>
    (await readRegistry(io, loadConfig({ CCRC_HOME: home })))[0]!;

  it('absent file -> null; well-formed "<epoch> <text>" -> {at, text}', async () => {
    // The overwhelming majority of rows, and every row a pre-D-B8-14 ccd ever
    // wrote: no marker at all. Absence is absence — the one shape that reads
    // as "no fault recorded".
    expect((await read()).substrate).toBeNull();
    seed(reg, 'demo-quiet-basin', { substrate: '1755620112 protocol version mismatch' });
    // Epoch SECONDS, registry-native — `fleet.ts` is the one place it becomes
    // ms, like `stoppedBy` (the Global Constraints timebase rule).
    expect((await read()).substrate).toEqual({ at: 1755620112, text: 'protocol version mismatch' });
  });

  it('LISTED but unreadable -> SUBSTRATE_UNREADABLE, never null — "no fault recorded" and "the marker ' +
     'would not read" are opposite answers', async () => {
    seed(reg, 'demo-quiet-basin', { substrate: '1755620112 protocol version mismatch' });
    const r = await read(unreadableField('demo-quiet-basin', 'substrate'));
    expect(r.substrate).toEqual({ at: 0, text: SUBSTRATE_UNREADABLE });
  });

  it('empty or unstamped content degrades loudly, not silently', async () => {
    // `_substrate_mark` refuses to write an empty reason (a killed probe gets
    // a synthesized one), so an empty marker never came from ccd writing one —
    // it gets a sentence, the `HOLD_NO_REASON` ruling.
    seed(reg, 'demo-quiet-basin', { substrate: '' });
    expect((await read()).substrate).toEqual({ at: 0, text: SUBSTRATE_NO_REASON });
    // A stampless text keeps its WHOLE content as the reason at `at: 0` —
    // `packedStamp` refuses the epoch, but the one sentence a maintainer
    // could act on must not be lost with it.
    seed(reg, 'demo-quiet-basin', { substrate: 'no epoch here' });
    expect((await read()).substrate).toEqual({ at: 0, text: 'no epoch here' });
  });
});
