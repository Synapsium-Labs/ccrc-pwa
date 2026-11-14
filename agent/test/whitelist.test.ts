import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { canonicalize, checkCcrcSwitchStat, checkPath, checkSteerOnStat, FORBIDDEN_COMMANDS, isExecAllowed } from '../src/whitelist.js';
import { CCRC_SWITCH_FILES } from '../../shared/switches.js';
import { LC_DIR_NAME, LC_ERRORS_NAME, LC_GEN_PREFIX, LC_GEN_SUFFIX } from '../../shared/api.js';
import { NODE_FILE_BASENAMES } from '../../shared/agent-protocol.js';
// critic2, gates 3 related sub-item: the three `rmSync` calls this replaces sat
// AFTER their assertions, so a failing assertion threw past them and the
// directory leaked — on precisely the runs a mutation sweep produces. `mkTmp`
// registers with a file-scoped `afterAll`, which runs whether the test passed,
// failed or threw. See tmpHelpers.ts.
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

describe('whitelist.canonicalize', () => {
  it('resolves an existing path to its realpath', async () => {
    const dir = mkTmp('ccrc-wl-');
    const real = mkTmp('ccrc-wl-real-');
    const link = path.join(dir, 'link');
    symlinkSync(real, link);
    expect(await canonicalize(link)).toBe(await canonicalize(real));
  });

  it('appends non-existent tail components literally onto the resolved existing prefix', async () => {
    const dir = mkTmp('ccrc-wl-');
    const target = path.join(dir, 'not', 'yet', 'created.txt');
    const canonical = await canonicalize(target);
    expect(canonical.endsWith(path.join('not', 'yet', 'created.txt'))).toBe(true);
  });
});

