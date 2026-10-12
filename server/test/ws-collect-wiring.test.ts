// The collector's server and agent wiring (child reclamation spec 2026-09-22 §5.10, §8's waves 7 and 9). The agent grants
// `ws-collect` on its confirmation token and nothing else new: `ws-audit --collect` rides the existing
// `['ws-audit','--session']` prefix. `CCD_ARGV` declares the two builders and `COLLECT_CAP`, and wave 9's lane is their ONE
// composer, behind `capSupported(COLLECT_CAP)` (`verb-gate.test.ts`'s `CAP_GATED_VERBS` entry for `ws-collect`). The lane
// ships shadowed behind `$REG/collect-lane-live`. The ONE LANE case below names the lane's files as the only holders, and
// keeps the verb and its mode flag spelled exactly where wave 7 put them.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXEC_WHITELIST, REQUIRED_VERB_FLAG, UNGRANTABLE_VERBS, isExecAllowed } from '../../agent/src/whitelist.js';
import { CCD_ARGV, COLLECT_CAP } from '../src/ccdargv.js';
import type { CollectToken } from '../../shared/api.js';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const TOKEN = 'a'.repeat(64) as CollectToken;
const ID = 'demo-quiet-dune';

describe('the agent grant — ws-collect on its confirmation token, the audit on the existing prefix', () => {
  it('ws-collect is grantable ONLY with --expect, and enrolled so a bare grant can neither compile nor boot', () => {
    expect(EXEC_WHITELIST.ccd.filter((p) => p[0] === 'ws-collect'), 'exactly one grant, on its token')
      .toEqual([['ws-collect', '--expect']]);
    expect((REQUIRED_VERB_FLAG as Readonly<Record<string, string>>)['ws-collect']).toBe('--expect');
    expect(isExecAllowed('ccd', ['ws-collect'])).toBe(false);
    expect(isExecAllowed('ccd', ['ws-collect', '--session', ID])).toBe(false);
    expect(isExecAllowed('ccd', [...CCD_ARGV.wsCollect(TOKEN, ID, null)])).toBe(true);
    expect(isExecAllowed('ccd', [...CCD_ARGV.wsCollect(TOKEN, ID, { surface: 'agent', actor: 'collect sweep', reason: null })])).toBe(true);
    expect(UNGRANTABLE_VERBS as readonly string[], 'it has a lawful grantable form').not.toContain('ws-collect');
  });

  it('ws-audit --collect needs NO grant of its own: the one ws-audit grant is the one it always was', () => {
    expect(EXEC_WHITELIST.ccd.filter((p) => p[0] === 'ws-audit')).toEqual([['ws-audit', '--session']]);
    expect(isExecAllowed('ccd', [...CCD_ARGV.wsCollectAudit(ID)])).toBe(true);
  });
});

describe('the builders — the exact argv, the confirmation token leading', () => {
  it('wsCollectAudit and wsCollect build exactly what ccd parses, and the token is the one ccd echoes', () => {
    expect(CCD_ARGV.wsCollectAudit(ID)).toEqual(['ws-audit', '--session', ID, '--collect']);
    expect(CCD_ARGV.wsCollect(TOKEN, ID, null)).toEqual(['ws-collect', '--expect', TOKEN, '--session', ID]);
    expect(COLLECT_CAP).toBe('collect-v1');
  });
});

describe('ONE LANE — the collector’s lane is the only server source that composes the collector', () => {
  /** Whole-line and trailing `// ` comments dropped (whitelist-subset layer 4's cut), so prose naming a builder is
   *  never read as a call. An alias (`const A = CCD_ARGV`) or a table lookup is invisible to this scan, as it is to
   *  `verb-gate.test.ts`'s; it catches the honest composer, not someone routing around it. */
  const code = (src: string): string => src.split('\n').filter((l) => !/^\s*(?:\/\/|\/\*|\*)/.test(l))
    .map((l) => l.replace(/\s\/\/.*$/, '')).join('\n');
  const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith('.ts') ? [path.join(dir, e.name)] : []);
  const files = (): string[] => walk(SRC).map((f) => path.relative(SRC, f).split(path.sep).join('/')).sort();
  const holders = (re: RegExp): string[] =>
    files().filter((f) => re.test(code(fs.readFileSync(path.join(SRC, f), 'utf8'))));

  it('CONTROL: the walk reaches subdirectories and the comment cut keeps code — ws-expire has its one composer', () => {
    expect(files().length, 'the walk read server/src').toBeGreaterThan(50);
    expect(holders(/\bCCD_ARGV\s*\.\s*wsExpire\s*\(/)).toEqual(['coord/expireArchived.ts']);
  });

  it('the builders and the token are named only where declared and by the lane’s files; the verb and its mode flag stand where they were', () => {
    expect(holders(/\bwsCollect(?:Audit)?\b/), 'a reference to either builder: the declaration, and the lane’s executor').toEqual(['ccdargv.ts', 'coord/collectTempRoot.ts']);
    expect(holders(/['"`]ws-collect['"`]/), 'the verb as a literal: the builder, and the budget row').toEqual(['ccdargv.ts', 'remote/runner.ts']);
    expect(holders(/['"`]--collect['"`]/), 'the audit mode flag').toEqual(['ccdargv.ts']);
    expect(holders(/\bCOLLECT_CAP\b|['"`]collect-v1['"`]/), 'the capability token: declared, and asked by the executor and by the pass').toEqual(['ccdargv.ts', 'coord/collectTempRoot.ts', 'watch.ts']);
  });
});
