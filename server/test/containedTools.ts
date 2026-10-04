// containedTools.ts — the ONE place that says which tools a ccrc test env may never let reach a real binary, how a
// recording poison for one is planted, the curl that lets a loopback case through, and the check that a final env
// really holds (wave 9 R10d, D-3818..D-3820).
//
// IMPORTS ONLY `node:*`, and that is load-bearing: `installTreeFixture.ts` is vitest-free by its own header and
// imports this file for `keepDigest`'s env, so nothing here may reach `vitest` or a sibling that does.
//
// WHY EACH PIECE EXISTS
//
// * CONTAINED_TOOLS. Before this wave, "contained" meant whatever each builder remembered: `ghContainedEnv` planted
//   gh (and, on request, the managers and tmux); a builder planted curl and journalctl by hand. Measured at main
//   (the wave-9 Task 3 report): `updateEnv` left ssh, scp, tmux and curl real; `ccrcEnv` in ccrc-cli and
//   ccrc-install-graphify left ssh, scp, tmux and systemd-run real; `chainEnv`, the sourced harness and every raw
//   spawn of the real `ccd/ccrc` left systemctl and systemd-run real as well; and EVERY one of them inherited the
//   real `XDG_RUNTIME_DIR`, which is the real user bus. One list, read by the poisons, the checker, FIXTURE_BINS
//   and the darwin probe bin, is what keeps those from drifting apart again.
//
// * plantPoison is CREATE-IF-ABSENT, `ghContainedEnv`'s systemd/tmux rule and for its reason: a builder plants its
//   functional stub AFTER the poisons, and must win; a stub planted BEFORE them must be kept. A poison that
//   overwrote would turn every functional `ssh` or `systemctl` a case wrote first into a refusal.
//
// * loopbackCurlFront. Two cases in ccrc-update.test.ts measure the REAL curl's own `--max-time`/`--max-filesize`
//   bounds against a listener the case itself opened, and a poison would answer 97 and measure nothing. So their
//   curl is a front that execs the real one ONLY for a URL on 127.0.0.1 at a port the case listed in
//   `$HOME/curl-allow-ports`: never the live server's 7788 or the agent's 7789 by default, never another host, never
//   a `-K` config file (which could name a URL this scan cannot see). Everything it refuses is recorded.
//
// * assertNoRealTool reads RESOLUTION, never executes the tool: `command -v` under the env, then `realpath` of
//   what it printed. realpath, because a symlink from the fixture HOME to a real binary resolves to a path inside
//   HOME and is exactly the thing the check is for (`pathWithout`'s `no-<tool>-bin` dirs are such symlinks). It
//   also requires `XDG_RUNTIME_DIR` and `DBUS_SESSION_BUS_ADDRESS` to be SET, and under HOME: merely deleting
//   them would let ccrc's own `: "${XDG_RUNTIME_DIR:=/run/user/$UID}"` (seven pairs in ccd/ccrc, one in
//   ccrc-doctor-checks) default them to the real bus. A stub under HOME that itself execs a real binary is that
//   stub's own contract (the rsync recorder's and the loopback curl front's are two), not this check's.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

/** THE names a ccrc test env may never let resolve outside its fixture HOME (wave 9 R10d). The two managers and their
 *  macOS twin, tmux (the live fleet server), gh (a repo-WRITE token), curl (a live server), ssh and scp (a live box).
 *  ONE spelling: the poisons, the checker, FIXTURE_BINS and the darwin probe bin all read this list. */
export const CONTAINED_TOOLS = ['ssh', 'scp', 'systemctl', 'systemd-run', 'launchctl', 'tmux', 'gh', 'curl'] as const;

/** A recording poison at `<bin>/<name>`, CREATE-IF-ABSENT — `ghContainedEnv`'s systemd/tmux rule, for its reason: a
 *  builder plants its functional stub AFTER this runs, and must win; a stub planted BEFORE it is kept. Records argv to
 *  `$HOME/<name>-poison`, exit 97. */
export function plantPoison(bin: string, name: string): void {
  const p = path.join(bin, name);
  if (fs.existsSync(p)) return;
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(p,
    `#!/bin/sh\nprintf '%s\\n' "$*" >> "$HOME/${name}-poison"\n`
    + `echo "ccrc tests must never reach a real ${name}" >&2\nexit 97\n`, { mode: 0o755 });
}

/** A curl that execs `realCurl` ONLY when every URL it is handed (any argument containing `://`, and the argument after
 *  `--url`) is `http://127.0.0.1:<port>/…` with `<port>` a line of `$HOME/curl-allow-ports`; it appends each passed
 *  URL to `$HOME/curl-front-passed`. Anything else — another host, an unlisted loopback port (the live server's 7788
 *  and the agent's 7789 included), `-K`/`--config` — is appended to `$HOME/curl-poison` and refused, exit 97. */