describe('whitelist.checkPath', () => {
  let home: string;
  let projectsRoot: string;
  let outside: string;

  // Kept per-test (this block seeds a fresh $HOME for every case and there are
  // many of them), but routed through the registry so the end-of-file hook is
  // the net underneath it: `afterEach` already ran whether a test failed, the
  // three `rmSync`s above did not.
  afterEach(removeTmpFixtures);

  function seed(): void {
    home = mkTmp('ccrc-wl-home-');
    for (const d of ['.cc-sessions', '.cc-limits', '.cc-clips', '.claude', '.claude-acme']) {
      mkdirSync(path.join(home, d), { recursive: true });
    }
    projectsRoot = mkTmp('ccrc-wl-projects-');
    outside = mkTmp('ccrc-wl-outside-');
  }

  it('allows reads under every read-whitelisted root', async () => {
    seed();
    const cfg = { home, projectsRoot };
    for (const rel of ['.cc-sessions/a', '.cc-limits/b', '.cc-clips/c', '.claude/settings.json', '.claude-acme/settings.json']) {
      const p = path.join(home, rel);
      expect(await checkPath(p, cfg, 'read')).not.toBeNull();
    }
    expect(await checkPath(path.join(projectsRoot, 'proj', 'x.ts'), cfg, 'read')).not.toBeNull();
  });

  it('rejects reads outside every whitelisted root, including a sibling dir with a similar prefix', async () => {
    seed();
    const cfg = { home, projectsRoot };
    expect(await checkPath(path.join(outside, 'x'), cfg, 'read')).toBeNull();
    // a directory that merely starts with the same characters as home must not match
    expect(await checkPath(`${home}-evil/x`, cfg, 'read')).toBeNull();
  });

  it('restricts writes to .cc-clips only, even though those paths are read-allowed', async () => {
    seed();
    const cfg = { home, projectsRoot };
    expect(await checkPath(path.join(home, '.cc-clips', 'a.png'), cfg, 'write')).not.toBeNull();
    expect(await checkPath(path.join(home, '.cc-sessions', 'a.wrapper'), cfg, 'write')).toBeNull();
    expect(await checkPath(path.join(home, '.claude', 'settings.json'), cfg, 'write')).toBeNull();
    expect(await checkPath(path.join(projectsRoot, 'proj', 'x.ts'), cfg, 'write')).toBeNull();
  });

  it('rejects a symlink under a whitelisted dir that points outside it', async () => {
    seed();
    const cfg = { home, projectsRoot };
    const secret = path.join(outside, 'secret.txt');
    writeFileSync(secret, 'nope');
    const link = path.join(home, '.cc-clips', 'escape');
    symlinkSync(secret, link);
    expect(await checkPath(link, cfg, 'read')).toBeNull();
  });

  it('returns null instead of throwing when the path is not a string (malformed request)', async () => {
    seed();
    const cfg = { home, projectsRoot };
    await expect(checkPath(undefined as unknown as string, cfg, 'read')).resolves.toBeNull();
    await expect(checkPath(42 as unknown as string, cfg, 'read')).resolves.toBeNull();
    await expect(checkPath(null as unknown as string, cfg, 'write')).resolves.toBeNull();
  });

  it('the lifecycle journal is READ-allowed and WRITE-forbidden — the agent cannot corrupt the log it reads', async () => {
    // Build 9 spec §2/§4. The server mirrors `$HOME/.cc-sessions/.lifecycle/`
    // over the agent's EXISTING read grant — `.cc-sessions` is read-whitelisted
    // (`whitelist.ts:84`) and `canonicalize` walks up to the longest existing
    // prefix, so the path resolves before the directory exists. The whole
    // agent-side delta of this build is this test: zero new grants, zero new
    // frames, zero new capabilities.
    seed();
    const cfg = { home, projectsRoot };
    const lc = path.join(home, '.cc-sessions', LC_DIR_NAME);
    const journal = path.join(lc, `${LC_GEN_PREFIX}1755780000000000000${LC_GEN_SUFFIX}`);
    const errors = path.join(lc, LC_ERRORS_NAME);

    for (const p of [lc, journal, errors]) {
      expect(await checkPath(p, cfg, 'read'), `${p} must be readable`).not.toBeNull();
      // THE HALF THAT MATTERS. The write arm is `.cc-clips` and nothing else
      // (`whitelist.ts:79-80`), so the agent is STRUCTURALLY incapable of
      // truncating, appending to or rotating the record it serves — which is
      // what makes "a shrink is a truncation ccd did" a sound inference on
      // the server side, and it is a property of the whitelist rather than of
      // anyone's restraint.
      expect(await checkPath(p, cfg, 'write'), `${p} must NOT be writable`).toBeNull();
    }
  });

  it('the pools directory is READ-allowed and WRITE-forbidden — the server can never set a tag directly', async () => {
    // Account pools, spec §5.1: the server READS `$REG/pools/` through the
    // agent (wave 3's `readProjectPools`) and writes it ONLY by asking ccd to
    // run `project-pool`. The write root stays `.cc-clips` and nothing else,
    // so a future refactor that reached for `io.writeFile` on a tag would be
    // structurally incapable rather than merely discouraged.
    seed();
    const cfg = { home, projectsRoot };
    const dir = path.join(home, '.cc-sessions', 'pools');
    for (const p of [dir, path.join(dir, 'demo'), path.join(dir, 'acct-a-demo')]) {
      expect(await checkPath(p, cfg, 'read'), `${p} must be readable`).not.toBeNull();
      expect(await checkPath(p, cfg, 'write'), `${p} must NOT be writable`).toBeNull();
    }
  });

  it('`checkPath(…, "read")` refuses `~/.ccrc/auth-scratch/<id>/config` and its `.credentials.json`', async () => {
    // Accounts plan Task A20 (D-5514): a re-auth or a method switch signs in, or mints, into
    // `~/.ccrc/auth-scratch/<id>`, and the new credential sits there until `ccrc account set --method` has checked
    // it. That directory is outside every read root by construction (`checkPath` reads `~/.cc-sessions/**` and every
    // `~/.claude*` directory), so no `read` frame can lift a sign-in that is not yet the lane's. Seeded on disk, so
    // the refusal is the whitelist's and not a missing file's.
    seed();
    const cfg = { home, projectsRoot };
    const scratch = path.join(home, '.ccrc', 'auth-scratch', 'lane-a');
    mkdirSync(path.join(scratch, 'config'), { recursive: true });
    writeFileSync(path.join(scratch, 'config', '.credentials.json'), '{}');
    writeFileSync(path.join(scratch, 'minted.env'), 'export X=1\n');
    for (const p of [scratch, path.join(scratch, 'config'), path.join(scratch, 'config', '.credentials.json'),
      path.join(scratch, 'minted.env')]) {
      expect(await checkPath(p, cfg, 'read'), `${p} must NOT be readable`).toBeNull();
      expect(await checkPath(p, cfg, 'write'), `${p} must NOT be writable`).toBeNull();
    }
    // The control: the lane's OWN config dir is a read root, which is why the scratch must not be named like one.
    expect(await checkPath(path.join(home, '.claude-acme', 'settings.json'), cfg, 'read')).not.toBeNull();
  });

  it('the pool projection is READ-ONLY to the agent — a write frame cannot forge membership', async () => {
    seed();
    const cfg = { home, projectsRoot };
    const proj = path.join(home, '.cc-sessions', 'pool-epoch');
    // Readable so the SERVER can measure what the fleet actually holds ($REG is
    // the only fleet-box location it can read back, design §3.1) ...
    expect(await checkPath(proj, cfg, 'read')).not.toBeNull();
    // ... and unwritable, because a projection the wire could write would let a
    // compromised channel forge membership instead of merely observing it.
    expect(await checkPath(proj, cfg, 'write')).toBeNull();
  });

  // ── design 2026-09-20 §8: the eleven ~/.ccrc node files (the ninth is box-token lifecycle wave 1's, the tenth the tmp sweep census's, the eleventh the box settings record's) ──
  // D-3176 — the spec put these in whitelist-structural.test.ts,
  // which pins only the EXEC whitelist (tsc-spawned compile errors, no checkPath
  // case at all); every other checkPath case is in this describe, so these are.
  describe('the ~/.ccrc node files — exact basenames, READ mode only', () => {
    const NINE = ['box-settings.json', 'box-token-generation', 'build.json', 'ccrc-caps', 'floor', 'installed', 'node-id', 'previous',
      'tmp-sweep.json', 'update-intent', 'update.json'];
    // Every other name ccd/ccrc writes (or could) beside them — the secrets first.
    const REFUSED = ['agent.env', 'auth.scrypt', 'coord.db', 'deploy.env', 'ccrc.env', 'exposure.env',
      'mail.token', 'accounts.json', 'accounts.sh', 'build.json.bak', '.build.json.tmp', path.join('logs', 'x'),
      // The box-token lifecycle's server-side files beside the ninth name: values, state and temps stay refused.
      'mail-previous.token', 'mail-pending-0123456789abcdef.token', 'box-token.json', 'box-token-retired.json',
      'token-sync.json', '.box-token-generation.tmp-0123456789abcdef', 'box-token-generation.bak',
      // The settings verb's own temp and look-alikes beside the eleventh name stay refused.
      'box-settings.json.tmp.12345', 'box-settings.json.bak', '.box-settings.json'];

    function seedCcrc(): string {
      seed();
      const ccrc = path.join(home, '.ccrc');
      mkdirSync(path.join(ccrc, 'logs'), { recursive: true });
      return ccrc;
    }

    it('the set is exactly the eleven names (§8, box-token-generation, the tmp sweep census and the box settings record) — a twelfth is a design change, not an edit', () => {
      // The grant DERIVES from NODE_FILE_BASENAMES, so a name added to
      // NODE_FILES is a read grant; this is the line that makes that visible.
      expect([...NODE_FILE_BASENAMES].sort()).toEqual(NINE);
    });

    it('admits each of the nine for read, absent or present, at its canonical path', async () => {
      const ccrc = seedCcrc();
      const cfg = { home, projectsRoot };
      const canonicalCcrc = await canonicalize(ccrc);
      for (const b of NINE) {
        const p = path.join(ccrc, b);
        // Absent first: a node whose writer has not run yet must read `absent`
        // over the wire, not `forbidden` → `unreadable`.
        expect(await checkPath(p, cfg, 'read'), `${b} (absent) must be readable`).toBe(path.join(canonicalCcrc, b));
        writeFileSync(p, 'x\n');
        expect(await checkPath(p, cfg, 'read'), `${b} (present) must be readable`).toBe(path.join(canonicalCcrc, b));
      }
    });

    it('refuses every other name in ~/.ccrc, ~/.ccrc itself, a path below a node file, and look-alikes elsewhere', async () => {
      const ccrc = seedCcrc();
      const cfg = { home, projectsRoot };
      for (const r of REFUSED) {
        writeFileSync(path.join(ccrc, r), 'secret\n');
        expect(await checkPath(path.join(ccrc, r), cfg, 'read'), `${r} must NOT be readable`).toBeNull();
      }
      // The directory itself: admitting it would let `readdir` list agent.env's
      // existence and `lstat`'s parent probe widen past the nine.
      expect(await checkPath(ccrc, cfg, 'read'), '~/.ccrc itself must NOT be readable').toBeNull();
      expect(await checkPath(path.join(ccrc, 'build.json', 'x'), cfg, 'read')).toBeNull();
      mkdirSync(path.join(home, '.ccrc-evil'), { recursive: true });
      expect(await checkPath(path.join(home, '.ccrc-evil', 'build.json'), cfg, 'read')).toBeNull();
      expect(await checkPath(path.join(home, 'build.json'), cfg, 'read')).toBeNull();
      expect(await checkPath(path.join(outside, 'build.json'), cfg, 'read')).toBeNull();
    });

    it('write mode admits none of the nine — the agent never writes a node file', async () => {
      const ccrc = seedCcrc();
      const cfg = { home, projectsRoot };
      for (const b of NINE) {
        expect(await checkPath(path.join(ccrc, b), cfg, 'write'), `${b} must NOT be writable`).toBeNull();
      }
    });

    it('a live SYMLINK carrying a node-file name is refused — at a secret, at another of the nine, or outside', async () => {
      const ccrc = seedCcrc();
      const cfg = { home, projectsRoot };
      writeFileSync(path.join(ccrc, 'agent.env'), 'CCRC_AGENT_TOKEN=x\n');
      writeFileSync(path.join(ccrc, 'installed'), 'abc\n');
      writeFileSync(path.join(outside, 'node-id'), 'x\n');
      symlinkSync(path.join(ccrc, 'agent.env'), path.join(ccrc, 'build.json'));
      // The case canonical-path membership ALONE admits: `floor` resolves onto
      // `installed`, a member — only the literal-basename rule refuses it
      // (D-3195).
      symlinkSync(path.join(ccrc, 'installed'), path.join(ccrc, 'floor'));
      symlinkSync(path.join(outside, 'node-id'), path.join(ccrc, 'node-id'));
      for (const b of ['build.json', 'floor', 'node-id']) {
        expect(await checkPath(path.join(ccrc, b), cfg, 'read'), `${b} (a symlink) must NOT be readable`).toBeNull();
      }
      expect(await checkPath(path.join(ccrc, 'installed'), cfg, 'read'), 'the real file keeps its own grant').not.toBeNull();
    });

    it('a ~/.ccrc that is itself a symlink admits its own nine and nothing else', async () => {
      seed();
      const cfg = { home, projectsRoot };
      const real = mkTmp('ccrc-wl-ccrc-real-');
      symlinkSync(real, path.join(home, '.ccrc'));
      writeFileSync(path.join(real, 'build.json'), '{}\n');
      writeFileSync(path.join(real, 'agent.env'), 'CCRC_AGENT_TOKEN=x\n');
      const canonicalReal = await canonicalize(real);
      expect(await checkPath(path.join(home, '.ccrc', 'build.json'), cfg, 'read'))
        .toBe(path.join(canonicalReal, 'build.json'));
      expect(await checkPath(path.join(home, '.ccrc', 'update-intent'), cfg, 'read'))
        .toBe(path.join(canonicalReal, 'update-intent'));
      expect(await checkPath(path.join(home, '.ccrc', 'agent.env'), cfg, 'read')).toBeNull();
    });
  });

  // D-8406: a lane's class registry and catalogue, the two files the session's model picker reads, by exact name.
  describe('the lane model files in ~/.ccrc/models — two exact names per lane, READ mode only', () => {
    function seedModels(): string {
      seed();
      const dir = path.join(home, '.ccrc', 'models');
      mkdirSync(dir, { recursive: true });
      return dir;
    }

    it('admits a lane\'s registry and catalogue for read, absent or present, at the canonical path', async () => {
      const dir = seedModels();
      const cfg = { home, projectsRoot };
      const canonicalDir = await canonicalize(dir);
      for (const b of ['lane-a.classes.json', 'lane-a.json']) {
        const p = path.join(dir, b);
        expect(await checkPath(p, cfg, 'read'), `${b} (absent)`).toBe(path.join(canonicalDir, b));
        writeFileSync(p, '{}\n');
        expect(await checkPath(p, cfg, 'read'), `${b} (present)`).toBe(path.join(canonicalDir, b));
        expect(await checkPath(p, cfg, 'write'), `${b} must NOT be writable`).toBeNull();
      }
    });

    it('refuses the directory, every sibling file, a reserved word, and the same names anywhere else', async () => {
      const dir = seedModels();
      const cfg = { home, projectsRoot };
      for (const r of ['lane-a.effort.json', 'lane-a.windows.json', 'lane-a.advance.json', 'lane-a.classes.tsv',
        'lane-a.aliases.json', 'litellm.json', 'lane-a.json.tmp', 'Lane-a.json']) {
        writeFileSync(path.join(dir, r), '{}\n');
        expect(await checkPath(path.join(dir, r), cfg, 'read'), `${r} must NOT be readable`).toBeNull();
      }
      expect(await checkPath(dir, cfg, 'read'), '~/.ccrc/models itself must NOT be readable').toBeNull();
      expect(await checkPath(path.join(home, '.ccrc', 'lane-a.json'), cfg, 'read')).toBeNull();
      expect(await checkPath(path.join(home, '.ccrc', 'models-x', 'lane-a.json'), cfg, 'read')).toBeNull();
      expect(await checkPath(path.join(home, '.ccrc', 'models', 'sub', 'lane-a.json'), cfg, 'read')).toBeNull();
      expect(await checkPath(path.join(outside, 'models', 'lane-a.json'), cfg, 'read')).toBeNull();
    });

    it('a live symlink at a lane file\'s name, or a models directory that is a symlink, is refused', async () => {
      const dir = seedModels();
      const cfg = { home, projectsRoot };
      writeFileSync(path.join(home, '.ccrc', 'agent.env'), 'CCRC_AGENT_TOKEN=x\n');
      writeFileSync(path.join(dir, 'lane-b.json'), '{}\n');
      symlinkSync(path.join(home, '.ccrc', 'agent.env'), path.join(dir, 'lane-a.classes.json'));
      // Canonical-path membership alone would admit this one: it resolves onto another lane's real catalogue.
      symlinkSync(path.join(dir, 'lane-b.json'), path.join(dir, 'lane-a.json'));
      for (const b of ['lane-a.classes.json', 'lane-a.json']) {
        expect(await checkPath(path.join(dir, b), cfg, 'read'), `${b} (a symlink) must NOT be readable`).toBeNull();
      }
      expect(await checkPath(path.join(dir, 'lane-b.json'), cfg, 'read'), 'the real file keeps its grant').not.toBeNull();

      seed();
      const real = mkTmp('ccrc-wl-models-real-');
      mkdirSync(path.join(home, '.ccrc'), { recursive: true });
      symlinkSync(real, path.join(home, '.ccrc', 'models'));
      writeFileSync(path.join(real, 'lane-a.json'), '{}\n');
      expect(await checkPath(path.join(home, '.ccrc', 'models', 'lane-a.json'), { home, projectsRoot }, 'read')).toBeNull();
    });
  });
});

