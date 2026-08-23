// `ccclip` is the Mac-side half of `ccd clip`: it grabs the clipboard PNG, scps
// it to the box as /tmp/ccclip-incoming-<n>.png, and asks ccd to file it.
//
// IT IS RUN FOR REAL HERE, not scraped. Three of its dependencies are supplied
// as EXPORTED BASH FUNCTIONS rather than as PATH entries, because line 8 of the
// script replaces PATH outright (`hotkey launchers have a minimal PATH`) and a
// stub directory would be thrown away with it — functions are resolved before
// PATH and survive. `BASH_FUNC_<name>%%` is the same device `ccd-ws-gc.test.ts`
// uses to shadow `cd`.
//
//   pngpaste — absent on Linux, and `command -v` finds a function
//   mktemp   — `mktemp -t ccclip` is BSD's form, which appends XXXXXXXX; GNU's
//              refuses a template with no X's, so the stub supplies the macOS
//              behaviour rather than the script pretending to be portable
//   scp/ssh  — no network, ever; both record their arguments and answer 0
//
// NOTHING IS WRITTEN TO THE REAL /tmp. The script's own remote path is a
// literal `/tmp/...` string on the far side of an ssh that never runs, so the
// second half below re-points it into the fixture HOME before executing it.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ghContainedEnv } from './ccdWsHelpers.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CCCLIP = path.join(REPO, 'ccd', 'ccclip');

let home: string;
beforeEach(() => { home = fs.mkdtempSync(path.join(os.tmpdir(), 'ccrc-ccclip-')); });
afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });

// Stage 5 (spec §4): ccclip carries no default box — BOX/SSH_KEY/CCD come
// from ~/.ccrc/ccclip.env (grepped, never sourced), and their absence is a
// refusal. The fixture values are the neutral documentation vocabulary; the
// CCD path below is ALSO the substitution target of the executes-for-real
// test at the bottom of this file.
const FIXTURE_BOX = 'you@198.51.100.7';
const FIXTURE_CCD = '/home/you/.local/bin/ccd';
const writeCcclipEnv = (text?: string): void => {
  fs.mkdirSync(path.join(home, '.ccrc'), { recursive: true });
  fs.writeFileSync(path.join(home, '.ccrc', 'ccclip.env'), text
    ?? `# my workstation, my box\nBOX=${FIXTURE_BOX}\nSSH_KEY=${home}/clip-key\nCCD=${FIXTURE_CCD}\n`);
};

