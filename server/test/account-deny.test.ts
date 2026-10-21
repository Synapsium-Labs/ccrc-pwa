/**
 * The account deny guard's list (D-6202; accounts plan Task A9, spec §3.1, G21): `ACCOUNT_DENY_RULES`, the managed
 * `~/.cc-sessions/account-deny.settings.json` the installer writes from its bash twin, the approval classifier's
 * forbidden rows for the account verbs, and CLAUDE.md's SAFETY lines.
 *
 * AND WHAT IT NEVER REFUSES (the operator's Q8 ruling of 2026-10-19): `fixtures/account-deny/must-allow.json` is the
 * one MUST-ALLOW corpus (every swap verb in every invocation form, the swap route and the reads around a move), which
 * this suite, `session-hook-account-deny.test.ts` and the plan's Step 4b rig check iterate, never respell. No rule here
 * may match a form there under CF13's matcher grammar, and the classifier answers each as `main` did (`mainClass`,
 * recorded from `origin/main`'s classifier when the corpus was written).
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { mkTmp } from './tmpHelpers.js';
import {
  ACCOUNT_CLI_ONLY_VERBS, ACCOUNT_DENY_RULES, ACCOUNT_DENY_SUBS, ACCOUNT_READ_SUBS, ACCOUNT_SECRET_PATHS,
  ACCOUNT_SUBS, ACCOUNT_WRITE_DIRS,
} from '../../shared/api.js';
import { ACCOUNT_SUB_ARGV } from '../../shared/account-argv.js';
import { approvalClass, rootsForChild, type ApprovalClass } from '../src/coord/approvalguard.js';

const INSTALLER = path.resolve(__dirname, '../../ccd/install-session-hooks.sh');
const CLAUDE_MD = path.resolve(__dirname, '../../CLAUDE.md');
const SPEC = path.resolve(__dirname, '../../docs/superpowers/specs/2026-10-18-accounts-connect-design.md');
const MUST_ALLOW_FILE = path.resolve(__dirname, 'fixtures/account-deny/must-allow.json');

interface MustAllow { tool: string; input: Record<string, unknown>; mainClass: ApprovalClass }
const mustAllow = (): MustAllow[] => JSON.parse(fs.readFileSync(MUST_ALLOW_FILE, 'utf8'));

const HOMEDIR = '/rig/home';
const roots = rootsForChild({ id: 'project-a-quiet-basin', workdir: `${HOMEDIR}/ws/project-a-quiet-basin`, child: { kind: 'child', runId: 7 } }, HOMEDIR);
const classOf = (tool: string, input: Record<string, unknown>): ApprovalClass => approvalClass(tool, input, { ...roots!, cwd: null });

// ── CF13's matcher grammar, as its rig record states it ─────────────────────────────────────────────────────────────
// A `Bash(P:*)` rule is a prefix match on a command segment, a `Bash(P)` rule an exact one; each `&&`, `;`, `||` and `|`
// segment is matched on its own, after a leading `VAR=value` assignment is stripped (3c: chained and env-prefixed forms
// matched; a path-qualified one did not). `Read(…)` and `Edit(…)` rules are gitignore-style globs over a path, `~`
// anchored: `**` any depth, `*` one segment. This reading is wider than Claude Code's (it also looks inside a `bash -c`
// string), so a rule it lets through is one Claude Code lets through too.
const segments = (cmd: string): string[] => {
  const inner = [...cmd.matchAll(/\b(?:bash|sh)\s+-c\s+(['"])(.*?)\1/g)].map((m) => m[2] as string);
  return [cmd, ...inner].flatMap((c) => c.split(/&&|\|\||;|\|/))
    .map((s) => s.trim().replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)+/, ''));
};
const glob = (g: string): RegExp =>
  new RegExp(`^${g.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*')}$`);
const ruleMatches = (rule: string, tool: string, input: Record<string, unknown>): boolean => {
  const m = /^(Bash|Read|Edit)\((.*)\)$/.exec(rule);
  if (m === null) throw new Error(`a rule outside the grammar: ${rule}`);
  const [, kind, body] = m as unknown as [string, string, string];
  if (kind === 'Bash') {
    if (tool !== 'Bash' || typeof input['command'] !== 'string') return false;
    const prefix = body.endsWith(':*') ? body.slice(0, -2) : null;
    return segments(input['command']).some((s) => (prefix === null ? s === body : s.startsWith(prefix)));
  }
  const fp = input['file_path'];
  if (typeof fp !== 'string') return false;
  if (kind === 'Read' && tool !== 'Read') return false;
  if (kind === 'Edit' && !['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(tool)) return false;
  return glob(body).test(fp);
};
const anyRule = (tool: string, input: Record<string, unknown>): string | undefined =>
  ACCOUNT_DENY_RULES.find((r) => ruleMatches(r, tool, input));
const bashDenied = (command: string): string | undefined => anyRule('Bash', { command });

describe('the managed account deny file (D-6202)', () => {
  it('the managed file holds exactly ACCOUNT_DENY_RULES, iterated, not respelled, and its bash twin equals it', () => {
    const home = mkTmp('ccrc-acctdeny-');
    try {
      execFileSync('bash', [INSTALLER, '--homes', path.join(home, '.claude')], { env: { ...process.env, HOME: home }, stdio: 'ignore' });
      const doc = JSON.parse(fs.readFileSync(path.join(home, '.cc-sessions', 'account-deny.settings.json'), 'utf8'));
      expect(Object.keys(doc)).toEqual(['permissions']);
      expect(Object.keys(doc.permissions)).toEqual(['deny']);
      expect(doc.permissions.deny).toHaveLength(ACCOUNT_DENY_RULES.length);
      ACCOUNT_DENY_RULES.forEach((rule, i) => expect(doc.permissions.deny[i], `rule ${i}`).toBe(rule));
      // the children's file is untouched by it: still its own list, never joined on disk
      const child = JSON.parse(fs.readFileSync(path.join(home, '.cc-sessions', 'child-deny.settings.json'), 'utf8'));
      for (const r of ACCOUNT_DENY_RULES) expect(child.permissions.deny, r).not.toContain(r);
    } finally { fs.rmSync(home, { recursive: true, force: true }); }
  });

  it('the list names every mutating sub in ACCOUNT_SUBS and every path in spec §3.1', () => {
    const mutating = ACCOUNT_SUBS.filter((s) => !ACCOUNT_READ_SUBS.includes(s));
    expect(mutating.length).toBeGreaterThan(10);
    for (const sub of mutating) {
      const cli = `ccrc account ${ACCOUNT_SUB_ARGV[sub].cli.join(' ')} --id lane-x`;
      expect(bashDenied(cli), `${sub}: ${cli}`).toBeDefined();
    }
    // spec §3.1's bullet: "Read and Bash access to <paths>; writes under <dirs>"
    const spec = fs.readFileSync(SPEC, 'utf8');
    const m = /Read and Bash access to (.*?); writes under (.*?);/.exec(spec);
    expect(m, 'spec §3.1 names the paths').not.toBeNull();
    const ticks = (s: string): string[] => [...s.matchAll(/`([^`]+)`/g)].map((x) => x[1] as string);
    const reads = ticks(m![1]!);
    const writes = ticks(m![2]!);
    expect(reads.length).toBe(4);
    expect(writes.length).toBe(2);
    const sample = (p: string): string => p.replace(/\*/g, 'x').replace(/\/$/, '/x');
    for (const p of reads) expect(anyRule('Read', { file_path: sample(p) }), p).toMatch(/^Read\(/);
    for (const p of writes) expect(anyRule('Edit', { file_path: sample(p) }), p).toMatch(/^Edit\(/);
  });

  it('the list names every verb in ACCOUNT_CLI_ONLY_VERBS by its CLI spelling', () => {
    expect(Object.keys(ACCOUNT_CLI_ONLY_VERBS)).toEqual(expect.arrayContaining(['seed', 'openrouter-management ceiling', 'ccd-account-auth', 'ccd account-pane']));
    for (const [verb, cli] of Object.entries(ACCOUNT_CLI_ONLY_VERBS)) expect(bashDenied(`${cli} --x`), verb).toBeDefined();
    // `ceiling` is named on its own, beside the `openrouter-management` prefix
    expect(ACCOUNT_DENY_RULES).toContain('Bash(ccrc account openrouter-management ceiling:*)');
  });
});

