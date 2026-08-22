// docs/superpowers/specs/2026-08-19-stage2-vm-gate-runbook.md quotes exact
// doctor-transcript lines and tells an operator to diff their real run
// against them ("On failure": any mismatch is "a real regression... file
// it"). Stage 2e Task 7, fix round 1: the runbook's first draft quoted
// `PASS rc: off (default)` for the state right after `bash install.sh` — the
// WRONG line for that scenario. `off (default)` is `_dr_rc_state`'s
// absent-FILE answer (`ccd/ccrc-doctor-checks`), but by the time doctor runs
// inside `cmd_install`, `_inst_rc` has ALREADY seeded the file (`off\n`) —
// same function body, `_inst_rc` called before the closing `cmd_doctor` — so
// the absent-file branch never fires and the real line is the bare
// `PASS rc: off`. The wrong quote grepped clean against `ccrc-doctor-checks`'
// SOURCE (the string "off (default)" genuinely exists there, just for a
// different scenario) — a naive text pin would not have caught it, because
// the defect was about WHICH branch a given scenario reaches, not a typo in
// a literal. What catches it here is composing three separately-measured
// facts about the real scenario rather than trusting a single grep:
//   1. ORDER — `_inst_rc` runs before `cmd_doctor` inside `cmd_install`
//      (source-order, the same `indexOf` idiom `deploy-verify.test.ts` uses
//      for D-99's fleet-lane seed).
//   2. BYTES — `_inst_rc` writes exactly `off\n` when the file is absent
//      (source-literal).
//   3. BEHAVIOUR — `_dr_rc_state`, the REAL function (sourced from the
//      repository, not re-implemented), given a file holding exactly those
//      bytes, returns the bare string `off`.
// Together, (1)+(2)+(3) are the causal chain the runbook's Step 2 depends on,
// each backed by either a source citation or a real execution — not a fixed
// expected string with no link back to why it is true.
//
// NARROW BY DESIGN: this does not pin the runbook's prose, only the
// exact-match transcript lines it stakes an operator's diff against, and it
// does not run the full `ccrc install` fixture (`ccrc-install.test.ts`
// already pays that cost once per file it needs it in — importing that file
// here would re-register its ~75 tests as a side effect of the module
// import, which is waste, not reuse).
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync, mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path, { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CCRC = join(root, 'ccd/ccrc');
const DOCTOR_CHECKS = join(root, 'ccd/ccrc-doctor-checks');
const runbookPath = path.join(root, 'docs/superpowers/specs/2026-08-19-stage2-vm-gate-runbook.md');
const runbook = readFileSync(runbookPath, 'utf8');
const ccrcSrc = readFileSync(CCRC, 'utf8');
const doctorChecksSrc = readFileSync(DOCTOR_CHECKS, 'utf8');
const installShSrc = readFileSync(join(root, 'install.sh'), 'utf8');

/** Step 2's own subsection — from its heading to the next `### ` heading —
 *  so a fence search below cannot wander into Step 5's or Step 7's blocks. */
const step2Section = (): string => {
  const start = runbook.indexOf('### 2. `bash install.sh`');
  expect(start, runbook).toBeGreaterThan(-1);
  const end = runbook.indexOf('\n### ', start);
  expect(end, 'Step 2 section never closes').toBeGreaterThan(start);
  return runbook.slice(start, end);
};

/** Every fenced (``` ... ```) code block inside `section`, body lines only
 *  (fence markers stripped), in document order. Step 2 has exactly three: the
 *  `bash install.sh` command itself, the FAIL wrappers block, and the PASS rc
 *  block — indexed below by position, since position IS the runbook's own
 *  structure. */
const fencedBlocks = (section: string): string[][] => {
  const lines = section.split('\n');
  const blocks: string[][] = [];
  let cur: string[] | null = null;
  for (const line of lines) {
    if (line.trim().startsWith('```')) {
      if (cur === null) { cur = []; } else { blocks.push(cur); cur = null; }
      continue;
    }
    if (cur !== null) cur.push(line);
  }
  return blocks;
};

/** `cmd_install`'s own body, column-1-`}`-bounded — the same truncation rule
 *  `agent/test/deploy-verify.test.ts` uses for its function-body regexes
 *  (this plan's own Global Constraints spell it out), so a nested `}` inside
 *  the function cannot end the match early. */
const cmdInstallBody = (): string => {
  const m = /^cmd_install\(\) \{\n([\s\S]*?)\n\}/m.exec(ccrcSrc);
  expect(m, 'cmd_install() { ... } not found in ccd/ccrc').not.toBeNull();
  return m![1];
};

/** `HOME=<home> bash -c '. ccrc-doctor-checks; _dr_rc_state'` — the REAL
 *  function, sourced from the repository (never re-implemented here), run
 *  against a throwaway HOME holding exactly the given flag-file bytes (or no
 *  file at all, if `body` is undefined). */
const runDrRcState = (body: string | undefined): string => {
  const home = mkdtempSync(join(tmpdir(), 'ccrc-runbook-holds-'));
  try {
    if (body !== undefined) {
      mkdirSync(join(home, '.ccrc'), { recursive: true });
      writeFileSync(join(home, '.ccrc', 'remote-control'), body);
    }
    const r = spawnSync('bash', ['-c', `. "$1"; _dr_rc_state`, 'bash', DOCTOR_CHECKS],
      { env: { ...process.env, HOME: home }, encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(0);
    return r.stdout;
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
};

/** Step 11's own section — from its heading to the next top-level (`## `)
 *  heading — same slicing rule as step2Section, same reason. */
const step11Section = (): string => {
  const start = runbook.indexOf('### 11. ');
  expect(start, 'the runbook has no step 11').toBeGreaterThan(-1);
  const end = runbook.indexOf('\n## ', start);
  expect(end, 'Step 11 section never closes').toBeGreaterThan(start);
  return runbook.slice(start, end);
};

/** The worked example step 11 stakes its transcript on: a duckdns box named
 *  `mybox.duckdns.org`. One fixture builder so every behavioural pin below
 *  measures the SAME box the runbook describes. */
const EXAMPLE_HOST = 'mybox.duckdns.org';

/** `HOME=<throwaway> bash -c '. ccrc; . ccrc-doctor-checks; <fn>'` — the REAL
 *  check function (ccrc is source-able by design: its dispatch is guarded by
 *  `BASH_SOURCE[0] == $0`), run against a fixture exposure.env holding the
 *  worked example, with optional stub binaries planted FIRST on PATH. The
 *  token value is a fixture; nothing here reads a real secret. */
const runExposureCheck = (fn: string, stubs?: Record<string, string>): string => {
  const home = mkdtempSync(join(tmpdir(), 'ccrc-runbook-holds-exp-'));
  try {
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'exposure.env'), [
      "# ccrc exposure config — regenerated by 'ccrc expose'; delete it to go dark.",
      `CCRC_ORIGIN=https://${EXAMPLE_HOST}`,
      `CCRC_RP_ID=${EXAMPLE_HOST}`,
      'CCRC_DDNS_PROVIDER=duckdns',
      `CCRC_DDNS_DOMAIN=${EXAMPLE_HOST}`,
      'CCRC_DDNS_TOKEN=fixture-token-not-real',
      '',
    ].join('\n'), { mode: 0o600 });
    let env: NodeJS.ProcessEnv = { ...process.env, HOME: home };
    if (stubs) {
      const bin = join(home, 'stub-bin');
      mkdirSync(bin);
      for (const [name, body] of Object.entries(stubs)) {
        writeFileSync(join(bin, name), `#!/usr/bin/env bash\n${body}\n`, { mode: 0o755 });
      }
      env = { ...env, PATH: `${bin}:${process.env.PATH}` };
    }
    const r = spawnSync('bash', ['-c', `. "$1"; . "$2"; ${fn}`, 'bash', CCRC, DOCTOR_CHECKS],
      { env, encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(0);
    return r.stdout;
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
};

describe('the VM-gate runbook quotes what a real fresh install actually prints', () => {
  it('Step 2 has exactly the three fenced blocks this file indexes by position', () => {
    // Guards every assertion below against a silently-added or -reordered
    // fence: if this count ever changes, the positional indexing downstream
    // needs a human decision, not a wrong match.
    expect(fencedBlocks(step2Section())).toHaveLength(3);
  });

  it("Step 2's FAIL wrappers remedy is the real remedy, not a paraphrase", () => {
    const [, failBlock] = fencedBlocks(step2Section());
    // The default seeded roster's one account — the id both templates below
    // substitute in. `bash install.sh`'s premise is this exact roster.
    const roster = JSON.parse(readFileSync(join(root, 'deploy/accounts.default.json'), 'utf8'));
    expect(roster.accounts).toHaveLength(1);
    const id = roster.accounts[0].id;
    expect(id).toBe('claude');

    const detailTemplate = /_wrp_bucket\+=\("\$id has no executable at \\\$HOME\/\.local\/bin\/\$id"\)/
      .exec(doctorChecksSrc);
    expect(detailTemplate, 'detail template not found in ccrc-doctor-checks').not.toBeNull();
    expect(failBlock[0]).toBe(`FAIL wrappers: ${id} has no executable at $HOME/.local/bin/${id}`);

    const remedyTemplate = /"install Claude Code so its binary lands at \\\$HOME\/\.local\/bin\/\$upstream_id — ([^"]+)"/
      .exec(doctorChecksSrc);
    expect(remedyTemplate, 'remedy template not found in ccrc-doctor-checks').not.toBeNull();
    const expectedRemedy = `install Claude Code so its binary lands at $HOME/.local/bin/${id} — ${remedyTemplate![1]}`;
    // The runbook manually word-wraps the remedy across markdown lines for
    // readability, with a "remedy: " label on the first of them (matching
    // `_dr_fail`'s own `"  remedy: %s\n"` line); `_dr_fail`'s printf never
    // embeds a newline in what it prints, so the real terminal output is ONE
    // physical line. Strip the label and rejoin the wrapped continuation
    // before comparing.
    const [remedyLabelLine, ...remedyRest] = failBlock.slice(1);
    expect(remedyLabelLine.trim()).toMatch(/^remedy: /);
    const runbookRemedy = [remedyLabelLine.trim().replace(/^remedy: /, ''),
      ...remedyRest.map((l) => l.trim())].join(' ');
    expect(runbookRemedy).toBe(expectedRemedy);
  });

  it('Step 2\'s closing "install: done" line matches the SOURCE\'s clean-run sentence', () => {
    expect(ccrcSrc).toContain('echo "install: done — every step above converged"');
    expect(runbook).toContain('`install: done — every step above converged`');
  });

  it("Step 2's PASS rc line is the state right after install, not the absent-file default", () => {
    // FACT 1 — ORDER: _inst_rc runs before cmd_doctor, same function body.
    const body = cmdInstallBody();
    const rcIdx = body.search(/^\s*_inst_rc\s*$/m);
    const doctorIdx = body.search(/^\s*cmd_doctor\s*$/m);
    expect(rcIdx, body).toBeGreaterThan(-1);
    expect(doctorIdx, body).toBeGreaterThan(-1);
    expect(rcIdx).toBeLessThan(doctorIdx);

    // FACT 2 — BYTES: _inst_rc writes exactly `off\n` when the file is absent.
    expect(ccrcSrc).toContain('printf \'%s\\n\' "off" > "$tmp"');

    // FACT 3 — BEHAVIOUR: the real _dr_rc_state, given those exact bytes,
    // answers the bare string `off`.
    // MUTATION MEASURED (2026-08-19, fix round 1): reverting the expectation
    // below to 'PASS rc: off (default)\n' — the runbook's original, wrong
    // quote for this scenario — reds this assertion alone (runDrRcState's
    // real output does not change; only the expectation is mutated), which
    // is exactly the check that would have caught the defect the review
    // found before it shipped.
    expect(runDrRcState('off\n')).toBe('off');

    const [, , rcBlock] = fencedBlocks(step2Section());
    expect(rcBlock.map((l) => l.trim()).filter(Boolean).join('\n')).toBe('PASS rc: off');
  });

  it('the absent-file case is still "off (default)" — the branch the runbook\'s wrong quote actually described', () => {
    // Sanity check on runDrRcState itself: proves the harness can produce the
    // OTHER form too, so "off" above is not an artifact of a harness that can
    // only ever answer one way.
    expect(runDrRcState(undefined)).toBe('off (default)');
  });

  it('Step 5\'s "unparseable" form is the literal string _dr_rc_state actually holds', () => {
    // A static literal (`garbled=...` inside `_dr_rc_state`), not a branch
    // whose SCENARIO can be gotten wrong the way the PASS rc: line above
    // was — a source-text pin is the right-sized check for it.
    const quoted = "off (unparseable — the file must hold one line reading 'on' or 'off')";
    expect(doctorChecksSrc).toContain(quoted);
    // Runbook prose, unlike the fenced blocks above, word-wraps mid-sentence
    // for markdown readability — this inline quote itself is split across two
    // lines in the source file. Collapse whitespace before searching so the
    // wrap point doesn't defeat a `toContain`.
    expect(runbook.replace(/\s+/g, ' ')).toContain(`PASS rc: ${quoted}`);
  });
});

// Stage 3b, Task 7: step 11 quotes the four exposure-check PASS lines and the
// root ceremony, and rewrites the two step-10 "does NOT prove" claims that 3b
// made stale. Same doctrine as the step-2 pins above: exact-match transcript
// lines are measured against the REAL functions (or, for static literals and
// templates, against the source that prints them), never restated as fixed
// strings with no link back to why they are true.
describe("step 11 quotes what the exposure doctor checks actually print", () => {
  it("the exposure PASS line is the REAL _check_exposure's answer for the worked example", () => {
    const line = `PASS exposure: configured — CCRC_ORIGIN=https://${EXAMPLE_HOST} (rp id: ${EXAMPLE_HOST}), mode 0600`;
    // BEHAVIOUR: the real function, real fixture file, 0600, all keys.
    expect(runExposureCheck('_check_exposure')).toBe(`${line}\n`);
    expect(step11Section()).toContain(line);
  });

  it("the caddy PASS line is _check_caddy's own static literal", () => {
    // A static source literal, like Step 5's unparseable form above — a
    // source-text pin is the right-sized check for it.
    const detail = "the caddy system unit is active — TLS terminates there and proxies to this box's loopback server";
    expect(doctorChecksSrc).toContain(detail);
    expect(step11Section()).toContain(`PASS caddy: ${detail}`);
  });

  it("the cert PASS line matches _check_cert's template, with the worked host and SOME day count", () => {
    // The template, pinned in the source it is printed from… ($addr since the
    // probe walks the box's addresses — loopback is candidate ONE, so the
    // worked line below is what the typical all-interfaces Caddy prints.)
    expect(doctorChecksSrc).toMatch(
      /_dr_pass cert "\$addr:443 serves a certificate for \$host, valid another \$days days"/,
    );
    // …and the runbook's quoted line is that template with the worked host and
    // worked address substituted and a day count (the parts the runbook's own
    // prose says vary box to box).
    expect(step11Section()).toMatch(
      new RegExp(`^PASS cert: 127\\.0\\.0\\.1:443 serves a certificate for ${EXAMPLE_HOST.replace(/\./g, '\\.')}, valid another \\d+ days$`, 'm'),
    );
  });

  it("the name PASS line is the REAL _check_name's answer when the record points at this box", () => {
    // BEHAVIOUR: real function, stubbed resolver and interface list — the
    // documentation address (TEST-NET-3) plays the box's public IP, which
    // _dr_ip4_global classifies as global.
    const out = runExposureCheck('_check_name', {
      getent: `echo "203.0.113.7     ${EXAMPLE_HOST}"`,
      hostname: 'echo "203.0.113.7"',
    });
    const line = `PASS name: ${EXAMPLE_HOST} resolves to this box (203.0.113.7)`;
    expect(out).toBe(`${line}\n`);
    expect(step11Section()).toContain(line);
  });

  it('the four PASS lines appear in one fenced block, in the check table\'s own order', () => {
    // The table order is the order doctor prints in; a transcript quoted in
    // any other order would never diff clean against a real run.
    const section = step11Section();
    const blocks = fencedBlocks(section);
    const transcript = blocks.find((b) => b.some((l) => l.startsWith('PASS exposure:')));
    expect(transcript, 'no fenced block quoting the exposure transcript').toBeTruthy();
    const names = transcript!.map((l) => /^PASS (\w+):/.exec(l)?.[1]).filter(Boolean);
    expect(names).toEqual(['exposure', 'caddy', 'cert', 'name']);
  });

  it('the root ceremony is the same three commands the verb prints and the caddy remedy repeats', () => {
    // Grounded in both printers: `_exp_landing` (ccrc) and `_check_caddy`'s
    // remedy (ccrc-doctor-checks) each carry the enable command; the runbook's
    // ceremony must name all three steps.
    expect(ccrcSrc).toContain('sudo systemctl enable --now caddy');
    expect(doctorChecksSrc).toContain('sudo systemctl enable --now caddy');
    expect(ccrcSrc).toContain('apt install caddy');
    const section = step11Section();
    expect(section).toContain('apt install caddy');
    // D-165: a COPY. The runbook printed `ln -sf` alongside the verb, and the
    // symlink cannot work — caddy runs as its own user and cannot traverse
    // `$HOME/.ccrc` (0700, ccrc's own doing), so it fails to load with a
    // permission error nowhere near the instruction that caused it. Pinned in
    // both directions so the doc and the verb cannot drift apart again.
    expect(section).toMatch(/sudo install -m 0644 .*\.ccrc\/Caddyfile \/etc\/caddy\/Caddyfile/);
    expect(section, 'the runbook still teaches the symlink that never worked')
      .not.toMatch(/ln -s/);
    expect(ccrcSrc, 'the verb still prints the symlink form').not.toContain('ln -sf $CCRC_CADDYFILE');
    expect(section).toContain('sudo systemctl enable --now caddy');
  });

  it('the rename sentence quoted is the shipped LoginScreen sentence — and the never-shipped one is gone', () => {
    // The 3a draft promised a refusal reading "enrolled for localhost —
    // re-enrol"; what shipped (stage 3b Task 5) is LoginScreen's rename
    // sentence. The runbook must quote the shipped words and must no longer
    // carry the invented ones, anywhere.
    const login = readFileSync(path.join(root, 'pwa/src/components/LoginScreen.tsx'), 'utf8');
    expect(login).toContain('Your passkeys were enrolled for a different box name (');
    expect(login).toContain('Sign in with the passphrase and re-enrol.');
    const collapsed = runbook.replace(/\s+/g, ' ');
    expect(collapsed).toContain('Your passkeys were enrolled for a different box name');
    expect(collapsed).toContain('Sign in with the passphrase and re-enrol.');
    expect(collapsed).not.toContain('enrolled for localhost — re-enrol');
  });

  it('the "does NOT prove" list points at step 11, and reports trustProxy as settled', () => {
    const start = runbook.indexOf('## What this run does NOT prove');
    expect(start).toBeGreaterThan(-1);
    const sec = runbook.slice(start);
    // The real-name/TLS proof now EXISTS in this document; the list must send
    // the reader there instead of at an unbuilt stage.
    expect(sec).toMatch(/step 11/);
    // And the proxy-trust half must state the settlement the code records
    // (config.ts: "settled: none"), not a decision still pending.
    expect(sec).toMatch(/trustProxy/);
    expect(sec.toLowerCase()).toContain('settled');
    const configTs = readFileSync(path.join(root, 'server/src/config.ts'), 'utf8');
    expect(configTs).toContain('The proxy-trust decision is settled: none');
  });
});

// ── Step 12 — the stage-4 release round-trip (spec §9) ─────────────────────
// Step 12 stakes an operator's diff against exact transcript lines from FOUR
// verbs that did not exist when this file was written: `install.sh --release`,
// `ccrc update`, `ccrc status` (its fleet line) and `ccrc uninstall`. Same
// doctrine as above — every pinned line is DERIVED from the source template
// that prints it (never a free-floating expected string), and only the
// exact-match lines the runbook fences are pinned, not its prose. The worked
// example uses two throwaway tags, v0.0.1 and v0.0.2, the way
// `deploy/ccrc.env.example` uses worked triples: concrete enough to diff
// against, obviously not a real release.
describe('step 12 (the release round-trip) quotes what the release verbs actually print', () => {
  /** Step 12's own section — from its heading to the next `### `/`## `
   *  heading (its `#### 12x.` sub-headings do not match either terminator). */
  const step12Section = (): string => {
    const start = runbook.indexOf('### 12.');
    expect(start, 'step 12 heading not found in the runbook').toBeGreaterThan(-1);
    const ends = [runbook.indexOf('\n### ', start), runbook.indexOf('\n## ', start)]
      .filter((i) => i > start);
    expect(ends.length, 'step 12 section never closes').toBeGreaterThan(0);
    return runbook.slice(start, Math.min(...ends));
  };

  it('the worked example is the two throwaway tags, and both appear', () => {
    const s = step12Section();
    expect(s).toContain('v0.0.1');
    expect(s).toContain('v0.0.2');
  });

  it("install.sh --release's handoff line is derived from install.sh's own template", () => {
    // The template, verbatim from install.sh — if the wording there changes,
    // this red says the runbook's quoted transcript is now stale.
    const template = 'echo "install.sh: verified $TARNAME — handing off to the staged \'ccrc install\'"';
    expect(installShSrc).toContain(template);
    // The worked example installs v0.0.1, so $TARNAME = ccrc-v0.0.1.tar.gz.
    expect(step12Section()).toContain(
      "install.sh: verified ccrc-v0.0.1.tar.gz — handing off to the staged 'ccrc install'");
  });

  it("`ccrc version`'s tag line is quoted for both tags, off the one echo that prints it", () => {
    expect(ccrcSrc).toContain('echo "version ${BOX_BUILD[4]}"');
    const s = step12Section();
    expect(s).toMatch(/^version v0\.0\.1$/m);
    expect(s).toMatch(/^version v0\.0\.2$/m);
  });

  it("`ccrc update`'s verified line is derived from _upd_fetch's template", () => {
    const template = 'echo "update: verified $tarname (transport checksum, then the per-file MANIFEST)"';
    expect(ccrcSrc).toContain(template);
    // The update in the worked example crosses to v0.0.2.
    expect(step12Section()).toContain(
      'update: verified ccrc-v0.0.2.tar.gz (transport checksum, then the per-file MANIFEST)');
  });

  it('the sweep close line is quoted verbatim — it is a constant in _upd_sweep', () => {
    const line = 'update: sweep: every live claude-session@ supervisor now runs the ccd this update installed (KillMode=process verified per unit before any restart; panes untouched)';
    expect(ccrcSrc).toContain(`echo "${line}"`);
    expect(step12Section()).toContain(line);
  });

  it("the from→to report line matches _upd_report's template and its versioned-desc shape", () => {
    // The template and the shape a VERSIONED stamp renders as ("vX.Y.Z (sha)")
    // — both source facts; the runbook line substitutes the two tags and marks
    // the shas as the box's own with explicit placeholders.
    expect(ccrcSrc).toContain('echo "update: build: $old_desc -> $new_desc"');
    expect(ccrcSrc).toContain('new_desc="${BOX_BUILD[4]} (${BOX_BUILD[0]})"');
    expect(step12Section()).toMatch(
      /^update: build: v0\.0\.1 \(<old sha>\) -> v0\.0\.2 \(<new sha>\)$/m);
  });

  it("`ccrc status`'s fleet line is quoted in both states, formatted off the one printf", () => {
    // The printf template is the single renderer of the fleet line
    // (`cmd_status`); the two quoted states are (skewed while one box is
    // stale) and (agreed after both updated) — R3's two halves. The empty
    // fourth field is the connected:true arm (link=""), which is the state a
    // live two-box run measures.
    const template = "printf 'fleet:     %s — build %s, roster %s%s\\n'";
    expect(ccrcSrc).toContain(template);
    const render = (overall: string, build: string, roster: string, link: string) =>
      `fleet:     ${overall} — build ${build}, roster ${roster}${link}`;
    const s = step12Section();
    expect(s).toContain(render('disagreed', 'skewed', 'agreed', ''));
    expect(s).toContain(render('agreed', 'agreed', 'agreed', ''));
  });

  it("`ccrc uninstall`'s close line is quoted verbatim — it is a constant in cmd_uninstall", () => {
    const line = 'uninstall: done — this box is off ccrc, and reinstall is safe: ~/.ccrc (config, roster, identity), the session registry rows, worktrees and ~/ccrc-backups were all preserved';
    expect(ccrcSrc).toContain(`echo "${line}"`);
    expect(step12Section()).toContain(line);
  });
});
