// A CHILD's temp root (child-workspace reclamation, spec §5.2, wave 1).
//
// ccd exports `TMPDIR=$HOME/.cc-tmp/<id>` into the launch environment of a
// session whose registry row carries `$REG/<id>.child`, and of no other
// session. Three properties, each pinned here because each is a way the
// containment could quietly stop meaning anything:
//   1. It is driven by the MARKER, never by a flag or a string — so every
//      respawn keeps it, and nothing that is not a child ever gets it.
//   2. It is composed ONCE, into the `env` string BOTH spawn lines splice, so
//      the `--resume` retry cannot spawn a differently-contained pane.
//   3. It never refuses a spawn. A child whose root cannot be made private is
//      warned about and spawned with the box's own TMPDIR — a supervisor
//      restart that died here would leave no session at all.
//
// Everything runs in the isolated fixture HOME (`makeCcdHarness`) with a bash
// `tmux()` stub that RECORDS instead of running; `claude` is never launched —
// the composed command line is read off the recorded `tmux new-session` argv.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { CCD, ghContainedEnv, makeCcdHarness, WIDE_PANE_IF_UP, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-child-tmpdir-'); });
afterEach(() => { h.cleanup(); });

/** `h.sh` without its two blind spots: it throws on non-zero and returns no
 *  status. `exec 2>&1` merges the streams in the CURRENT shell, so nothing
 *  wraps the snippet (`ccd-spawn-split.test.ts`'s rule). */
