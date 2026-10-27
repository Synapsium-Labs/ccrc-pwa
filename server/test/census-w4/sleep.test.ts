// ARCH-43's sleep censuses (D-7043), held two ways (`consolidation-census.test.ts`'s discipline): against a FIXTURE
// tree, so each query counts what it claims and passes over what it must not, and against the REAL tree.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { CensusSite } from '../consolidationCensus.js';
import { hibernateActSites, sleepVerdictLadders } from './sleep.js';

const show = (name: string, sites: readonly CensusSite[]): void => {
  console.log(`census ${name}: ${sites.length}\n${sites.map((s) => `  ${s.file}:${s.line}  ${s.text.trim()}`).join('\n')}`);
};

// ARCH-43 (spec K1; plan C4a): the sleep lanes' censuses. REAL rows report and never red (spec §5.1 rule 3); the pins
// are in `single-definition/late-census.test.ts`: `sleepVerdictLadders` since C4b, `hibernateActSites` at C4d.
describe('the sleep lanes\' censuses (ARCH-43)', () => {
  let tree = '';
  const at = (rel: string, body: string): void => {
    const p = path.join(tree, rel);
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, body);
  };
  beforeAll(() => {
    tree = mkdtempSync(path.join(tmpdir(), 'consolidation-census-sleep-'));
    at('server/src/ladderA.ts', [
      'export function decideA(i: In): Out {',
      "  const hold = (r: string): Out => ({ act: 'hold', reason: r });",
      "  if (i.viewer) return hold('viewer');",
      "  if (i.sinceStart < TTL) return hold('viewer');",                          // the same function: one site
      "  return { act: 'go' };",
      '}',
    ].join('\n'));
    at('server/src/coord/ladderB.ts', [
      'export const decideB = (i: In): Out => {',
      "  const hold = (r: string): Out => ({ act: 'hold', reason: r });",
      '  if (i.viewer',
      "    || i.hidden) return hold('viewer');",                                    // a wrapped condition
      "  return { act: 'go' };",
      '};',
    ].join('\n'));
    at('server/src/notLadder.ts', [
      'export function mention(log: (x: unknown) => void): void {',
      "  // return hold('viewer');",                                                // a comment
      `  const why = "return hold('viewer')";`,                                      // a string
      "  log(hold('viewer'));",                                                     // a call not returned
      "  log(hold('mail'));",
      '}',
    ].join('\n'));
    at('server/src/actInline.ts', [
      'export async function actInline(deps: Deps, id: string): Promise<void> {',
      '  // await deps.runCcd(CCD_ARGV.hibernate(id, null));',                       // a comment
      '  await deps.queueRun(id, async () => {',
      '    await deps.runCcd(CCD_ARGV.hibernate(id, sweepDec(deps.fleetState, ACTOR), null));', // inline, in a nested closure
      '  });',
      '}',
    ].join('\n'));
    at('server/src/actBound.ts', [
      'export const actBound = async (port: Port, id: string): Promise<void> => {',
      '  const argv = CCD_ARGV.hibernate(id, sweepDec(port.fleetState, ACTOR));',
      '  if (!verbSupported(port.fleetState, argv)) return;',
      '  await port.runCcd(argv);',                                                  // bound
      '};',
      'export async function actOther(port: Port, id: string): Promise<void> {',
      '  const argv = CCD_ARGV.stop(id);',
      '  await port.runCcd(argv);',                                                  // another verb
      '}',
    ].join('\n'));
    at('server/src/probeOnly.ts', [
      'export function probeOnly(state: FleetState): boolean {',
      "  const argv = CCD_ARGV.hibernate('x', null);",
      "  return verbSupported(state, argv) && ccdCan(state, CCD_ARGV.hibernate('y', null));", // verb probes only
      '}',
    ].join('\n'));
  });
  afterAll(() => { if (tree) rmSync(tree, { recursive: true, force: true }); });

  it('FIXTURE sleepVerdictLadders: a function returning hold(\'viewer\') is one site, however many returns; a comment, a string and an unreturned call are not', () => {
    expect(sleepVerdictLadders(tree).map((s) => s.symbol)).toEqual([
      'server/src/coord/ladderB.ts#decideB', 'server/src/ladderA.ts#decideA',
    ]);
  });

  it('FIXTURE hibernateActSites: both shapes, by top-level function (counted 2, not 3); a verb probe, another verb and a comment are not acts', () => {
    expect(hibernateActSites(tree).map((s) => [s.symbol, s.shape])).toEqual([
      ['server/src/actBound.ts#actBound', 'bound'], ['server/src/actInline.ts#actInline', 'inline'],
    ]);
  });

  it('REAL sleepVerdictLadders: reports the ladders by name (2 -> 1 at C4b; pinned at 1 by late-census since C4b)', () => {
    const sites = sleepVerdictLadders();
    show('sleepVerdictLadders', sites);
    console.log(sites.map((s) => `  ${s.symbol}`).join('\n'));
  });

  it('REAL hibernateActSites: reports the act sites by name and shape (2 -> 1 at C4d; not yet pinned)', () => {
    const sites = hibernateActSites();
    show('hibernateActSites', sites);
    console.log(sites.map((s) => `  ${s.symbol} (${s.shape})`).join('\n'));
  });
});