describe('the classifier answers forbidden for each account verb (D-6202): no approval can rule one', () => {
  const verbs = [...ACCOUNT_DENY_SUBS.map((w) => `ccrc account ${w}`), ...Object.values(ACCOUNT_CLI_ONLY_VERBS)];
  const forms = (v: string): string[] => {
    const pq = v.replace(/^(ccrc|ccd-account-auth|ccd)\b/, '~/.local/bin/$1');
    return [`${v} --id lane-x`, `${pq} --id lane-x`, `FOO=1 ${v} --id lane-x`, `env FOO=1 ${v}`, `cd x && ${v} --id lane-x`,
      `ccd ls; ${v}`, `bash -c '${v} --id lane-x'`, v.replace(/^(\S+)/, '"$HOME/.local/bin/$1"')];
  };
  it('the classifier answers forbidden for each account verb in bare, path-qualified, env-prefixed, chained and `bash -c` forms', () => {
    const misses = verbs.flatMap((v) => forms(v).filter((c) => classOf('Bash', { command: c }) !== 'forbidden'));
    expect(misses).toEqual([]);
  });
});

describe('CLAUDE.md\'s SAFETY section (D-6202)', () => {
  const safety = (): string => {
    const md = fs.readFileSync(CLAUDE_MD, 'utf8');
    const start = md.indexOf('## SAFETY');
    const end = md.indexOf('\n## ', start + 1);
    return md.slice(start, end);
  };
  it('CLAUDE.md\'s SAFETY section names each command and path', () => {
    const s = safety();
    const missing = [
      ...ACCOUNT_DENY_SUBS.map((w) => `\`${w}\``), '`ccd-account-auth`', '`ccd account-pane`', '`ACCOUNT_DENY_RULES`',
      ...[...ACCOUNT_SECRET_PATHS, ...ACCOUNT_WRITE_DIRS].map((p) => `\`${p.replace(/\*\*$/, '')}\``),
    ].filter((w) => !s.includes(w));
    expect(missing).toEqual([]);
    expect(s).toMatch(/accident guard/);
  });
  it('CLAUDE.md\'s SAFETY section says that switching accounts and the auto-swap are never refused', () => {
    expect(safety()).toMatch(/[Ss]witching\s+accounts\s+and\s+the\s+auto-swap\s+are\s+never\s+refused/);
  });
});