const shStatus = (snippet: string): { status: number; out: string } => {
  try {
    const out = execFileSync('bash', ['-c', `source "${CCD}"; exec 2>&1; ${snippet}`],
      { encoding: 'utf8', cwd: h.home,
        env: ghContainedEnv(h.home, { ...process.env, HOME: h.home }, { systemd: true, tmux: true }) });
    return { status: 0, out };
  } catch (e) {
    const err = e as { status?: number | null; stdout?: string; stderr?: string };
    return { status: err.status ?? -1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
};

/** `ccd-spawn-split.test.ts`'s two substrates: one where every spawn makes a
 *  pane, and one where the `--resume` spawn leaves none, so `_spawn_start`
 *  emits BOTH of its spawn lines. */
const TMUX = `sleep() { :; };
  tmux() {
    echo "tmux $*" >> "$HOME/ccd-calls"
    ${WIDE_PANE_IF_UP}
    case "$1" in
      new-session)  : > "$HOME/pane-up" ;;
      kill-session) rm -f "$HOME/pane-up" ;;
      has-session)  [[ -e "$HOME/pane-up" ]] ;;
    esac
  };`;
const RESUME_DIES = `sleep() { :; };
  tmux() {
    echo "tmux $*" >> "$HOME/ccd-calls"
    ${WIDE_PANE_IF_UP}
    case "$1" in
      new-session)  case "$*" in *--session-id*) : > "$HOME/pane-up" ;; esac ;;
      has-session)  [[ -e "$HOME/pane-up" ]] ;;
    esac
  };`;

const newSessions = (): string[] => h.calls().filter((c) => c.startsWith('tmux new-session'));
const tmpRoot = (): string => path.join(h.home, '.cc-tmp');
const leaf = (id: string): string => path.join(tmpRoot(), id);
const mode = (p: string): number => fs.statSync(p).mode & 0o777;

/** The three fields `_spawn_start` refuses without, plus the marker when given. */
const seed = (id: string, child: string | null): void => {
  h.sh(`_reg_set ${id} wrapper claude
        _reg_set ${id} workdir '${h.home}'
        _reg_set ${id} uuid deadbeef-0000-4000-8000-000000000000`);
  if (child !== null) h.sh(`_reg_set ${id} child '${child}'`);
};

/** A real directory some OTHER user owns, found by MEASURING, never by name
 *  alone: `/usr` qualifies iff it is a directory whose owner is not the running
 *  uid. Never under uid 0 — root owns it, and root's `chmod` succeeds on
 *  anything; the fleet runs ccd as one unprivileged user. */
const RUN_UID = process.getuid?.() ?? 0;
const FOREIGN_DIR: string | null = (() => {
  try {
    const st = fs.statSync('/usr');
    return RUN_UID !== 0 && st.isDirectory() && st.uid !== RUN_UID ? '/usr' : null;
  } catch { return null; }
})();

describe('_child_tmpdir — three answers, told apart', () => {
  it('rc 1 for a row with no marker, and creates NOTHING', () => {
    seed('demo-quiet-mesa', null);
    const r = shStatus('_child_tmpdir demo-quiet-mesa; echo "[rc=$?]"');
    expect(r.out).toBe('[rc=1]\n');
    expect(fs.existsSync(tmpRoot()), 'a non-child must not even create the parent').toBe(false);
  });

  it.each([['0'], ['abc'], ['٣'], ['07'], ['1²']])(
    'rc 1 for a marker that is not a run id (%j) — creates nothing, and _spawn_start exports no TMPDIR',
    (child) => {
      seed('demo-quiet-mesa', child);
      const r = shStatus('_child_tmpdir demo-quiet-mesa; echo "[rc=$?]"');
      expect(r.out).toBe('[rc=1]\n');
      expect(fs.existsSync(tmpRoot()), 'a marker that is not a run id must not even create the parent').toBe(false);
      h.sh(`${TMUX} rm -f "$HOME/pane-up"; _spawn_start demo-quiet-mesa new`);
      const news = newSessions();
      expect(news).toHaveLength(1);
      expect(news[0]).not.toContain('TMPDIR=');
    },
  );

  it('rc 0 for a child: prints the path, and both directories exist at 0700', () => {
    seed('demo-quiet-mesa', '7');
    const r = shStatus('_child_tmpdir demo-quiet-mesa; echo "[rc=$?]"');
    expect(r.out).toBe(`${leaf('demo-quiet-mesa')}[rc=0]\n`);
    expect(mode(leaf('demo-quiet-mesa'))).toBe(0o700);
    expect(mode(tmpRoot()), 'a root this function CREATED is private too').toBe(0o700);
  });

  it('re-privatises a leaf that already exists wider — a respawn does not inherit a loosened mode', () => {
    seed('demo-quiet-mesa', '7');
    fs.mkdirSync(leaf('demo-quiet-mesa'), { recursive: true, mode: 0o755 });
    fs.chmodSync(leaf('demo-quiet-mesa'), 0o755);
    expect(shStatus('_child_tmpdir demo-quiet-mesa >/dev/null; echo "[rc=$?]"').out).toBe('[rc=0]\n');
    expect(mode(leaf('demo-quiet-mesa'))).toBe(0o700);
  });

  it('rc 2 for a child whose leaf is a SYMLINK — refused, warned, and the target untouched', () => {
    seed('demo-quiet-mesa', '7');
    const target = path.join(h.home, 'elsewhere');
    fs.mkdirSync(target, { mode: 0o755 });
    fs.chmodSync(target, 0o755);
    fs.mkdirSync(tmpRoot(), { mode: 0o700 });
    fs.symlinkSync(target, leaf('demo-quiet-mesa'));
    const r = shStatus('_child_tmpdir demo-quiet-mesa; echo "[rc=$?]"');
    expect(r.out).toContain('[rc=2]');
    expect(r.out).toContain('ccd: warn: demo-quiet-mesa is a child but');
    expect(r.out, 'rc 2 prints no path on stdout').not.toContain(`${leaf('demo-quiet-mesa')}[rc`);
    expect(mode(target), 'the link was followed and its target re-moded').toBe(0o755);
  });

  it('rc 2 for a child whose leaf is a regular FILE', () => {
    seed('demo-quiet-mesa', '7');
    fs.mkdirSync(tmpRoot(), { mode: 0o700 });
    fs.writeFileSync(leaf('demo-quiet-mesa'), 'x');
    expect(shStatus('_child_tmpdir demo-quiet-mesa; echo "[rc=$?]"').out).toContain('[rc=2]');
  });

  it.skipIf(FOREIGN_DIR === null)('rc 2 for a child whose leaf is a real directory this user does NOT own — the chmod is the ownership check', () => {
    // Spec §5.2 as ruled: rc 0 only for a leaf that is a real directory, not a
    // symlink, OWNED BY THIS USER, at 0700. The root may be a symlink (the case
    // below), so aim it at `/` and name the child `usr`: its leaf is then a
    // real, non-symlink directory another user owns. chmod(2) by a non-owner
    // fails EPERM, so the chmod arm refuses it — and changes nothing there.
    h.sh(`_reg_set usr child '7'`);
    const before = mode(FOREIGN_DIR!);
    fs.symlinkSync('/', tmpRoot());
    try {
      const r = shStatus('_child_tmpdir usr; echo "[rc=$?]"');
      expect(r.out).toContain('[rc=2]');
      expect(r.out).toContain('ccd: warn: usr is a child but');
      expect(mode(FOREIGN_DIR!), 'a foreign directory was re-moded').toBe(before);
    } finally {
      // A runner holding CAP_FOWNER could have re-moded it; never leave that behind.
      if (mode(FOREIGN_DIR!) !== before) { try { fs.chmodSync(FOREIGN_DIR!, before); } catch { /* not ours to fix */ } }
      // Never leave a link to `/` for the harness's recursive cleanup to meet.
      fs.unlinkSync(tmpRoot());
    }
  });

  it('FOLLOWS a symlinked ROOT — `$HOME/.cc-tmp` on a data volume is the `$HOME/projects` shape', () => {
    seed('demo-quiet-mesa', '7');
    const vol = path.join(h.home, 'data-cc-tmp');
    fs.mkdirSync(vol, { mode: 0o700 });
    fs.symlinkSync(vol, tmpRoot());
    const r = shStatus('_child_tmpdir demo-quiet-mesa; echo "[rc=$?]"');
    expect(r.out).toBe(`${leaf('demo-quiet-mesa')}[rc=0]\n`);
    expect(fs.statSync(path.join(vol, 'demo-quiet-mesa')).isDirectory()).toBe(true);
  });
});

describe('_spawn_start exports TMPDIR for a child, and only for a child', () => {
  it('a child spawns with TMPDIR at its own root, spliced into the env string exactly once', () => {
    seed('demo-quiet-mesa', '7');
    h.sh(`${TMUX} rm -f "$HOME/pane-up"; _spawn_start demo-quiet-mesa new`);
    const news = newSessions();
    expect(news).toHaveLength(1);
    const want = `TMPDIR='${leaf('demo-quiet-mesa')}'`;
    expect(news[0]!.split(want).length - 1, news[0]).toBe(1);
    // Inside the `env` prefix, before the wrapper — not trailing after the
    // claude argv, where it would be an argument rather than an environment.
    expect(news[0]!.indexOf(want)).toBeLessThan(news[0]!.indexOf(`/.local/bin/claude'`));
    expect(news[0]!.indexOf('exec env ')).toBeLessThan(news[0]!.indexOf(want));
  });

  it('a row with NO marker spawns with no TMPDIR at all — byte-identical to before', () => {
    seed('demo-quiet-mesa', null);
    h.sh(`${TMUX} rm -f "$HOME/pane-up"; _spawn_start demo-quiet-mesa new`);
    expect(newSessions()[0]).not.toContain('TMPDIR=');
    expect(fs.existsSync(tmpRoot())).toBe(false);
  });

  it('a dispatched worker WITHOUT a marker (`rc=off`) is not a child — nothing infers it from --no-rc', () => {
    // The carried constraint "two authorities, always": `--no-rc` is the
    // dispatch path's OTHER declaration, and it must not stand in for this one.
    seed('demo-quiet-mesa', null);
    h.sh('_reg_set demo-quiet-mesa rc off');
    h.sh(`${TMUX} rm -f "$HOME/pane-up"; _spawn_start demo-quiet-mesa new`);
    expect(newSessions()[0]).not.toContain('TMPDIR=');
  });

  it('BOTH spawn lines carry it when the --resume attempt dies and the retry runs', () => {
    seed('demo-quiet-mesa', '7');
    h.sh(`${RESUME_DIES} rm -f "$HOME/pane-up"; _spawn_start demo-quiet-mesa resume 2>/dev/null`);
    const news = newSessions();
    expect(news).toHaveLength(2);
    expect(news[0]).toContain('--resume');
    expect(news[1]).toContain('--session-id');
    for (const line of news) expect(line).toContain(`TMPDIR='${leaf('demo-quiet-mesa')}'`);
  });

  it('a child whose root is unusable STILL SPAWNS — uncontained, warned, never refused', () => {
    seed('demo-quiet-mesa', '7');
    fs.mkdirSync(tmpRoot(), { mode: 0o700 });
    fs.writeFileSync(leaf('demo-quiet-mesa'), 'x');
    const r = shStatus(`${TMUX} rm -f "$HOME/pane-up"; _spawn_start demo-quiet-mesa new; echo "[rc=$?]"`);
    expect(r.out).toContain('[rc=0]');
    expect(r.out).toContain('could not be made a private directory');
    const news = newSessions();
    expect(news).toHaveLength(1);
    expect(news[0]).not.toContain('TMPDIR=');
  });

  it('the decision lives in _spawn_start and NOWHERE else — one reader, every spawn path', () => {
    // Every launcher funnels through `_spawn_start` (`ccd-spawn-split.test.ts`
    // pins that caller list), so one call there covers ws-add, ws-restore,
    // start, ensure, swap and both `_supervised_start` fallbacks. A second
    // call site would be a second decision free to disagree with the first.
    const out = h.sh(
      'fns=$(declare -F | sed "s/^declare -f //");'
      + ' printf "COUNT=%s\\n" "$(printf %s "$fns" | grep -c .)";'
      + ' while read -r f; do [[ "$f" == _child_tmpdir ]] && continue;'
      + ' type "$f" 2>/dev/null | grep -q "_child_tmpdir" && echo "$f"; done'
      + ' <<< "$fns" | sort; :');
    const lines = out.split('\n').filter(Boolean);
    const count = Number((lines.shift() ?? '').replace('COUNT=', ''));
    expect(count, 'the function walk was truncated — a failed measurement, not a short list')
      .toBeGreaterThan(100);
    expect(lines).toEqual(['_spawn_start']);
    // And its ONE input is the marker.
    expect(h.sh('type _child_tmpdir')).toContain('_reg_get "$id" child');
  });
});