/** Run the real ccclip with the four shadows described above. */
const runCcclip = (...args: string[]): { code: number; stdout: string; stderr: string } => {
  // `ghContainedEnv` even though ccclip replaces PATH on its own line 8 and
  // could not reach the poisoned `gh` if it tried: the containment gate in
  // ccd-workspaces.test.ts is deliberately STRUCTURAL — every bash spawn in a
  // ccd test file goes through it — and a file that argued its way out would be
  // the precedent that ends the invariant. It prepends, so it cannot be
  // displaced by the PATH below either.
  const env: NodeJS.ProcessEnv = ghContainedEnv(home, {
    PATH: process.env['PATH'], HOME: home, TMPDIR: home,
    'BASH_FUNC_pngpaste%%': '() { printf PNG > "$1"; }',
    'BASH_FUNC_mktemp%%': '() { local f="$HOME/ccclip-local-$RANDOM"; : > "$f"; printf "%s\\n" "$f"; }',
    'BASH_FUNC_scp%%': '() { printf "%s\\n" "${@: -1}" >> "$HOME/scp-dest"; }',
    'BASH_FUNC_ssh%%': '() { printf "%s" "${@: -1}" > "$HOME/ssh-cmd"; }',
  }, { systemd: true });
  try {
    const stdout = execFileSync('bash', [CCCLIP, ...args], { encoding: 'utf8', env });
    return { code: 0, stdout, stderr: '' };
  } catch (e) {
    const err = e as { status: number; stdout: string; stderr: string };
    return { code: err.status, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
};

const remotePath = (): string => {
  const dest = fs.readFileSync(path.join(home, 'scp-dest'), 'utf8').trim();
  const colon = dest.lastIndexOf(':');
  expect(colon, `scp destination has no host:path form: ${dest}`).toBeGreaterThan(-1);
  return dest.slice(colon + 1);
};

describe('ccclip carries no default box (S5)', () => {
  // Stage 5 (spec §4): the three literals that used to sit on ccclip's lines
  // 10-12 were one operator's reference fleet — a box address, a key name and
  // a remote home — baked into a tool this stage exists to make shippable.
  // Now they come from ~/.ccrc/ccclip.env or the run is a refusal that names
  // the remedy; the message is quoted VERBATIM by the stage-5 docs.
  const REFUSAL =
    'ccclip: no ~/.ccrc/ccclip.env — set BOX=, SSH_KEY=, CCD= there; ccclip carries no default box';

  it('refuses with instructions when the env file is absent — nothing is sent anywhere', () => {
    const r = runCcclip();
    expect(r.code, 'a boxless ccclip must refuse, not fall back to a remembered box').toBe(1);
    expect(r.stderr).toContain(REFUSAL);
    expect(fs.existsSync(path.join(home, 'scp-dest')), 'nothing was copied').toBe(false);
    expect(fs.existsSync(path.join(home, 'ssh-cmd')), 'nothing was executed').toBe(false);
  });

  it('an env file missing a key says SO — it does not claim the file is absent', () => {
    // The two conditions are different and the remedies are opposite: write a
    // file you have not written, versus find the typo in one you have. This
    // tool runs under a hotkey where stderr goes nowhere, so the one time the
    // operator runs it by hand the sentence has to be the true one. Collapsing
    // them is the overloaded-null-at-a-seam defect, in the worst place for it.
    writeCcclipEnv(`BOX=${FIXTURE_BOX}\nSSH_KEY=${home}/clip-key\n`); // no CCD=
    const r = runCcclip();
    expect(r.code).toBe(1);
    expect(r.stderr, 'a present-but-incomplete file was reported as absent').not.toContain(REFUSAL);
    expect(r.stderr).toContain('missing a value for: CCD');
    expect(r.stderr).toContain('the file exists');
    expect(fs.existsSync(path.join(home, 'scp-dest'))).toBe(false);
  });

  it('names every missing key at once, not one per run', () => {
    writeCcclipEnv('BOX=\nSSH_KEY=\nCCD=\n');
    const r = runCcclip();
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('missing a value for: BOX SSH_KEY CCD');
  });

  it('a QUOTED value is the value, not the value with quotes in it', () => {
    // `BOX="you@host"` is what a person writes. The naive reader carried the
    // quote marks into the scp destination, where they become part of the
    // hostname and the copy fails with a DNS error naming a host with a
    // double-quote in it.
    writeCcclipEnv([
      `BOX="${FIXTURE_BOX}"`,
      `SSH_KEY="${home}/clip-key"`,
      `CCD='${FIXTURE_CCD}'`,
      '',
    ].join('\n'));
    const r = runCcclip();
    expect(r.code, `stderr: ${r.stderr}`).toBe(0);
    const dest = fs.readFileSync(path.join(home, 'scp-dest'), 'utf8').trim();
    expect(dest.startsWith(`${FIXTURE_BOX}:`), `scp went to: ${dest}`).toBe(true);
    expect(dest, 'a quote mark reached the wire').not.toContain('"');
    expect(fs.readFileSync(path.join(home, 'ssh-cmd'), 'utf8')).toContain(FIXTURE_CCD);
  });

  it('an INDENTED key is still a key, and trailing spaces are not part of the path', () => {
    writeCcclipEnv([
      `  BOX=${FIXTURE_BOX}   `,
      `\tSSH_KEY=${home}/clip-key `,
      `CCD=${FIXTURE_CCD}`,
      '',
    ].join('\n'));
    const r = runCcclip();
    expect(r.code, `an indented line read as absent; stderr: ${r.stderr}`).toBe(0);
    const dest = fs.readFileSync(path.join(home, 'scp-dest'), 'utf8').trim();
    expect(dest.startsWith(`${FIXTURE_BOX}:`), `scp went to: ${dest}`).toBe(true);
  });

  it('the values the file names are the values the wire carries — grepped, last assignment wins', () => {
    // `grep | tail -n1 | cut -d= -f2-` is the same reader rule every other
    // ~/.ccrc env file follows (ccd/ccrc's _box_env_value): comments and
    // stale earlier assignments are ignored, the file is never sourced.
    writeCcclipEnv([
      '# a comment, not a value',
      'BOX=stale@stale.invalid',
      `BOX=${FIXTURE_BOX}`,
      `SSH_KEY=${home}/clip-key`,
      `CCD=${FIXTURE_CCD}`,
      '',
    ].join('\n'));
    const r = runCcclip();
    expect(r.code, `stderr: ${r.stderr}`).toBe(0);
    const dest = fs.readFileSync(path.join(home, 'scp-dest'), 'utf8').trim();
    expect(dest.startsWith(`${FIXTURE_BOX}:`), `scp went to: ${dest}`).toBe(true);
    expect(dest).not.toContain('stale');
    const cmd = fs.readFileSync(path.join(home, 'ssh-cmd'), 'utf8');
    expect(cmd).toContain(FIXTURE_CCD);
  });
});

describe('the shipped ccclip.env.example teaches the reader that exists', () => {
  // The example is the only instruction an operator gets — the refusal names
  // the three keys but not their shapes. If it drifts from what `_clip_env`
  // actually reads, the hotkey dies with its diagnostic on a stderr nobody
  // sees. Pinned against the SCRIPT, not against a second list here.
  const EXAMPLE = path.join(REPO, 'deploy', 'ccclip.env.example');

  it('names exactly the keys ccclip reads — no more, no fewer', () => {
    const declared = [...fs.readFileSync(EXAMPLE, 'utf8').matchAll(/^([A-Z_]+)=/gm)]
      .map((m) => m[1]).sort();
    const read = [...fs.readFileSync(CCCLIP, 'utf8').matchAll(/^([A-Z_]+)="\$\(_clip_env ([A-Z_]+)\)"$/gm)]
      .map((m) => m[2]).sort();
    expect(read.length, 'ccclip no longer reads its config through _clip_env').toBeGreaterThan(0);
    expect(declared).toEqual(read);
  });

  it('its own worked values parse through the real reader', () => {
    // Not "looks plausible" — the example is fed to ccclip and must drive a
    // complete run. An example that the reader rejects is worse than none.
    writeCcclipEnv(fs.readFileSync(EXAMPLE, 'utf8').replace(
      /^SSH_KEY=.*$/m, `SSH_KEY=${home}/clip-key`));
    const r = runCcclip();
    expect(r.code, `the shipped example does not parse; stderr: ${r.stderr}`).toBe(0);
  });
});

describe('ccclip does not orphan its incoming file on the box', () => {
  // Final-round gates "cannot-verify 5", and the item no lane's ownership list
  // contained. `ccd clip` only ever MOVES /tmp/ccclip-incoming-*.png, and it
  // `die`s before the move for three ordinary reasons — the path is not a file,
  // no cc session is attached, the named session is not alive. Every one of
  // those left the file on the box for ever, on a production path, with no
  // owner and no sweep. Same leak class the css lane closed for the pwa
  // fixtures, except this one is not a test.

  it('sends a remote command that removes the file whatever ccd clip does', () => {
    writeCcclipEnv();
    const r = runCcclip();
    expect(r.code, `stderr: ${r.stderr}`).toBe(0);
    const remote = remotePath();
    // TWO numeric components, and the second one is the assertion: `$$` alone
    // is a recycled pid, so two runs could name the same file and the second
    // scp would overwrite an image the first had not filed yet. There is no
    // fixture that can force a pid collision, so the NAME is what is pinned —
    // a test that waited for a real collision could never fail.
    expect(remote).toMatch(/^\/tmp\/ccclip-incoming-\d+-\d+\.png$/);
    const cmd = fs.readFileSync(path.join(home, 'ssh-cmd'), 'utf8');
    // The SAME path, in both halves of the command: a cleanup pointed at a
    // different name is not a cleanup.
    expect(cmd).toContain(`clip '${remote}'`);
    expect(cmd).toContain(`rm -f '${remote}'`);
    // …and the verb's own status is not swallowed by the rm.
    expect(cmd).toContain('exit $rc');
  });

  it('refuses a session id that would break out of the remote command', () => {
    // Found while fixing the leak above, on the same line. `ssh host "ccd clip
    // '$remote' '$1'"` is ONE string the box re-parses with sh, so a single
    // quote in the id closes the quoting and the rest runs there as the
    // operator. ccd validates the id with this same regex — but inside the
    // verb, i.e. after the shell that would already have run the injection.
    writeCcclipEnv();
    const evil = "x'; touch \"$HOME/pwned\"; '";
    const r = runCcclip(evil);
    expect(r.code, 'a bad id must not reach the box at all').toBe(1);
    expect(r.stderr).toContain('bad session id');
    expect(fs.existsSync(path.join(home, 'scp-dest')), 'nothing was even copied').toBe(false);
    expect(fs.existsSync(path.join(home, 'ssh-cmd'))).toBe(false);

    // The ordinary id still goes through unchanged — a guard that refused
    // everything would pass the assertions above and break the tool.
    const ok = runCcclip('claude2-expoAI-assistant');
    expect(ok.code, `stderr: ${ok.stderr}`).toBe(0);
    expect(fs.readFileSync(path.join(home, 'ssh-cmd'), 'utf8'))
      .toContain("'claude2-expoAI-assistant'");
  });

  it('the command it sends really does remove the file when the verb DIES', () => {
    // The first half proves what ccclip transmits; this proves what that text
    // does. The command is executed verbatim except for two substitutions: the
    // ccd path becomes a stub, and the literal `/tmp/...` becomes a file in the
    // fixture HOME, because nothing in this suite may write to the real /tmp —
    // which is the very thing being fixed.
    writeCcclipEnv();
    runCcclip();
    const remote = remotePath();
    const local = path.join(home, 'incoming.png');
    const raw = fs.readFileSync(path.join(home, 'ssh-cmd'), 'utf8');

    for (const [name, stub, wantCode] of [
      // `ccd clip` refusing before the move — `die` is `exit 1`.
      ['a refusal', 'ccdstub() { echo "ccd: session not alive" >&2; return 1; }', 1],
      // …and the success path, where the file has already been moved and the
      // rm is a no-op that must not change the answer.
      ['a success', 'ccdstub() { mv -f "$2" "$HOME/filed.png"; echo ok; }', 0],
    ] as const) {
      fs.writeFileSync(local, 'PNG');
      const script = raw.split(remote).join(local)
        .split(FIXTURE_CCD).join('ccdstub');
      expect(script, `${name}: a substitution that matched nothing is a silent no-op`)
        .not.toBe(raw);
      let code = 0;
      try {
        execFileSync('bash', ['-c', `${stub}\n${script}`],
          { encoding: 'utf8',
            env: ghContainedEnv(home, { PATH: process.env['PATH'], HOME: home }, { systemd: true }) });
      } catch (e) { code = (e as { status: number }).status; }
      expect(code, `${name}: the verb's own exit status must survive the cleanup`).toBe(wantCode);
      expect(fs.existsSync(local), `${name}: the incoming file was left on the box`).toBe(false);
    }
  });
});
