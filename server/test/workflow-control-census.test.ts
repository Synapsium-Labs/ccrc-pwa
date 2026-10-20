// D-5936 (spec 2026-10-20 §4.5): the workflow control verb, `POST /api/sessions/:id/workflows/:runId/control`, is
// operator-only in three layers: it is absent from the auth gate's `EXEMPT` (auth-gate.test.ts), the classifier
// forbids any Bash or MCP request naming it (approvalguard.test.ts), and no surface a session can run composes it.
// This census holds the third layer. Its deny-list is the session-runnable surfaces under `ccd/`; `shared/api.ts`'s
// docstrings, `README.md` and `docs/` stay free to name the route. It reads tracked files only and runs nothing.
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHILD_DENY_RULES } from '../../shared/api.js';
import { FORBIDDEN_PATTERNS } from '../src/coord/approvalguard.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** The surfaces a session can run: its API client, its session manager, its hook and the coordinator skill. */
const DENY_LIST = ['ccd/ccrc-api', 'ccd/ccd', 'ccd/session-hook.sh', 'ccd/coordinator-skill/'] as const;

/** One path segment in every spelling a source writes it in: a route `:x`, a template `{x}` or `<x>`, a shell
 *  `${x}` or `$x`, or a literal id. A quote may sit on either side, as a shell's quote-split path leaves it. */
const SEG = String.raw`['"]?(?::[A-Za-z_]\w*|\{[A-Za-z_]\w*\}|<[A-Za-z_][\w-]*>|\$\{[A-Za-z_]\w*\}|\$[A-Za-z_]\w*|[\w.-]+)['"]?`;
const CONTROL_PATH = new RegExp(String.raw`/api/sessions/${SEG}/workflows/${SEG}/control(?![\w-])`);

function tracked(prefix: string): string[] {
  const out = execFileSync('git', ['-C', ROOT, 'ls-files', '-z', '--', prefix], { encoding: 'utf8' });
  return out.split('\0').filter((f) => f !== '');
}

interface RouteRow { readonly verb: string; readonly method: string; readonly path: string }
/** `ccd/ccrc-api`'s route table: `[group.verb]='METHOD|/path|takes-id|flags'`, one row per subcommand. */
function ccrcApiRoutes(): RouteRow[] {
  const src = readFileSync(path.join(ROOT, 'ccd/ccrc-api'), 'utf8');
  return [...src.matchAll(/^\s*\[([a-z][\w-]*\.[a-z][\w-]*)\]='([A-Z]+)\|([^|']+)\|/gm)]
    .map((m) => ({ verb: m[1].replace('.', ' '), method: m[2], path: m[3] }));
}
const composers = (): RouteRow[] => ccrcApiRoutes().filter((r) => CONTROL_PATH.test(r.path));

describe('the matcher reaches every spelling of the path', () => {
  for (const [spelling, text] of [
    [':x', '/api/sessions/:id/workflows/:runId/control'],
    ['{x}', '/api/sessions/{id}/workflows/{run}/control'],
    ['<x>', '/api/sessions/<id>/workflows/<run-id>/control'],
    ['${x}', '"$API/api/sessions/${ID}/workflows/${RUN}/control"'],
    ['$x', '"$API/api/sessions/$ID/workflows/$RUN"/control'],
    ['a literal id', '/api/sessions/project-a/workflows/wf_fixture01/control'],
  ] as const) {
    it(`its ${spelling} spelling row`, () => expect(CONTROL_PATH.test(text), text).toBe(true));
  }
  it('it does not reach the read-only workflows path or a longer verb', () => {
    for (const text of ['/api/sessions/{id}/workflows', '/api/sessions/{id}/workflows/{run}', '/api/sessions/{id}/workflows/{run}/controls']) {
      expect(CONTROL_PATH.test(text), text).toBe(false);
    }
  });
});

describe('no session surface composes the workflow control verb (D-5936)', () => {
  it('no tracked file under `ccd/` names the path shape', () => {
    const named: string[] = [];
    for (const prefix of DENY_LIST) {
      const files = tracked(prefix);
      expect(files.length, `${prefix} is tracked (a rename would empty this census)`).toBeGreaterThan(0);
      for (const f of files) if (CONTROL_PATH.test(readFileSync(path.join(ROOT, f), 'utf8'))) named.push(f);
    }
    expect(named, 'a session-runnable file names the workflow control path').toEqual([]);
  });

  it('`ccd/ccrc-api` has no subcommand that composes it', () => {
    const rows = ccrcApiRoutes();
    expect(rows.length, 'the route table parsed').toBeGreaterThan(20);
    expect(rows.some((r) => r.verb === 'approvals rule'), 'the parser reads a known row').toBe(true);
    expect(composers().map((r) => r.verb)).toEqual([]);
  });

  it('`CHILD_DENY_RULES` needs no row while that holds', () => {
    // The day a `ccrc-api` verb composes the path, this reds until a child deny rule and a classifier row cover it.
    for (const r of composers()) {
      const [group] = r.verb.split(' ');
      expect(CHILD_DENY_RULES.some((rule) => rule.startsWith(`Bash(ccrc-api ${group}`)), `${r.verb}: a deny rule`).toBe(true);
      expect(FORBIDDEN_PATTERNS.some((p) => p.test(`ccrc-api ${r.verb} project-a`)), `${r.verb}: a classifier row`).toBe(true);
    }
    expect(CHILD_DENY_RULES.filter((rule) => /workflow/.test(rule))).toEqual([]);
  });
});