describe('MUST-ALLOW: the guard never refuses a swap path (the operator\'s Q8 ruling, 2026-10-19)', () => {
  it('the corpus holds every swap verb in each invocation form, the route and the reads around a move', () => {
    const cmds = mustAllow().map((r) => String(r.input['command'] ?? r.input['file_path']));
    for (const want of ['ccd swap-self lane-b', 'ccrc account roster', 'ccrc account candidates', 'printenv TMUX', 'tail ~/.cc-sessions/swap.log']) {
      expect(cmds, want).toContain(want);
    }
    for (const verb of ['swap-self', 'swap', 'prefer']) {
      for (const head of ['~/.local/bin/ccd', '"$HOME/.local/bin/ccd"', '/.local/bin/ccd', '$C', '"$CCD"', '"${CCD:?}"', 'env FOO=1', 'cd x &&', 'bash -c']) {
        expect(cmds.some((c) => c.includes(head) && c.includes(` ${verb} `)), `${head} … ${verb}`).toBe(true);
      }
    }
    expect(cmds.some((c) => c.includes('/api/sessions/') && c.includes('/swap'))).toBe(true);
  });
  it('no rule in ACCOUNT_DENY_RULES matches any form in must-allow.json', () => {
    const hits = mustAllow().flatMap((r) => {
      const rule = anyRule(r.tool, r.input);
      return rule === undefined ? [] : [`${JSON.stringify(r.input)} <- ${rule}`];
    });
    expect(hits).toEqual([]);
    // the grammar is live: the same matcher refuses a listed form
    expect(bashDenied('cd x && FOO=1 ccrc account remove --id lane-x')).toBe('Bash(ccrc account remove:*)');
    expect(anyRule('Read', { file_path: '~/.cc-secrets/x-oauth.env' })).toBe('Read(~/.cc-secrets/**)');
  });
  it('the classifier answers every MUST-ALLOW form as `main` does', () => {
    const diff = mustAllow().flatMap((r) => {
      const now = classOf(r.tool, r.input);
      return now === r.mainClass ? [] : [`${JSON.stringify(r.input)}: main ${r.mainClass}, now ${now}`];
    });
    expect(diff).toEqual([]);
  });
});