// D-8382: the operator's ~/.ccrc switch files, admitted for `stat` alone (existence, size and time), by name and at their
// literal path. `checkPath` admits none of them, so read, readFrom, readB64, readdir and lstat stay refused.
describe('whitelist.checkCcrcSwitchStat', () => {
  afterEach(removeTmpFixtures);
  const seedHome = (): { home: string; ccrc: string; cfg: { home: string; projectsRoot: string }; outside: string } => {
    const home = mkTmp('ccrc-wl-sw-home-');
    const ccrc = path.join(home, '.ccrc');
    mkdirSync(ccrc, { recursive: true });
    return { home, ccrc, cfg: { home, projectsRoot: mkTmp('ccrc-wl-sw-proj-') }, outside: mkTmp('ccrc-wl-sw-out-') };
  };

  it('the set is the switchboard\'s ~/.ccrc rows, derived: the three hand-placed off switches', () => {
    expect([...CCRC_SWITCH_FILES].sort()).toEqual(['ccrc-card-off', 'compact-card-off', 'graph-gate-off']);
  });

  it('admits each name, absent or present, at its literal path; checkPath still refuses it for every op', async () => {
    const { ccrc, cfg } = seedHome();
    const canonicalCcrc = await canonicalize(ccrc);
    for (const b of CCRC_SWITCH_FILES) {
      const p = path.join(ccrc, b);
      expect(await checkCcrcSwitchStat(p, cfg), `${b} (absent)`).toBe(path.join(canonicalCcrc, b));
      writeFileSync(p, '');
      expect(await checkCcrcSwitchStat(p, cfg), `${b} (present)`).toBe(path.join(canonicalCcrc, b));
      expect(await checkPath(p, cfg, 'read'), `${b} must stay outside checkPath (no read, no readdir, no lstat)`).toBeNull();
    }
  });

  it('refuses every other name in ~/.ccrc, the directory itself, a look-alike elsewhere and a symlink out', async () => {
    const { home, ccrc, cfg, outside } = seedHome();
    for (const r of ['agent.env', 'coord.db', 'graph-gate-off.bak', '.graph-gate-off', 'build.json']) {
      writeFileSync(path.join(ccrc, r), 'x\n');
      expect(await checkCcrcSwitchStat(path.join(ccrc, r), cfg), r).toBeNull();
    }
    expect(await checkCcrcSwitchStat(ccrc, cfg)).toBeNull();
    expect(await checkCcrcSwitchStat(path.join(home, 'graph-gate-off'), cfg)).toBeNull();
    expect(await checkCcrcSwitchStat(path.join(outside, 'graph-gate-off'), cfg)).toBeNull();
    mkdirSync(path.join(ccrc, 'sub'), { recursive: true });
    expect(await checkCcrcSwitchStat(path.join(ccrc, 'sub', 'graph-gate-off'), cfg)).toBeNull();
    // A live link at a switch name onto a secret: stat would report the secret's size and time under the switch's name.
    writeFileSync(path.join(ccrc, 'agent.env'), 'CCRC_AGENT_TOKEN=x\n');
    symlinkSync(path.join(ccrc, 'agent.env'), path.join(ccrc, 'ccrc-card-off'));
    expect(await checkCcrcSwitchStat(path.join(ccrc, 'ccrc-card-off'), cfg)).toBeNull();
    expect(await checkCcrcSwitchStat('', cfg)).toBeNull();
  });
});

