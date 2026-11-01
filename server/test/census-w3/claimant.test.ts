// The claimant client's census, held two ways (D-7320; K5 tail, Task Q3h; plan
// 2026-10-29-consolidation-k5-claimant-doors.md, §The census files): against a FIXTURE tree, so each query counts what
// it claims and passes over what it must not, and against the REAL tree, so it prints the sites the plan cites. Every
// query REPORTS: the base counts are what the PR body prints, and no REAL row reds before its series starts (spec
// §5.1 rule 3). The REAL rows hold only what is true at every step of the series.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { CensusSite } from '../consolidationCensus.js';
import { clientRoutes } from '../ccrcApiTable.js';
import { REGIONS } from '../../../shared/hook-helpers.mjs';
import {
  capReaderCalls, capReaderDefinitions, clientClaimantRows, clientOldOnlyRows, OLD_CLAIMANT_DOORS, serverClaimantDoors,
} from './claimant.js';
import { questionDoors } from './questions.js';

const show = (name: string, sites: readonly CensusSite[]): void => {
  console.log(`census ${name}: ${sites.length}\n${sites.map((s) => `  ${s.file}:${s.line}  ${s.text.trim()}`).join('\n')}`);
};

const trees: string[] = [];
afterEach(() => { for (const t of trees.splice(0)) rmSync(t, { recursive: true, force: true }); });
const tree = (files: Record<string, string>): string => {
  const t = mkdtempSync(path.join(tmpdir(), 'k5-claimant-census-'));
  trees.push(t);
  for (const [rel, body] of Object.entries(files)) {
    const p = path.join(t, rel);
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, body);
  }
  return t;
};

/** A client table in the client's grammar: the four claimant rows (one with a family column), the two reads, the
 *  hook's ruling row, and a commented-out row. */
const CLIENT_TABLE = [
  '#!/usr/bin/env bash',
  'declare -A ROUTES=(',
  "  [asks.list]='GET|/api/asks|no|parent'",
  "  [asks.answer]='POST|/api/asks/{id}/answer|yes|-'",
  "  [asks.release]='POST|/api/asks/{id}/release|yes|-|/api/questions/ask-{id}/release'",
  '  # A commented row is not a row:',
  "  # [approvals.old]='POST|/api/approvals/{id}/rule|yes|-'",
  "  [approvals.ruling]='GET|/api/approvals/{id}/ruling|yes|nonce'",
  "  [approvals.rule]='POST|/api/approvals/{id}/rule|yes|-'",
  "  [approvals.release]='POST|/api/approvals/{id}/release|yes|-'",
  "  [approvals.show]='GET|/api/approvals/{id}|yes|-'",
  ')',
  '',
].join('\n');

const READER = [
  '_hook_server_cap() {   # <word> -> 0 advertised and current; 1 otherwise',
  '  local want="$1" l1=""',
  '  [[ " ${l1#caps} " == *" $want "* ]]',
  '}',
].join('\n');
const HOOK_SRC = `#!/usr/bin/env bash\n${READER}\n_hook_server_cap hook-main-state-v1 && hms=1\n`;
/** Q3i's copy's name line, spelled through a template: no shipped script defines it yet, so a literal would read as a
 *  stub of a function nothing ships (`ccd-harness-integrity.test.ts`, D-6051). */
const API_CAP = '_api_server_cap';
const nameLine = (name: string, rest = ''): string => `${name}() {${rest}`;
const [REGION] = REGIONS;

