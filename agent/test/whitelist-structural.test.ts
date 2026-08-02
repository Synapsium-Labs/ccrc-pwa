// FINAL REVIEW, gates finding 4 — the no-`gh` invariant used to be pinned by
// exactly one test in one file.
//
// The decisive experiment, reproduced on `4e8b689` before this fix: delete
// `test/whitelist-noghosts.test.ts` (32 tests) and add `gh: [['pr','view']]`
// to `EXEC_WHITELIST`, and the agent suite reports **99/99 PASS**, the server's
// cross-check **35/35 PASS**, and `tsc --noEmit` clean. One `rm` silently
// removed the branch's own stated most dangerous invariant.
//
// The human partner's ruling on this class is STRUCTURAL OVER TEXTUAL — the
// same ruling that replaced layer 2b's source scan with the `CcdArgv` brand
// after four regexes lost to four ways of naming a value. This file is the half
// of the answer that a test CAN carry: it asserts that the two type mechanisms
// in `whitelist.ts` actually produce compile errors (they are useless if they
// silently stop applying), and that the runtime self-audit actually throws when
// handed a widened list. The other half — the type annotations themselves and
// the import-time `auditExecWhitelist()` call — is not a test at all and does
// not depend on this file existing.
//
// WHY A SEPARATE tsc RUN AND NOT `@ts-expect-error`: identical to
// `server/test/ccdargv-brand.test.ts`. `agent/tsconfig.json` does not include
// `test/`, and the agent's vitest config has no typecheck block, so a
// `@ts-expect-error` written here is evaluated by no gate — a pin that cannot
// fail. Spawning tsc over projects that DO include the fixtures is the only
// form with teeth.
//
// WHAT THIS STILL DOES NOT COVER, disclosed rather than implied: nothing in a
// repository the editor fully controls can be made un-removable. Granting `gh`
// is now three coordinated edits to three separately named constants in
// `whitelist.ts` (the object literal, `EXEC_COMMANDS`, `FORBIDDEN_COMMANDS`),
// each of which says in its own name what it is for, plus deletions in two
// packages. What is closed is the class the old pin lost to: one `rm` of one
// file, and a diff that reads as ordinary.
import { describe, it, expect, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EXEC_COMMANDS,
  EXEC_WHITELIST,
  FORBIDDEN_COMMANDS,
  GRANTABLE_COMMANDS,
  auditExecWhitelist,
  isExecAllowed,
} from '../src/whitelist.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const agentRoot = path.resolve(here, '..');
const bypassDir = path.join(here, 'types', 'bypasses');

// `typescript/bin/tsc` is not an exported subpath, so resolve the package's
// main entry and walk to the bin next to lib/ — a bare `tsc` would depend on
// PATH, which this suite deliberately contains (contain-path.setup.ts).
const req = createRequire(import.meta.url);
const TSC = path.resolve(path.dirname(req.resolve('typescript')), '..', 'bin', 'tsc');