// Review 2024 F1: one history W3 steer marker, admitted for `stat` alone, so the launch-profile lane measures it on a remote
// fleet. `checkPath` admits none of it.
describe('whitelist.checkSteerOnStat', () => {
  afterEach(removeTmpFixtures);
  const seed = (): { home: string; dir: string; cfg: { home: string; projectsRoot: string }; outside: string } => {
    const home = mkTmp('ccrc-wl-steer-home-');
    const dir = path.join(home, '.ccrc', 'history', 'steer-on');
    mkdirSync(dir, { recursive: true });
    return { home, dir, cfg: { home, projectsRoot: mkTmp('ccrc-wl-steer-proj-') }, outside: mkTmp('ccrc-wl-steer-out-') };
  };

  it('admits a registry id under ~/.ccrc/history/steer-on, absent or present; checkPath still refuses it', async () => {
    const { dir, cfg } = seed();
    const canonicalDir = await canonicalize(dir);
    const p = path.join(dir, 'lane-a-project-a');
    expect(await checkSteerOnStat(p, cfg)).toBe(path.join(canonicalDir, 'lane-a-project-a'));
    writeFileSync(p, '');
    expect(await checkSteerOnStat(p, cfg)).toBe(path.join(canonicalDir, 'lane-a-project-a'));
    expect(await checkPath(p, cfg, 'read')).toBeNull();
  });

  it('refuses a name that is no registry id, the directory, a look-alike elsewhere, a deeper path and a symlink out', async () => {
    const { home, dir, cfg, outside } = seed();
    for (const bad of ['..', '.hidden', '-lane-a', 'a b', 'a=b']) expect(await checkSteerOnStat(path.join(dir, bad), cfg), bad).toBeNull();
    expect(await checkSteerOnStat(dir, cfg)).toBeNull();
    expect(await checkSteerOnStat(path.join(home, '.ccrc', 'history', 'lane-a-project-a'), cfg)).toBeNull();
    expect(await checkSteerOnStat(path.join(home, '.ccrc', 'lane-a-project-a'), cfg)).toBeNull();
    expect(await checkSteerOnStat(path.join(outside, 'history', 'steer-on', 'lane-a-project-a'), cfg)).toBeNull();
    mkdirSync(path.join(dir, 'sub'));
    expect(await checkSteerOnStat(path.join(dir, 'sub', 'lane-a-project-a'), cfg)).toBeNull();
    // A live link at a marker name onto a secret: stat would report the secret's size and time under the marker's name.
    writeFileSync(path.join(home, '.ccrc', 'agent.env'), 'CCRC_AGENT_TOKEN=x\n');
    symlinkSync(path.join(home, '.ccrc', 'agent.env'), path.join(dir, 'lane-a-project-b'));
    expect(await checkSteerOnStat(path.join(dir, 'lane-a-project-b'), cfg)).toBeNull();
    expect(await checkSteerOnStat('', cfg)).toBeNull();
  });
});

