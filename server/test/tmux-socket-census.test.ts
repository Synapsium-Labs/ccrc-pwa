// D-8270 (the session host research's §6.1 ruling on Q8): ONE shared tmux server for now, and EVERY tmux call goes
// through one socket lookup, so a later split (a server per session or per project) is a change of setting.
//
// The lookup is `_tmx_sock` / `_tmx_argv` / `_tmx` in bash, one block defined in `ccd/ccd` and copied byte for byte
// into each script that cannot source it, and `tmuxCommand` / `tmuxRoute` in `shared/tmux-target.ts` for TypeScript.
// Both read the first line of `~/.ccrc/tmux-socket`. This census holds the tree to it:
//   - no bash file under ccd/ or deploy/ runs `tmux` itself outside the lookup block, save the named exceptions;
//   - no TypeScript or JavaScript file spawns the literal 'tmux' outside the lookup, save the named exceptions, and
//     the two generic executors that can run a tmux request route it;
//   - each copy of the block is ccd/ccd's, and the bash and TypeScript twins agree on the name rule, the file and the
//     refusal;
//   - with the setting naming a socket, the calls ccd makes all carry `-L <name>`, and none does without it.
import { describe, expect, it, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { bashCode, rawBashTmux, rawTsTmux, type Site } from './tmuxSocketCensus.js';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';
import { sourceOfSymbol } from './scan/symbols.js';
import { TMUX_REFUSE_SH, TMUX_SOCKET_FILE, TMUX_SOCKET_NAME_RE } from '../../shared/tmux-target.js';

const ROOT = path.resolve(__dirname, '../..');
const read = (f: string): string => fs.readFileSync(path.join(ROOT, f), 'utf8');
const tracked = (...dirs: string[]): string[] =>
  execFileSync('git', ['ls-files', '-z', '--', ...dirs], { cwd: ROOT, encoding: 'utf8' }).split('\0').filter(Boolean);

/** Every tracked bash program or library under ccd/ and deploy/: a `.sh`, or a file whose `#!` names bash or sh. */
const BASH_FILES = tracked('ccd', 'deploy').filter((f) => {
  if (f.endsWith('.sh')) return true;
  if (/\.[A-Za-z0-9]+$/.test(path.basename(f)) && !/\.(bash)$/.test(f)) return false;
  return /^#!.*\b(?:ba)?sh\b/.test(read(f).split('\n', 1)[0]!);
});
/** Every tracked TypeScript or JavaScript source that runs on a box (tests are not). */
const SCRIPT_FILES = tracked('server/src', 'agent/src', 'shared', 'ccd', 'deploy')
  .filter((f) => /\.(?:ts|mts|cts|mjs|cjs|js)$/.test(f) && !/\.d\.[cm]?ts$/.test(f));

const BLOCK_START = '# >>> D-8270 tmux socket lookup';
const BLOCK_END = '# <<< D-8270 tmux socket lookup';

/** The lookup block of `src`, from its start marker line to its end marker line, or null when it has none. */
function lookupBlock(src: string): { first: number; last: number; text: string } | null {
  const lines = src.split('\n');
  const first = lines.findIndex((l) => l.startsWith(BLOCK_START));
  if (first < 0) return null;
  const last = lines.findIndex((l, i) => i > first && l.startsWith(BLOCK_END));
  if (last < 0) return null;
  return { first: first + 1, last: last + 1, text: lines.slice(first, last + 1).join('\n') };
}

interface Exception { file: string; has: string; count?: number; why: string }

const AUTH_LANE = 'the auth lane\'s OWN private tmux server (`-L ccrc-auth-<id>`), never the fleet\'s: a sign-in pane is '
  + 'kept off the shared server by design, so it has no business with the fleet\'s socket setting';

/** The raw bash `tmux` calls this tree keeps, each with why. `count` is exact; a new raw call fails until it is routed
 *  or reviewed into this list. */
const BASH_EXCEPTIONS: readonly Exception[] = [
  { file: 'ccd/ccd-account-auth', has: 'tmux -L "', count: 5, why: AUTH_LANE },
  { file: 'ccd/ccrc', has: 'tmux -L "ccrc-auth-$id"', count: 3, why: AUTH_LANE },
  { file: 'ccd/ccd', has: 'tmux -L "$sock" -f /dev/null', count: 4, why: AUTH_LANE },
  {
    file: 'ccd/ccd', has: 'tmux -S "/tmp/tmux-$AM_UID/${TMX_SOCK:-default}"', count: 1,
    why: 'the account door asks by socket PATH, built from the lookup\'s own name (`_tmx_sock "$AM_HOME"`, the password '
      + 'database\'s home), so `$TMUX` and `$TMUX_TMPDIR`, which a caller sets, never pick the server it asks',
  },
  { file: 'ccd/ccrc-doctor-checks', has: '_dr_need_bin tmux ', count: 1, why: 'a check that the program is on PATH, not a call of it' },
];

/** The TypeScript and JavaScript sites that name the literal 'tmux', each with why. */
const TS_EXCEPTIONS: readonly Exception[] = [
  {
    file: 'server/src/exec.ts', has: "this.run('tmux'",
    why: 'the Tmux adapter\'s REQUESTS to its Runner; both runners that execute one route it through `tmuxRoute` (the '
      + 'server\'s `realRunner`, the agent\'s exec), which `the two executors route` below pins',
  },
  { file: 'shared/tmux-target.ts', has: "{ file: 'tmux', args:", count: 1, why: 'the lookup itself (`tmuxCommand`)' },
  { file: 'agent/src/testbox/client.ts', has: "probe('tmux', 'tmux', ['-V'])", count: 1, why: '`tmux -V` prints the client\'s version and asks no server' },
  { file: 'agent/src/testboxOp.ts', has: "{ file: 'tmux', args: ['-V'] }", count: 1, why: '`tmux -V` prints the client\'s version and asks no server' },
  {
    file: 'ccd/history/cli.mjs', has: "spawnSync('tmux', ['display-message', '-p', '-t', pane, '#S']", count: 1,
    why: 'asks the CALLING pane\'s own server, through the `$TMUX` tmux sets in every pane, which session it is: that '
      + 'question has one right server whatever the setting says. The history tool is installed on its own and cannot '
      + 'import the TypeScript lookup; a split that moves panes routes it with the rest',
  },
  {
    file: 'ccd/history/sweep.mjs', has: "spawnSync('tmux', ['display-message', '-p', '-t', pane, '#S'],", count: 1,
    why: 'the same pane question as ccd/history/cli.mjs, for the irreversible forms\' gate',
  },
];

const covered = (s: Site, list: readonly Exception[]): boolean =>
  list.some((e) => e.file === s.file && s.text.includes(e.has));

/** Every raw bash call in `file`'s `src` outside its lookup block. */
function bashOutsideBlock(file: string, src: string): Site[] {
  const b = lookupBlock(src);
  return rawBashTmux(file, src).filter((s) => b === null || s.line < b.first || s.line > b.last);
}

describe('D-8270 — no raw tmux call in bash: every one goes through the lookup', () => {
  it('the scan reads the tree — floors on the files and on the routed calls it found', () => {
    expect(BASH_FILES).toEqual(expect.arrayContaining([
      'ccd/ccd', 'ccd/ccrc', 'ccd/ccrc-doctor-checks', 'ccd/session-hook.sh', 'ccd/statusline-command.sh',
      'ccd/ccd-telemetry-keepalive', 'ccd/ccd-scope-sweep', 'ccd/ccrc-api', 'ccd/lib/disk-retention.sh',
    ]));
    // MEASURED when the lookup went fork-free: ccd/ccd's 106 tmux calls, every one now `_tmx …` as a statement (59)
    // or `"${_TMX_ARGV[@]}" …` in a capture, a pipeline or behind a wrapper that execs its argv (47, and `_tmx`'s own
    // body). A floor, not an equality: an empty scan would pass every assertion below. The spread is inside double
    // quotes, so it is counted on the comment-free source.
    const src = read('ccd/ccd');
    const direct = (bashCode(src).match(/(?:^|[^A-Za-z0-9_])_tmx[ \t]/gm) ?? []).length;
    const spread = src.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n').match(/"\$\{_TMX_ARGV\[@\]\}"/g)?.length ?? 0;
    expect(direct).toBeGreaterThanOrEqual(57);
    expect(spread).toBeGreaterThanOrEqual(46);
  });

  it('no capture or pipeline stage calls `_tmx`: there it spreads `"${_TMX_ARGV[@]}"`, the supervise tick\'s fork budget', () => {
    // bash execs a lone command in `$( … )`, `<( … )` or a pipeline stage without a second fork; the function in its
    // place costs that fork on every call, which `ccd-tick-budget.test.ts` measured (+5 forks a tick on idle-home).
    const CAPTURE = /[$<]\(\s*_tmx[ \t]/;
    const PIPED = /(?:^|[^A-Za-z0-9_])_tmx[ \t][^\n]*?[^|]\|(?!\|)/;
    const bad = BASH_FILES.flatMap((f) => {
      const b = lookupBlock(read(f));
      return bashCode(read(f)).split('\n').flatMap((l, i) =>
        ((b !== null && i + 1 >= b.first && i + 1 <= b.last) || !(CAPTURE.test(l) || PIPED.test(l)) ? [] : [`${f}:${i + 1}`]));
    });
    expect(bad).toEqual([]);
    expect(CAPTURE.test('x=$(_tmx list-panes -t "$t")') && PIPED.test('_tmx capture-pane -p | tail -8')).toBe(true);
    expect(PIPED.test('_tmx kill-session -t "$t" 2>/dev/null || true')).toBe(false);
  });

  it('outside the lookup block, every raw `tmux` is a named exception', () => {
    const bad = BASH_FILES.flatMap((f) => bashOutsideBlock(f, read(f)))
      .filter((s) => !covered(s, BASH_EXCEPTIONS)).map((s) => `${s.file}:${s.line}: ${s.text}`);
    expect(bad).toEqual([]);
  });

  it('every exception still matches, as many times as it says', () => {
    for (const e of BASH_EXCEPTIONS) {
      const n = bashOutsideBlock(e.file, read(e.file)).filter((s) => s.text.includes(e.has)).length;
      expect(n, `${e.file}: ${e.has}`).toBe(e.count);
    }
  });
});

describe('D-8270 — the lookup is one block, the same bytes in every script that cannot source ccd', () => {
  /** A file that only ever runs SOURCED by another (`ccd/lib/*.sh` by ccd/ccd, the doctor's checks by ccrc). */
  const SOURCED_BY: Readonly<Record<string, string>> = {
    'ccd/lib/disk-retention.sh': 'ccd/ccd',
    'ccd/lib/train-proof.sh': 'ccd/ccd',
    'ccd/lib/delegation-lease.sh': 'ccd/ccd',
    'ccd/ccrc-doctor-checks': 'ccd/ccrc',
  };
  const canonical = lookupBlock(read('ccd/ccd'));

  it('ccd/ccd defines it', () => {
    expect(canonical).not.toBeNull();
  });

  it('each file that calls the lookup carries the same block, or is sourced by one that does', () => {
    // A caller names a lookup function in code, or spreads its argv (inside double quotes, so read on the
    // comment-free source: the doctor's checks only ever spread it).
    const spreads = (src: string): boolean =>
      src.split('\n').some((l) => !/^\s*#/.test(l) && l.includes('"${_TMX_ARGV[@]}"'));
    const callers = BASH_FILES.filter((f) =>
      /(?:^|[^A-Za-z0-9_])_tmx(?:_argv|_sock)?\b/m.test(bashCode(read(f))) || spreads(read(f)));
    expect(callers.length).toBeGreaterThanOrEqual(8);
    for (const f of callers) {
      const host = SOURCED_BY[f] ?? f;
      const b = lookupBlock(read(host));
      expect(b?.text, `${f} calls the lookup, but ${host} carries no copy of it`).toBe(canonical!.text);
    }
  });

  it('nothing defines the lookup outside a block', () => {
    for (const f of BASH_FILES) {
      const src = read(f);
      const b = lookupBlock(src);
      src.split('\n').forEach((l, i) => {
        if (b !== null && i + 1 >= b.first && i + 1 <= b.last) return;
        expect(l, `${f}:${i + 1}`).not.toMatch(/^\s*_tmx(?:_argv|_sock)?\s*\(\)/);
        expect(l, `${f}:${i + 1}`).not.toMatch(/(?:^|[\s;(])_TMX_ARGV=\(/);
      });
    }
  });

  it('the bash and TypeScript twins agree: the file, the name rule, the refusal', () => {
    const t = canonical!.text;
    expect(t).toContain(`/${TMUX_SOCKET_FILE}"`);
    expect(t).toContain(`=~ ${TMUX_SOCKET_NAME_RE.source} ]]`);
    expect(t).toContain(`sh -c '${TMUX_REFUSE_SH}' "ccrc: tmux was not asked: $TMX_WHY"`);
  });
});

describe('D-8270 — no raw tmux spawn in TypeScript or JavaScript: every one goes through the lookup', () => {
  it('every site naming the literal \'tmux\' as a program is a named exception', () => {
    const bad = SCRIPT_FILES.flatMap((f) => rawTsTmux(f, read(f)))
      .filter((s) => !covered(s, TS_EXCEPTIONS)).map((s) => `${s.file}:${s.line}: ${s.text}`);
    expect(bad).toEqual([]);
  });

  it('every exception still matches, as many times as it says', () => {
    for (const e of TS_EXCEPTIONS) {
      const n = rawTsTmux(e.file, read(e.file)).filter((s) => s.text.includes(e.has)).length;
      if (e.count === undefined) expect(n, `${e.file}: ${e.has}`).toBeGreaterThan(0);
      else expect(n, `${e.file}: ${e.has}`).toBe(e.count);
    }
  });

  it('the two executors that can run a tmux request route it: the server\'s realRunner and the agent\'s exec', () => {
    const runner = sourceOfSymbol('server/src/exec.ts', 'realRunner');
    expect(runner).toContain('tmuxRoute(cmd, args, hostTmuxSocket)');
    expect(runner).toContain('execFile(routed.file, [...routed.args]');
    const agent = read('agent/src/server.ts');
    expect(agent).toContain('tmuxRoute(req.cmd, req.args, () => fleetTmuxSocket(ctx.cfg.home))');
    expect(agent).toContain('runExec(resolveSpawnCmd(routed.file, ctx.cfg.home), [...routed.args]');
    // And the two drawers spawn through the lookup.
    expect(sourceOfSymbol('server/src/pty.ts', 'attachPty')).toContain("tmuxCommand(hostTmuxSocket(), ['attach', '-t', tmuxTarget(id)])");
    expect(read('agent/src/pty.ts')).toContain("tmuxCommand(fleetTmuxSocket(), ['attach', '-t', tmuxTarget(sessionId)])");
  });
});

describe('D-8270 — the census refuses a raw call (fixtures)', () => {
  it('bash: every shape a call takes is found, and nothing that is not a call', () => {
    const fixture = [
      'f() {',
      '  tmux kill-session -t "$(_tmux_t "$id")"',
      '  out=$(tmux display-message -p \'#S\')',
      '  x="$(_plat_timeout 2 tmux list-panes -a)"',
      '  exec tmux attach -t "$t"',
      '  tmux "$@"',
      '  /usr/bin/tmux list-sessions',
      '  _tmx kill-session -t "$t"',
      '  _plat_timeout 2 "${_TMX_ARGV[@]}" has-session -t "$t"',
      '  command -v tmux >/dev/null; type -t tmux; declare -F tmux >/dev/null',
      '  echo "tmux has-session failed"   # tmux list-panes in a comment',
      "  echo 'tmux kill-server'",
      '  cat <<EOF',
      'tmux kill-server',
      'EOF',
      '  n=$(( x << 2 )); tmux list-clients',
      '}',
    ].join('\n');
    expect(rawBashTmux('fixture', fixture).map((s) => s.line)).toEqual([2, 3, 4, 5, 6, 7, 16]);
  });

  it('bash: one raw line added to the real ccd/ccd is found and named', () => {
    const line = 'tmux kill-session -t "$(_tmux_t "$1")" 2>/dev/null || true';
    const src = `${read('ccd/ccd')}\n${line}\n`;
    const bad = bashOutsideBlock('ccd/ccd', src).filter((s) => !covered(s, BASH_EXCEPTIONS));
    expect(bad.map((s) => s.text)).toEqual([line]);
  });

  it('TypeScript: a raw spawn added to a real source is found, and the adapter\'s exception does not cover it', () => {
    const src = `${read('server/src/exec.ts')}\nexport const census = () => spawn('tmux', ['kill-server']);\n`;
    const bad = rawTsTmux('server/src/exec.ts', src).filter((s) => !covered(s, TS_EXCEPTIONS));
    expect(bad.map((s) => s.text)).toEqual(["export const census = () => spawn('tmux', ['kill-server']);"]);
    expect(rawTsTmux('x.ts', "execFileSync(\"tmux\", ['ls']); // spawn('tmux')\nconst t = { file: 'tmux' };").length).toBe(2);
  });
});

describe('D-8270 — changing the setting moves every call; without it nothing changes', () => {
  let h: CcdHarness;
  const setting = (body: string | null): void => {
    const f = path.join(h.home, '.ccrc', 'tmux-socket');
    fs.mkdirSync(path.dirname(f), { recursive: true });
    if (body === null) fs.rmSync(f, { force: true }); else fs.writeFileSync(f, body);
  };
  /** The argv lines the harness's PATH tmux recorded since the last call, then cleared. */
  const calls = (): string[] => {
    const f = path.join(h.home, 'tmux-calls');
    const out = fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean) : [];
    fs.rmSync(f, { force: true });
    return out;
  };
  /** Calls reached by the plain path, by the bounded path (`_plat_timeout` execs the argv) and through ccd's own
   *  verbs and helpers. `|| true`: the harness's tmux refuses (rc 97), which is the point — it records and fails. */
  const SNIPPET = [
    '_tmx list-sessions',
    '_plat_timeout 2 "${_TMX_ARGV[@]}" has-session -t "$(_tmux_t demo)"',
    '_session_probe demo',
    '_pane_born demo',
    '_pane_scope_tmux list-panes -a -F x',
    '_tmx -V',
  ].map((l) => `${l} >/dev/null 2>&1 || true`).join('; ');

  beforeAll(() => { h = makeCcdHarness('ccrc-tmux-socket-'); });

  it('no setting: every call is exactly the argv it was', () => {
    setting(null);
    h.sh(SNIPPET);
    const got = calls();
    expect(got.length).toBeGreaterThanOrEqual(6);
    for (const c of got) expect(c).not.toMatch(/^-[LS] /);
    expect(got).toContain('list-sessions');
    expect(got).toContain('has-session -t =cc-demo:');
  });

  it('an empty setting is the default server too', () => {
    setting('');
    h.sh(SNIPPET);
    for (const c of calls()) expect(c).not.toMatch(/^-[LS] /);
  });

  it('a socket name: every call carries `-L <name>` first', () => {
    setting('fleet-a\n');
    h.sh(SNIPPET);
    const got = calls();
    expect(got.length).toBeGreaterThanOrEqual(6);
    for (const c of got) expect(c).toMatch(/^-L fleet-a /);
    expect(got).toContain('-L fleet-a list-sessions');
    expect(got).toContain('-L fleet-a has-session -t =cc-demo:');
  });

  it('a setting that names no socket: tmux is never asked, every call answers rc 1 and why', () => {
    for (const bad of ['../x\n', 'a b\n', '-L\n']) {
      setting(bad);
      const out = h.sh('_tmx has-session -t "$(_tmux_t demo)"; echo "rc=$?"; _session_probe demo; echo "$PROBE_VERDICT"');
      expect(out).toContain('rc=1');
      expect(out).toContain('unknown');   // could not ask, never gone
      expect(calls()).toEqual([]);
    }
    fs.rmSync(path.join(h.home, '.ccrc', 'tmux-socket'));
    fs.mkdirSync(path.join(h.home, '.ccrc', 'tmux-socket'));
    expect(h.sh('_tmx_sock; echo "rc=$? $TMX_WHY"')).toMatch(/^rc=1 .*\/\.ccrc\/tmux-socket cannot be read$/m);
    fs.rmdirSync(path.join(h.home, '.ccrc', 'tmux-socket'));
  });

  it('the account door builds its socket path from the same lookup, under the password database\'s home', () => {
    const body = read('ccd/ccd');
    const who = body.slice(body.indexOf('_am_who() {'), body.indexOf('_am_caller() {'));
    expect(who).toContain('_tmx_sock "$AM_HOME"');
    expect(who).toContain('tmux -S "/tmp/tmux-$AM_UID/${TMX_SOCK:-default}"');
  });
});