function typecheck(project: string): { code: number; out: string } {
  const r = spawnSync(process.execPath, [TSC, '-p', project, '--noEmit'], {
    cwd: agentRoot, encoding: 'utf8',
  });
  return { code: r.status ?? -1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

const bypasses = typecheck('test/types/tsconfig.bypasses.json');
const positive = typecheck('test/types/tsconfig.ok.json');

/** Every distinct `TSxxxx` code tsc reported against one bypass fixture. */
const codesFor = (file: string): string[] => {
  const prefix = `test/types/bypasses/${file}(`;
  const codes = bypasses.out.split('\n')
    .filter((l) => l.startsWith(prefix))
    .map((l) => /error (TS\d+):/.exec(l)?.[1] ?? 'NO-CODE');
  return [...new Set(codes)].sort();
};

/** The CODES are asserted, not merely "it failed": a fixture failing on TS2304
 *  (cannot find name, e.g. after a rename or a moved import) would be a broken
 *  fixture wearing a passing pin. */
const EXPECTED: Record<string, { what: string; codes: string[] }> = {
  'g1-gh-key-above-ccd.ts':   { what: "the review's own mutation, written above the ccd key", codes: ['TS2353'] },
  'g2-gh-key-below-ccd.ts':   { what: 'the same grant written below it — a type has no notion of position', codes: ['TS2353'] },
  'g3-gh-as-exec-command.ts': { what: "widening the key union instead of the literal", codes: ['TS2322'] },
  'g4-missing-declared-key.ts': { what: 'the reverse drift: declared but not granted', codes: ['TS2741'] },
  // VERIFY ROUND 2, P1 — the same treatment one level down, on prefix VALUES.
  // Every g1..g4 mechanism reads the KEY SET; none of them looks inside a
  // prefix list, which is why the verifier could delete `--expect` with tsc
  // clean, the module-load audit silent and the server's cross-check at 37/37.
  'g5-ws-reap-without-expect.ts': { what: "the verifier's own mutation: ws-reap with no confirmation token", codes: ['TS2322'] },
  'g6-ws-reap-wrong-flag.ts':     { what: "the same grant with a plausible WRONG token (--session)", codes: ['TS2322'] },
  'g7-ws-rm-readmitted.ts':       { what: 'the unguarded legacy delete, re-admitted', codes: ['TS2322'] },
  'g8-empty-prefix.ts':           { what: 'an empty prefix — the widest grant expressible, as the smallest diff', codes: ['TS2322'] },
};

describe('mechanism 1+2 — granting `gh` fails to COMPILE, wherever it is written', () => {
  it('the bypass fixture project does not typecheck', () => {
    expect(bypasses.code, `tsc unexpectedly succeeded:\n${bypasses.out}`).not.toBe(0);
  });

  // Same guard as SAMPLES in whitelist-subset.test.ts: a fixture added without
  // an expectation, or an expectation whose fixture was deleted, is a hole.
  it('has an expectation for every fixture on disk, and a fixture for every expectation', () => {
    expect(readdirSync(bypassDir).filter((f) => f.endsWith('.ts')).sort())
      .toEqual(Object.keys(EXPECTED).sort());
  });

  it.each(Object.keys(EXPECTED))('%s', (file) => {
    const exp = EXPECTED[file]!;
    expect(codesFor(file), `${exp.what} — expected ${exp.codes.join('+')} from:\n${bypasses.out}`)
      .toEqual(exp.codes);
  });

  it('g1 and g2 fail identically — the pin is position-independent', () => {
    // This is the specific improvement over the server's layer-3 source-text
    // slice, which starts at the `ccd` key and therefore could not see a grant
    // written above it (measured: server 35/35 PASS with the grant in place).
    expect(codesFor('g1-gh-key-above-ccd.ts')).toEqual(codesFor('g2-gh-key-below-ccd.ts'));
    expect(codesFor('g1-gh-key-above-ccd.ts')).not.toEqual([]);
  });
});

describe('the pins are not a blanket refusal, and they pin FORBIDDEN_COMMANDS itself', () => {
  it('the positive control compiles clean', () => {
    // It also carries `Assert<'gh' extends ForbiddenCommand>` and
    // `Equals<ExecCommand, 'tmux' | 'ccd'>`, so this assertion is what breaks
    // if the third edit — deleting `gh` from FORBIDDEN_COMMANDS — is made.
    expect(positive.out).toBe('');
    expect(positive.code).toBe(0);
  });

  it('the positive control really does assert the invariants, not just compile', () => {
    // Without this, emptying the fixture would make the test above pass
    // trivially while removing the only compile-level pin on FORBIDDEN_COMMANDS.
    const src = readFileSync(path.join(here, 'types', 'ok', 'legit-whitelist.ts'), 'utf8');
    expect(src).toContain("Assert<'gh' extends ForbiddenCommand ? true : false>");
    expect(src).toContain("Assert<Equals<ExecCommand, 'tmux' | 'ccd'>>");
    expect(src).toContain('const good: ExecWhitelist');
    // VERIFY ROUND 2, P1: and the value half. Without the positive control, a
    // `LawfulGrants` that collapsed to `never` for EVERY table (say, after a
    // rename left `IllegalGrant` matching nothing) would satisfy g5..g8 while
    // pinning nothing — "the bypasses fail" is only evidence when a legitimate
    // table still builds.
    expect(src).toContain('export const lawful: LawfulGrants<typeof lawfulTable>');
    expect(src).toContain("Equals<(typeof REQUIRED_VERB_FLAG)['ws-reap'], '--expect'>");
  });
});

describe('mechanism 3 — the runtime self-audit refuses to boot on a widened list', () => {
  // The audit is the layer that survives everything a type cannot see: a
  // deliberate cast, an `any`-typed value, array covariance, or a hand-edit of
  // the compiled dist/ JS on the fleet host. `ccdargv.ts` discloses those as
  // the brand's residual class; here they are closed, because the audit reads
  // the ACTUAL object's own keys at runtime after every cast has happened.
  it('throws on a `gh` grant — the real widened shape, not a stub', () => {
    const widened = {
      tmux: [['has-session']],
      ccd: [['start']],
      gh: [['pr', 'view']],
    };
    expect(() => auditExecWhitelist(widened)).toThrow(/forbidden command: gh/);
  });

  it.each(['gh', 'git', 'bash', 'curl', 'ssh', 'sudo', 'node', 'systemctl'])(
    'throws on a `%s` grant', (cmd) => {
      expect(() => auditExecWhitelist({ tmux: [], ccd: [], [cmd]: [[]] }))
        .toThrow(/forbidden command/);
    },
  );

  it('throws on a key that is merely undeclared — drift, not just danger', () => {
    // A grant nothing declares is the "route added, whitelist not updated,
    // green everywhere, 502 on the fleet" failure. Not forbidden, still wrong.
    expect(() => auditExecWhitelist({ tmux: [], ccd: [], jq: [['.']] }))
      .toThrow(/drifted from EXEC_COMMANDS/);
  });

  // VERIFY ROUND 2, item 3 — the availability objection, answered by drawing a
  // line rather than by keeping or dropping the throw wholesale. The audit now
  // refuses to boot ONLY for over-permission. A declared command with NO entry
  // cannot grant anything (the worst case is one route answering 502), so
  // killing an agent on a host running 11 live sessions for it was the wrong
  // trade; it is a loud non-fatal error now. It is still caught before a host
  // ever sees it by TS2741 (fixture g4), by the assertion above, and by layer 3
  // of the server's whitelist-subset.test.ts.
  it('does NOT throw when a declared command is merely MISSING — that grants nothing', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() => auditExecWhitelist({ tmux: [] })).not.toThrow();
      expect(spy).toHaveBeenCalledTimes(1);
      const msg = String(spy.mock.calls[0]?.[0] ?? '');
      expect(msg).toMatch(/drifted from EXEC_COMMANDS/);
      expect(msg).toMatch(/Missing grant\(s\): ccd/);
      // Diagnosability: the agent's own log prefix, so this line is findable
      // with the same grep as every other thing the agent ever printed.
      expect(msg.startsWith('ccrc-agent:')).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it('an UNDECLARED key is still fatal — missing is under-permission, extra is not', () => {
    // The pair that shows the line is drawn where the comment says it is, and
    // not simply "drift no longer throws".
    expect(() => auditExecWhitelist({ tmux: [], ccd: [], jq: [] }))
      .toThrow(/Undeclared grant\(s\): jq/);
  });

  it('every fatal message carries the agent log prefix and says it is refusing', () => {
    // The throw happens during ESM evaluation, before index.ts's body runs, so
    // nothing in the agent gets to format it — node prints it and exits. The
    // message is therefore the ENTIRE diagnostic, and it has to read like an
    // agent log line rather than a bare assertion.
    for (const bad of [
      { tmux: [], ccd: [], gh: [['pr', 'view']] },
      { tmux: [], ccd: [], jq: [] },
      { tmux: [], ccd: [['ws-reap']] },
      { tmux: [], ccd: [[]] },
    ]) {
      let msg = '';
      try { auditExecWhitelist(bad); } catch (e) { msg = e instanceof Error ? e.message : String(e); }
      expect(msg, JSON.stringify(bad)).not.toBe('');
      expect(msg.startsWith('ccrc-agent: '), msg).toBe(true);
      expect(msg, msg).toMatch(/Refusing to start\.$/);
    }
  });

  it('accepts the real list — the audit is not a blanket refusal', () => {
    expect(() => auditExecWhitelist()).not.toThrow();
    expect(() => auditExecWhitelist(EXEC_WHITELIST)).not.toThrow();
  });

  it('is actually called at module load, so a widened list is a boot failure', () => {
    // The mechanism is the CALL, not the function. If the call is deleted the
    // agent starts happily with a `gh` grant, so the call site is asserted.
    const src = readFileSync(path.join(agentRoot, 'src', 'whitelist.ts'), 'utf8');
    const topLevelCall = src.split('\n').some((l) => l === 'auditExecWhitelist();');
    expect(topLevelCall, 'whitelist.ts must call auditExecWhitelist() at module scope').toBe(true);
  });
});

// VERIFY ROUND 2, P1 — the runtime half of the value pin. The type above is
// erased at build time and the compiled `dist/whitelist.js` on the fleet host
// is a plain object literal; this is the mechanism that survives that, a cast,
// an `any`, and a `JSON.parse`.
describe('mechanism 3, values — a prefix that grants more than it names is a boot failure', () => {
  const withCcd = (prefixes: unknown[]): Record<string, unknown> => ({ tmux: [], ccd: prefixes });

  it('throws on a ws-reap with no confirmation token — the reported instance', () => {
    expect(() => auditExecWhitelist(withCcd([['start'], ['ws-reap']])))
      .toThrow(/only grantable with '--expect'/);
  });

  it('throws on a ws-reap with the WRONG token, not merely a missing one', () => {
    expect(() => auditExecWhitelist(withCcd([['ws-reap', '--session']])))
      .toThrow(/only grantable with '--expect'/);
    expect(() => auditExecWhitelist(withCcd([['ws-reap', '--expect']]))).not.toThrow();
    // Order matters: `--expect` has to be the token IMMEDIATELY after the verb,
    // because that is the only position `isExecAllowed`'s prefix rule pins. A
    // grant of `['ws-reap', '--session', '--expect']` would permit
    // `ccd ws-reap --session <id>` outright, since a prefix constrains only its
    // own length and nothing past it.
    expect(() => auditExecWhitelist(withCcd([['ws-reap', '--session', '--expect']])))
      .toThrow(/only grantable with '--expect'/);
  });

  it('throws on an ungrantable verb at the head of a prefix', () => {
    for (const verb of ['ws-rm', 'ws-gc']) {
      expect(() => auditExecWhitelist(withCcd([[verb]])), verb).toThrow(/ungrantable verb/);
      expect(() => auditExecWhitelist(withCcd([[verb, '--session']])), verb).toThrow(/ungrantable verb/);
    }
  });

  it('throws on an EMPTY prefix — vacuously true, so it grants every subcommand', () => {
    // `[].every(...)` is true, so `isExecAllowed('ccd', ['ws-rm', 'x'])` would
    // answer TRUE with one empty prefix present. Demonstrated, not asserted:
    expect([].every(() => false)).toBe(true);
    expect(() => auditExecWhitelist(withCcd([['start'], []]))).toThrow(/EMPTY prefix/);
  });

  it('throws on a prefix that is not a list of string tokens', () => {
    // A non-array prefix makes `p.every` THROW inside the lookup rather than
    // answer — the destructive-F7 class, one `try/catch` from being a hole.
    expect(() => auditExecWhitelist(withCcd(['ws-reap']))).toThrow(/not a list of string tokens/);
    expect(() => auditExecWhitelist(withCcd([[1, 2]]))).toThrow(/not a list of string tokens/);
  });

  it('a value that is not a prefix list at all is under-permission — loud, not fatal', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() => auditExecWhitelist({ tmux: [], ccd: 'nope' })).not.toThrow();
      expect(String(spy.mock.calls[0]?.[0] ?? '')).toMatch(/is not a list of argv prefixes/);
    } finally {
      spy.mockRestore();
    }
  });

  it('the SHIPPED table survives its own audit, and ws-reap really does carry --expect', () => {
    expect(() => auditExecWhitelist()).not.toThrow();
    const reap = EXEC_WHITELIST.ccd.filter((p) => p[0] === 'ws-reap');
    expect(reap.length, 'exactly one ws-reap grant').toBe(1);
    expect(reap[0]).toEqual(['ws-reap', '--expect']);
    expect(EXEC_WHITELIST.ccd.map((p) => p[0])).not.toContain('ws-rm');
    expect(EXEC_WHITELIST.ccd.map((p) => p[0])).not.toContain('ws-gc');
    expect(EXEC_WHITELIST.ccd.every((p) => p.length > 0)).toBe(true);
  });

  it('a token-free reap is refused by the lookup, not merely by the audit', () => {
    // The behavioural end of the same invariant, stated here as well as in
    // exec.test.ts and whitelist-noghosts.test.ts, because the verifier's
    // finding was precisely that deleting those two files re-opened it.
    expect(isExecAllowed('ccd', ['ws-reap', '--session', 'demo-quiet-basin'])).toBe(false);
    expect(isExecAllowed('ccd', ['ws-reap'])).toBe(false);
    expect(isExecAllowed('ccd', ['ws-reap', '--expect', 'a'.repeat(64), '--session', 'x'])).toBe(true);
  });
});