describe('whitelist.isExecAllowed', () => {
  it('allows whitelisted cmd/subcommand pairs', () => {
    expect(isExecAllowed('tmux', ['has-session', '-t', 'x'])).toBe(true);
    expect(isExecAllowed('ccd', ['swap', 'x', 'claude9'])).toBe(true);
  });

  it('requires an EXACT bare command name — no basename matching', () => {
    // An absolute path whose *basename* matches ("tmux"/"ccd") must NOT be
    // treated as the real binary — that would let e.g. /tmp/x/tmux or a
    // fleet checkout's .../some-repo/ccd pass the whitelist.
    expect(isExecAllowed('/home/user/.local/bin/ccd', ['ensure', 'x'])).toBe(false);
    expect(isExecAllowed('/tmp/x/tmux', ['has-session'])).toBe(false);
    expect(isExecAllowed('/srv/projects/some-repo/ccd', ['swap', 'x'])).toBe(false);
  });

  it('rejects unknown commands', () => {
    expect(isExecAllowed('rm', ['-rf', '/'])).toBe(false);
  });

  it('rejects unknown subcommands of a whitelisted command', () => {
    expect(isExecAllowed('tmux', ['kill-server'])).toBe(false);
    expect(isExecAllowed('ccd', [])).toBe(false);
  });

  // ws-add stays; ws-rm does NOT. The old comment here claimed ccd "refuses an
  // unmerged branch" — it does not, it keeps the branch and warns on stderr —
  // and the whole reap design exists because that guard was never real, and
  // because the guards ws-rm does have cannot see a gitignored .env, ask the
  // remote nothing, and are never re-proved at the instant of deletion.
  // See whitelist-noghosts.test.ts for the full statement.
  it('allows ws-add and refuses ws-rm', () => {
    expect(isExecAllowed('ccd', ['ws-add', 'project-c'])).toBe(true);
    expect(isExecAllowed('ccd', ['ws-rm', 'project-c-quiet-mesa'])).toBe(false);
  });

  it('allows the PR and archive verbs at their pinned prefixes', () => {
    expect(isExecAllowed('ccd', ['pr-state', '--session', 'demo-quiet-basin'])).toBe(true);
    expect(isExecAllowed('ccd', ['pr-state', '--project', 'demo'])).toBe(true);
    expect(isExecAllowed('ccd', ['pr-landing', '--project', 'demo', '--sessions', 'a:41,b:42'])).toBe(true);
    expect(isExecAllowed('ccd', ['pr-landing', '--sessions', 'a:41'])).toBe(false);
    expect(isExecAllowed('ccd', ['pr-landing'])).toBe(false);
    // the verb shells out to gh itself; the agent is still never granted gh
    expect((FORBIDDEN_COMMANDS as readonly string[]).includes('gh')).toBe(true);
    expect(isExecAllowed('ccd', ['pr-open', '--session', 'x', '--title', 't', '--body-b64', 'Yg==', '--draft', 'false'])).toBe(true);
    expect(isExecAllowed('ccd', ['ws-archive', '--session', 'x'])).toBe(true);
    expect(isExecAllowed('ccd', ['ws-restore', '--session', 'x'])).toBe(true);
    expect(isExecAllowed('ccd', ['ws-audit', '--session', 'x'])).toBe(true);
    expect(isExecAllowed('ccd', ['ws-attic', '--session', 'x'])).toBe(true);
    // The hold pair, at the same shape. `--reason` and its text sit past the
    // granted prefix and are unconstrained, exactly as `--title`/`--body-b64`
    // are for pr-open; what the prefix pins is that neither verb is reachable
    // without naming a session.
    expect(isExecAllowed('ccd', ['ws-hold', '--session', 'x', '--reason', 'program:evals wave:1/4'])).toBe(true);
    expect(isExecAllowed('ccd', ['ws-release', '--session', 'x'])).toBe(true);
  });

  // D-8123: the operator's "Wait until reset" choice is one token wide, `forget`'s shape: the verb takes the id and
  // nothing else (ccd re-asserts exact arity and the id grammar), moves no session and sends no key.
  it('grants limit-wait as the one-token prefix, and nothing that merely resembles it', () => {
    expect(isExecAllowed('ccd', ['limit-wait', 'demo-quiet-basin'])).toBe(true);
    expect(isExecAllowed('ccd', ['limit-wait'])).toBe(true);
    expect(isExecAllowed('ccd', ['limit-watchdog'])).toBe(false);   // the timer's pass is never a wire verb
    expect(isExecAllowed('ccd', ['limit-waitx', 'demo-quiet-basin'])).toBe(false);
    expect(isExecAllowed('ccd', ['--limit-wait', 'demo-quiet-basin'])).toBe(false);
  });

  // NAMED WORKSPACES S9: rename is reachable only by naming a session, never as a bare verb or behind another leading flag.
  it('grants ws-title ONLY with --session, in both directions', () => {
    expect(isExecAllowed('ccd', ['ws-title', '--session', 'demo-x', '--title', 'ENG-1234 - Fix the login flow'])).toBe(true);
    expect(isExecAllowed('ccd', ['ws-title', '--session', 'demo-x', '--clear'])).toBe(true);
    expect(isExecAllowed('ccd', ['ws-title'])).toBe(false);
    expect(isExecAllowed('ccd', ['ws-title', '--title', 'X', '--session', 'demo-x'])).toBe(false);
    expect(isExecAllowed('ccd', ['ws-title', '--clear'])).toBe(false);
  });

  // ADD A PROJECT (add-project spec 2026-11-04 §4): the create is reachable only by naming the project first.
  it('grants project-add ONLY with --name, in both directions', () => {
    expect(isExecAllowed('ccd', ['project-add', '--name', 'demo', '--url', 'https://github.com/o/r.git'])).toBe(true);
    expect(isExecAllowed('ccd', ['project-add', '--name', 'demo', '--empty'])).toBe(true);
    expect(isExecAllowed('ccd', ['project-add'])).toBe(false);
    expect(isExecAllowed('ccd', ['project-add', '--url', 'https://github.com/o/r.git', '--name', 'demo'])).toBe(false);
    expect(isExecAllowed('ccd', ['project-add', '--empty', '--name', 'demo'])).toBe(false);
    expect(isExecAllowed('ccd', ['project-add', 'demo'])).toBe(false);
  });

  it('grants repo-visibility ONLY with --project (D-8147)', () => {
    expect(isExecAllowed('ccd', ['repo-visibility', '--project', 'demo'])).toBe(true);
    expect(isExecAllowed('ccd', ['repo-visibility', 'demo'])).toBe(false);
    expect(isExecAllowed('ccd', ['repo-visibility'])).toBe(false);
  });

  it('grants pr-template ONLY with --project (D-8147)', () => {
    expect(isExecAllowed('ccd', ['pr-template', '--project', 'demo', '--team', 'KEY'])).toBe(true);
    expect(isExecAllowed('ccd', ['pr-template', 'demo'])).toBe(false);
    expect(isExecAllowed('ccd', ['pr-template'])).toBe(false);
  });

  it('grants project-pool ONLY with --project, in both directions', () => {
    // The flag is not a confirmation token here, it is the verb's whole
    // argument surface — and prefix matching leaves everything after it
    // unconstrained, so the two forms below are the entire difference the
    // grant can express.
    expect(isExecAllowed('ccd', ['project-pool', '--project', 'demo', '--pool', 'pool-a'])).toBe(true);
    expect(isExecAllowed('ccd', ['project-pool', '--project', 'demo', '--clear'])).toBe(true);
    expect(isExecAllowed('ccd', ['project-pool', 'demo'])).toBe(false);
    expect(isExecAllowed('ccd', ['project-pool'])).toBe(false);
    expect(isExecAllowed('ccd', ['project-pool', '--pool', 'pool-a'])).toBe(false);
  });

  // NATIVE DOCS READER wave 2 (spec 2026-10-01 section 2 (a), the verb table): every exact argv the server's
  // builders emit crosses its grant, and nothing bare, positional, misplaced or misspelled does. The grant stops
  // at the flag; arity is ccd's, and the server's layer-2c table in `whitelist-subset.test.ts` pins it.
  it('grants the four docs verbs ONLY with their flag, and admits every argv the spec table names', () => {
    const sha = 'a'.repeat(40);
    expect(isExecAllowed('ccd', ['docs-index', '--all'])).toBe(true);
    expect(isExecAllowed('ccd', ['docs-tree', '--project', 'demo'])).toBe(true);
    expect(isExecAllowed('ccd', ['docs-tree', '--project', 'demo', '--ref', 'ws/a'])).toBe(true);
    expect(isExecAllowed('ccd', ['docs-show', '--project', 'demo', '--commit', sha, '--ref', 'refs/remotes/origin/main',
      '--section', 'specs', '--path', 'a.md', '--max-bytes', '2097152'])).toBe(true);
    expect(isExecAllowed('ccd', ['docs-show', '--project', 'demo', '--draft-branch', 'main', '--head', sha,
      '--section', 'plans', '--path', 'b.md', '--fingerprint', 'c'.repeat(64), '--max-bytes', '2097152'])).toBe(true);
    expect(isExecAllowed('ccd', ['docs-fetch', '--project', 'demo'])).toBe(true);
    expect(isExecAllowed('ccd', ['docs-fetch', '--project', 'demo', '--branch', 'ws/a'])).toBe(true);
    for (const verb of ['docs-index', 'docs-tree', 'docs-show', 'docs-fetch']) {
      expect(isExecAllowed('ccd', [verb]), verb).toBe(false);
    }
    expect(isExecAllowed('ccd', ['docs-tree', 'demo'])).toBe(false);
    expect(isExecAllowed('ccd', ['docs-tree', '--ref', 'r', '--project', 'demo'])).toBe(false);
    expect(isExecAllowed('ccd', ['docs-index', '--project', 'demo'])).toBe(false);
    expect(isExecAllowed('ccd', ['docs-showx', '--project', 'demo'])).toBe(false);
  });

  it('is still a whitelist — plausible adjacent subcommands stay refused', () => {
    // Pinned in BOTH directions on purpose. The pair above is only worth
    // anything while this holds: a list that had been widened to accept
    // anything ws-shaped — or anything at all — would satisfy those two
    // assertions for entirely the wrong reason.
    expect(isExecAllowed('ccd', ['ws-nuke', 'project-c-quiet-mesa'])).toBe(false);
    expect(isExecAllowed('ccd', ['ws'])).toBe(false);
    expect(isExecAllowed('ccd', ['prefer', 'x', 'claude9'])).toBe(false);
    expect(isExecAllowed('ccd', ['supervise', 'x'])).toBe(false);
  });

  it('returns false instead of throwing on malformed wire values (missing/wrong-typed fields)', () => {
    expect(isExecAllowed(undefined as unknown as string, ['x'])).toBe(false);
    expect(isExecAllowed(123 as unknown as string, ['x'])).toBe(false);
    expect(isExecAllowed(null as unknown as string, ['x'])).toBe(false);
    expect(isExecAllowed('tmux', undefined as unknown as string[])).toBe(false);
    expect(isExecAllowed('tmux', 'has-session' as unknown as string[])).toBe(false);
    expect(isExecAllowed('tmux', [123 as unknown as string])).toBe(false);
  });
});