export function loopbackCurlFront(realCurl: string): string {
  const real = `'${realCurl.replace(/'/g, `'\\''`)}'`;
  return [
    '#!/bin/sh',
    '# wave 9 R10d (D-3819): the loopback curl front — see containedTools.ts.',
    'allow="$HOME/curl-allow-ports"',
    'refuse() {',
    '  printf \'%s\\n\' "$*" >> "$HOME/curl-poison"',
    '  echo "ccrc tests: this curl reaches only http://127.0.0.1:<port>/ with <port> listed in $HOME/curl-allow-ports" >&2',
    '  exit 97',
    '}',
    'allowed() {',
    '  case "$1" in',
    '    http://127.0.0.1:[0-9]*)',
    '      rest=${1#http://127.0.0.1:}',
    '      port=${rest%%[!0-9]*}',
    '      tail=${rest#"$port"}',
    '      case "$tail" in',
    '        ""|/*) [ -f "$allow" ] && grep -qx "$port" "$allow" ;;',
    '        *) return 1 ;;',
    '      esac ;;',
    '    *) return 1 ;;',
    '  esac',
    '}',
    // One pass decides, a second records: a refusal after a partial record would be a lie in curl-front-passed.
    'scan() {',
    '  prev=',
    '  for a in "$@"; do',
    '    u=',
    '    case "$a" in',
    '      -K|--config|--config=*|-[!-]*K*) refuse "$@" ;;',
    '      --url=*) u=${a#--url=} ;;',
    '      *://*) u=$a ;;',
    '    esac',
    '    [ "$prev" = --url ] && u=$a',
    '    prev=$a',
    '    [ -n "$u" ] || continue',
    '    if [ "$mode" = check ]; then allowed "$u" || refuse "$@"; else printf \'%s\\n\' "$u" >> "$HOME/curl-front-passed"; fi',
    '  done',
    '}',
    'mode=check; scan "$@"',
    'mode=record; scan "$@"',
    // A proxy in the parent env would carry a loopback URL off the box.
    'unset http_proxy HTTP_PROXY https_proxy HTTPS_PROXY all_proxy ALL_PROXY',
    `exec ${real} "$@"`,
  ].join('\n') + '\n';
}

/** Where a bus env var points, as a path: the `path=` of a `unix:` address, or the bare value (XDG_RUNTIME_DIR). */
function busPath(name: string, value: string): string | null {
  if (name === 'XDG_RUNTIME_DIR') return value;
  const m = /^unix:(?:[^,]*,)*path=([^,]+)/.exec(value);
  return m ? m[1]! : null;
}

/** THROWS unless, under `env`, every CONTAINED_TOOLS name resolves to NOTHING or to a file whose REALPATH is inside
 *  realpath(home) — a symlink from the fixture to a real binary fails — and unless XDG_RUNTIME_DIR and
 *  DBUS_SESSION_BUS_ADDRESS are both SET and name a path inside home. One `/bin/sh -c 'command -v …'` per name; the
 *  resolved file is never executed. It reads RESOLUTION: a stub under home that itself execs a real binary is that
 *  stub's own contract (the rsync recorder's and the loopback curl front's are two), not this check's. */
export function assertNoRealTool(env: NodeJS.ProcessEnv, home: string): void {
  const homes = [path.resolve(home), fs.realpathSync(home)];
  const inside = (p: string): boolean => homes.some((h) => p === h || p.startsWith(h + path.sep));
  for (const name of ['XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS']) {
    const v = env[name];
    if (v === undefined || v === '') {
      throw new Error(`assertNoRealTool: ${name} is not set — ccrc would default it to the real user bus`);
    }
    const p = busPath(name, v);
    if (p === null || !inside(path.resolve(p))) {
      throw new Error(`assertNoRealTool: ${name}=${v} does not name a path inside the fixture HOME ${home}`);
    }
  }
  for (const name of CONTAINED_TOOLS) {
    const r = spawnSync('/bin/sh', ['-c', `command -v ${name}`], { env, encoding: 'utf8' });
    const resolved = (r.stdout ?? '').trim();
    if (resolved === '') continue;
    let real: string;
    try { real = fs.realpathSync(resolved); } catch { real = resolved; }
    if (!inside(real)) {
      throw new Error(`assertNoRealTool: ${name} resolved to ${resolved}`
        + `${real === resolved ? '' : ` (realpath ${real})`}, outside the fixture HOME ${home}`);
    }
  }
}