// VERIFY ROUND 2, P2 — the auditor must consult EXACTLY what the lookup
// consults. It did not: `Object.keys` is own-ENUMERABLE, `Object.hasOwn` is
// own-enumerable-OR-NOT, and one `Object.defineProperty(..., { enumerable:
// false })` granted `gh pr merge` with all three non-test mechanisms silent.
describe('the audit and the lookup ask the same question', () => {
  it('a NON-ENUMERABLE own key is a grant, and the audit sees it', () => {
    const sneaky: Record<string, unknown> = { tmux: [], ccd: [] };
    Object.defineProperty(sneaky, 'gh', { value: [['pr', 'merge']], enumerable: false });
    // The exact asymmetry that was exploitable, demonstrated on the fixture:
    expect(Object.keys(sneaky)).toEqual(['tmux', 'ccd']);
    expect(Object.hasOwn(sneaky, 'gh')).toBe(true);
    expect(() => auditExecWhitelist(sneaky)).toThrow(/forbidden command: gh/);
  });

  it('a non-enumerable UNDECLARED key is caught too, not just a forbidden one', () => {
    const sneaky: Record<string, unknown> = { tmux: [], ccd: [] };
    Object.defineProperty(sneaky, 'jq', { value: [['.']], enumerable: false });
    expect(() => auditExecWhitelist(sneaky)).toThrow(/Undeclared grant\(s\): jq/);
  });

  it('a SYMBOL-keyed grant lands in the drift branch instead of vanishing', () => {
    const sneaky: Record<PropertyKey, unknown> = { tmux: [], ccd: [] };
    sneaky[Symbol('gh')] = [['pr', 'merge']];
    expect(() => auditExecWhitelist(sneaky as Record<string, unknown>))
      .toThrow(/Undeclared grant\(s\): Symbol\(gh\)/);
  });

  it('the lookup gates on the DECLARED set, so a planted own key grants nothing', () => {
    // The other half of the P2 fix, and the one that matters if the audit is
    // ever bypassed: `isExecAllowed` now asks `GRANTABLE_COMMANDS.includes`,
    // not merely "does an own property exist". The real table is frozen, so
    // this is asserted on the real object — defineProperty on a frozen object
    // throws, which is itself the first line of defence.
    expect(() => Object.defineProperty(EXEC_WHITELIST, 'gh', {
      value: [['pr', 'merge']], enumerable: false,
    })).toThrow(TypeError);
    expect(isExecAllowed('gh', ['pr', 'merge', '1'])).toBe(false);
    expect((GRANTABLE_COMMANDS as readonly string[]).includes('gh')).toBe(false);
  });
});