describe('the claimant client census (D-7320)', () => {
  it('FIXTURE: a commented row is not a row', () => {
    expect(clientRoutes(CLIENT_TABLE).map((r) => r.key)).toEqual([
      'asks.list', 'asks.answer', 'asks.release', 'approvals.ruling', 'approvals.rule', 'approvals.release', 'approvals.show',
    ]);
    expect(clientRoutes(CLIENT_TABLE).find((r) => r.key === 'asks.release')).toEqual({
      key: 'asks.release', method: 'POST', path: '/api/asks/{id}/release', needsId: true, query: [],
      family: '/api/questions/ask-{id}/release', line: 5,
    });
    expect(clientRoutes(CLIENT_TABLE).find((r) => r.key === 'approvals.ruling')?.query).toEqual(['nonce']);
    expect(() => clientRoutes(CLIENT_TABLE.replace("  [asks.list]='GET|/api/asks|no|parent'", '  asks.list=GET'))).toThrow(/not a ROUTES row/);
  });

  it('FIXTURE: claimant rows are the four old doors; the reads and the ruling are never counted; a family row is not old-only', () => {
    const t = tree({ 'ccd/ccrc-api': CLIENT_TABLE });
    expect(clientClaimantRows(t).map((r) => r.key)).toEqual(['asks.answer', 'asks.release', 'approvals.rule', 'approvals.release']);
    expect(clientOldOnlyRows(t).map((r) => r.key)).toEqual(['asks.answer', 'approvals.rule', 'approvals.release']);
    expect(clientClaimantRows(t)[0]).toMatchObject({ file: 'ccd/ccrc-api', line: 4, text: "  [asks.answer]='POST|/api/asks/{id}/answer|yes|-'" });
    expect(OLD_CLAIMANT_DOORS).not.toContain('/api/approvals/{id}/ruling');
  });

  it('FIXTURE: a copy inside a region is generated; a copy with one byte changed is no match', () => {
    const t = tree({
      'ccd/session-hook.sh': HOOK_SRC,
      'ccd/ccrc-api': [
        '#!/usr/bin/env bash',
        REGION!.begin,
        READER.replace('_hook_server_cap() {   # <word> -> 0 advertised and current; 1 otherwise', nameLine(API_CAP, '   # another name line')),
        REGION!.end,
        READER.replace('_hook_server_cap', '_api_near_copy').replace('local want="$1"', 'local want="$2"'),
        '',
      ].join('\n'),
      'ccd/lib/other.sh': `${READER.replace('_hook_server_cap', '_other_server_cap')}\n`,
    });
    expect(capReaderDefinitions(t).map((s) => `${s.file}#${s.name} ${s.kind} ${s.line}`)).toEqual([
      'ccd/ccrc-api#_api_server_cap generated 3',
      'ccd/lib/other.sh#_other_server_cap hand 1',
      'ccd/session-hook.sh#_hook_server_cap hand 2',
    ]);
  });

  it('FIXTURE: a call before the claimant test is unguarded; the definition inside the region and a comment are not calls', () => {
    const t = tree({
      'ccd/ccrc-api': [
        '#!/usr/bin/env bash',
        REGION!.begin,
        nameLine(API_CAP),
        '  _api_server_cap nested-inside-the-region',
        '}',
        REGION!.end,
        '# _api_server_cap questions-v1 is read only for a claimant row',
        'if [[ -n "$claimant" ]] && _api_server_cap questions-v1; then path="$claimant"; fi',
        'if _api_server_cap questions-v1 && [[ -n "$claimant" ]]; then :; fi',
        'if _api_server_cap questions-v1; then :; fi',
        '',
      ].join('\n'),
    });
    expect(capReaderCalls(t).map((s) => [s.line, s.guarded])).toEqual([[8, true], [9, false], [10, false]]);
  });

  it('REAL: every count the plan cites, printed for the PR body', () => {
    const claimant = clientClaimantRows();
    const oldOnly = clientOldOnlyRows();
    const defs = capReaderDefinitions();
    const calls = capReaderCalls();
    const server = serverClaimantDoors();
    show('clientClaimantRows', claimant);
    show('clientOldOnlyRows', oldOnly);
    show('capReaderDefinitions (hand)', defs.filter((s) => s.kind === 'hand'));
    show('capReaderDefinitions (generated)', defs.filter((s) => s.kind === 'generated'));
    show('capReaderCalls (guarded)', calls.filter((s) => s.guarded));
    show('capReaderCalls (unguarded)', calls.filter((s) => !s.guarded));
    show('serverClaimantDoors', server);
    console.log(`census serverClaimantDoors by name: ${server.map((s) => s.route).join(', ')}`);
    // True at every step of the series: the claimant rows are the four claimant verbs (4 -> 0 at Q3l), the hook's
    // reader is the one hand-written copy, no cap-reader call is unguarded, every claimant door is a POST.
    for (const r of claimant) expect(['asks.answer', 'asks.release', 'approvals.rule', 'approvals.release'], r.key).toContain(r.key);
    expect(defs.filter((s) => s.kind === 'hand').map((s) => `${s.file}#${s.name}`), 'the hand-written cap reader').toEqual(['ccd/session-hook.sh#_hook_server_cap']);
    expect(calls.filter((s) => !s.guarded), 'a cap-reader call no $claimant test guards').toEqual([]);
    for (const d of server) expect(d.route, 'a claimant door').toMatch(/^POST \/api\//);
  });

  // THE RATCHETS (spec §5.1 rule 3), each landed in the commit that reaches its count: Q3j's behaviour commit gives the
  // four claimant rows their family column and makes the one guarded call of the cap reader.
  it('REAL, pinned since Q3j: client rows whose only door is the old one: exactly 0 (D-7322)', () => {
    expect(clientOldOnlyRows().map((r) => r.key)).toEqual([]);
  });
  // Q3l's behaviour commit gives the four claimant rows the family's template as their path (D-7324).
  it('REAL, pinned since Q3l: client rows on an old claimant door: exactly 0 (D-7324)', () => {
    expect(clientClaimantRows().map((r) => r.key)).toEqual([]);
  });
  // Q3l's last alias deletion leaves the family's two: 6 -> 2 (D-7324). A door-shaped POST whose tag row Q3l removed
  // reads `untagged`, not `claimant`, so the row also counts every door that is not the operator's or navigation: an
  // alias left registered is a third door here, whatever its tag.
  it('REAL, pinned since Q3l: claimant doors: exactly 2, the family\'s rule and release (D-7324)', () => {
    const FAMILY = ['POST /api/questions/:id/rule', 'POST /api/questions/:id/release'];
    expect(serverClaimantDoors().map((d) => d.route)).toEqual(FAMILY);
    expect(questionDoors().filter((d) => d.tag !== 'operator' && d.tag !== 'navigation').map((d) => `${d.route} ${d.tag}`))
      .toEqual(FAMILY.map((r) => `${r} claimant`));
  });
  // Q3l re-pointed the guard from `$family` (the fifth field it removed) to `$claimant`, the row test it wrote (D-7324;
  // named exception): still one call, for the four claimant rows only.
  it('REAL, pinned since Q3j: cap-reader calls in ccrc-api: exactly 1, guarded by the $claimant test before it (D-7322, D-7324)', () => {
    expect(capReaderCalls().map((s) => [s.guarded, s.text.trim()])).toEqual([
      [true, 'if [[ -n "$claimant" ]] && _api_server_cap "$want"; then'],
    ]);
  });
});
