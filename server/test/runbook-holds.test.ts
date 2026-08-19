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