describe('the key set and the forbidden set, asserted as values', () => {
  it('EXEC_WHITELIST has exactly the two declared keys — position-independent', () => {
    expect(Object.keys(EXEC_WHITELIST).sort()).toEqual(['ccd', 'tmux']);
    expect([...EXEC_COMMANDS].sort()).toEqual(['ccd', 'tmux']);
    expect([...GRANTABLE_COMMANDS].sort()).toEqual(['ccd', 'tmux']);
  });

  it('gh is in FORBIDDEN_COMMANDS, alongside every shell-equivalent escape', () => {
    for (const cmd of ['gh', 'hub', 'git', 'bash', 'sh', 'env', 'node', 'ssh', 'curl', 'sudo', 'docker']) {
      expect(FORBIDDEN_COMMANDS as readonly string[], `${cmd} must stay forbidden`).toContain(cmd);
    }
  });

  it('every forbidden command is refused by isExecAllowed, with any argv', () => {
    for (const cmd of FORBIDDEN_COMMANDS) {
      expect(isExecAllowed(cmd, []), cmd).toBe(false);
      expect(isExecAllowed(cmd, ['pr', 'merge', '1']), cmd).toBe(false);
      expect(isExecAllowed(cmd, ['-c', 'echo hi']), cmd).toBe(false);
    }
  });

  it('the exported list is frozen — "exported for reading" holds at runtime too', () => {
    // Exporting it is what lets a different package assert its keys. Freezing
    // is what stops an `as any` reaching in and widening it in place; the type
    // alone cannot, exactly as the CcdArgv brand alone could not stop
    // `Object.assign` onto a minted argv (13S-F1).
    expect(Object.isFrozen(EXEC_WHITELIST)).toBe(true);
    expect(Object.isFrozen(EXEC_WHITELIST.ccd)).toBe(true);
    expect(Object.isFrozen(EXEC_WHITELIST.tmux)).toBe(true);
    expect(Object.isFrozen(EXEC_WHITELIST.ccd[0])).toBe(true);
    const loose = EXEC_WHITELIST as unknown as Record<string, string[][]>;
    expect(() => { loose['gh'] = [['pr', 'merge']]; }).toThrow(TypeError);
    expect(() => { loose['ccd']!.push(['ws-rm']); }).toThrow(TypeError);
    expect(Object.keys(EXEC_WHITELIST).sort()).toEqual(['ccd', 'tmux']);
    expect(isExecAllowed('gh', ['pr', 'merge', '1'])).toBe(false);
    expect(isExecAllowed('ccd', ['ws-rm', 'x'])).toBe(false);
  });
});

// The prototype-name refusal (gates finding 6 / destructive F7) is pinned by
// `whitelist-prototype.test.ts`, not here. One assertion stays, because it is
// about THIS file's subject: the audit's key set and the lookup's `hasOwn`
// guard have to agree that a prototype name is not a declared key.
describe('the declared key set and the lookup guard agree', () => {
  it('a prototype name is not an own key, so it can never be a grant', () => {
    expect(Object.hasOwn(EXEC_WHITELIST, 'constructor')).toBe(false);
    expect(Object.hasOwn(EXEC_WHITELIST, '__proto__')).toBe(false);
    expect(Object.keys(EXEC_WHITELIST)).not.toContain('constructor');
    expect(() => auditExecWhitelist({ tmux: [], ccd: [], constructor: [[]] }))
      .toThrow(/drifted from EXEC_COMMANDS/);
  });
});
