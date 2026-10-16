// CCR-15 wave 10 (path-identity spec 2026-10-12 §5.5, §5.9): the executor's final re-read, read as TEXT. These are the
// orderings a type cannot hold:
//   - nothing is awaited from the final listing's answer to the argv, the latch, the reads and the resolution included;
//   - the control and identity reads stand after the job's last await;
//   - the pair's `before` is the epoch the job was queued under, bound from `job.epoch`, never a later read;
//   - the epoch is read before the final listing and again after it;
//   - the latch helper runs after the last await and before the resolution;
//   - the watcher binds the job's epoch outside the queue callback.
// Each scan carries a CONTROL row planted in a string. KNOWN WIDTH, stated: an alias, a helper in another file, or a
// value routed through a table is not seen. The bar is the ordinary composer, as in `collect-lane-scans.test.ts`.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { codeOnly } from './sourceScan.js';

const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const code = (rel: string): string => codeOnly(readFileSync(path.join(srcDir, rel), 'utf8'));
const indicesOf = (text: string, re: RegExp): number[] => [...text.matchAll(new RegExp(re.source, 'g'))].map((m) => m.index!);

/** The top-level function `name`: from its head line (column 0, `export` and `async` allowed) to the first later line
 *  that opens with `}` at column 0, as `collect-lane-scans.test.ts` reads one. Null when the head is not found. */
const topFunction = (text: string, name: string): string | null => {
  const head = new RegExp(`^(?:export\\s+)?(?:async\\s+)?function\\s+${name}\\b`, 'm').exec(text);
  if (head === null) return null;
  const close = /^\}/gm;
  close.lastIndex = head.index;
  const end = close.exec(text);
  return end === null ? null : text.slice(head.index, end.index + 1);
};
/** A class method's code, from its signature to its closing brace at two spaces (`collect-lane-pass.test.ts`'s idiom). */
const methodOf = (text: string, sig: string): string | null => {
  const at = text.indexOf(sig);
  if (at < 0) return null;
  const end = text.indexOf('\n  }\n', at);
  return end < 0 ? null : text.slice(at, end);
};

/** A job's body and its anchors: the one `await collectAudit(` (observation 2), the LAST `await collectSwitches(` (the
 *  final listing) and the start of the statement that composes the argv. Null when one is missing. */
interface Job { readonly body: string; readonly audit: number; readonly lastListing: number; readonly argv: number }
const anchorsOf = (body: string): Job | null => {
  const audits = indicesOf(body, /\bawait\s+collectAudit\s*\(/);
  const listings = indicesOf(body, /\bawait\s+collectSwitches\s*\(/);
  const site = body.indexOf('CCD_ARGV.wsCollect(');
  if (audits.length !== 1 || listings.length === 0 || site < 0) return null;
  const argv = Math.max(body.lastIndexOf(';', site), body.lastIndexOf('{', site), body.lastIndexOf('}', site));
  return { body, audit: audits[0]!, lastListing: listings.at(-1)!, argv };
};
const executor = (): Job => {
  const fn = topFunction(code('coord/collectTempRoot.ts'), 'collectTempRoot');
  expect(fn, 'collectTempRoot is gone').not.toBeNull();
  const j = anchorsOf(fn!);
  expect(j, 'an anchor of collectTempRoot is gone').not.toBeNull();
  return j!;
};

// Each predicate answers null when the order holds, or the reason it does not.
const awaitAfterResolution = (j: Job): string | null => {
  const at = j.body.lastIndexOf('collectLaneEffective(');
  if (at < 0 || at > j.argv) return 'no collectLaneEffective( call before the argv';
  return /\bawait\b/.test(j.body.slice(at, j.argv)) ? 'an await stands between the resolution and the argv' : null;
};
const awaitAfterListing = (j: Job): string | null => {
  const end = j.body.indexOf(';', j.lastListing);
  if (end < 0 || end > j.argv) return 'the final listing’s statement does not end before the argv';
  return /\bawait\b/.test(j.body.slice(end + 1, j.argv)) ? 'an await stands between the final listing and the argv' : null;
};
const readsBeforeListing = (j: Job): string | null => {
  const control = indicesOf(j.body, /\bcollectControlNow\s*\(/);
  const node = indicesOf(j.body, /\.link\.current\s*\(/);
  if (control.length === 0 || node.length === 0) return 'no collectControlNow( or .link.current( call';
  return [...control, ...node].every((i) => i > j.lastListing) ? null : 'a control or identity read stands before the last listing';
};
const pairFromJob = (j: Job): string | null => {
  const binds = [...j.body.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*(?::[^=;]+)?=\s*job\.epoch\s*;/g)];
  if (binds.length !== 1) return `job.epoch is bound ${binds.length} times, not once`;
  if (binds[0]!.index! > j.audit) return 'job.epoch is bound after observation 2’s await';
  const pairs = [...j.body.matchAll(/\{\s*before:\s*([A-Za-z_$][\w$]*)\s*,\s*after:\s*deps\.link\.epochNow\(\)\s*\}/g)];
  if (pairs.length !== 1) return `the epoch pair is spelled ${pairs.length} times, not once`;
  if (pairs[0]![1] !== binds[0]![1]) return `the pair’s before is ${pairs[0]![1]}, not the binding of job.epoch`;
  return pairs[0]!.index! > j.lastListing ? null : 'the pair is taken before the last listing';
};
const epochBracket = (j: Job): string | null => {
  const reads = indicesOf(j.body, /\.link\.epochNow\s*\(/);
  if (!reads.some((i) => i > j.audit && i < j.lastListing)) return 'no epoch read before the final listing’s await';
  return reads.some((i) => i > j.lastListing && i < j.argv) ? null : 'no epoch read after the final listing';
};
const latchBeforeResolution = (j: Job): string | null => {
  const latch = indicesOf(j.body, /\bcollectRetireLatch\s*\(/);
  if (latch.length !== 1) return `collectRetireLatch( is called ${latch.length} times, not once`;
  if (latch[0]! < j.lastListing) return 'the latch runs before the last listing';
  if (/\bcollectLaneEffective\s*\(/.test(j.body.slice(j.lastListing, latch[0]))) return 'the switch is resolved before the latch runs';
  return j.body.indexOf('collectLaneEffective(', latch[0]) > latch[0]! ? null : 'no resolution follows the latch';
};
const epochOutsideCallback = (method: string): string | null => {
  const run = method.indexOf('this.deps.queue.run(');
  if (run < 0) return 'no queue.run( in collectAct';
  const bind = /\bconst\s+epoch\s*=/.exec(method);
  if (bind === null || bind.index > run) return 'the job’s epoch is not bound before the queue callback';
  const tail = method.slice(run);
  if (!/\{\s*id\s*,\s*epoch\s*\}\s*\)\s*\)/.test(tail)) return 'the job is not queued as { id, epoch }';
  return /epochNow\s*\(/.test(tail) ? 'an epoch read stands inside the queue callback' : null;
};

const GOOD = [
  'export async function collectTempRoot(deps: D, job: J): Promise<O> {',
  '  const queuedUnder = job.epoch;',
  '  const first = await collectSwitches(deps.io, deps.cfg.registryDir);',
  '  const asked = await collectAudit(deps, job.id);',
  '  const listedUnder = deps.link.epochNow();',
  '  const last = await collectSwitches(deps.io, deps.cfg.registryDir);',
  '  const epoch = { before: queuedUnder, after: deps.link.epochNow() };',
  '  collectRetireLatch(deps.control, last, epoch);',
  '  const lane = collectLaneEffective({ switches: last, epoch, control: collectControlNow(deps.control).control, node: deps.link.current() });',
  '  if (!collectLaneLive(lane)) return { kind: listedUnder };',
  '  const now = deps.lane.clock();',
  '  act = await deps.runCcd(CCD_ARGV.wsCollect(obs2.token, job.id, d));',
  '}',
  '',
].join('\n');
const planted = (text: string): Job => {
  const j = anchorsOf(text);
  expect(j, 'CONTROL: the planted job has its anchors').not.toBeNull();
  return j!;
};

describe('nothing awaits between the final reads and the argv (§5.5, §5.9)', () => {
  it('no await stands between the last collectLaneEffective( and CCD_ARGV.wsCollect(', () => {
    expect(awaitAfterResolution(planted(GOOD)), 'CONTROL: the planted job passes').toBeNull();
    expect(awaitAfterResolution(planted(GOOD.replace('  const now = deps.lane.clock();',
      '  await Promise.resolve();\n  const now = deps.lane.clock();'))), 'CONTROL: an inserted await is seen').not.toBeNull();
    expect(awaitAfterResolution(executor())).toBeNull();
  });

  it('no await stands between the final listing’s answer and CCD_ARGV.wsCollect(: the latch, the reads and the resolution included', () => {
    const early = GOOD.replace('  const epoch = { before: queuedUnder', '  await Promise.resolve();\n  const epoch = { before: queuedUnder');
    expect(awaitAfterListing(planted(GOOD)), 'CONTROL: the planted job passes').toBeNull();
    expect(awaitAfterListing(planted(early)), 'CONTROL: an await before the latch is seen').not.toBeNull();
    expect(awaitAfterResolution(planted(early)), 'CONTROL: the resolution-to-argv scan alone cannot see it').toBeNull();
    expect(awaitAfterListing(executor())).toBeNull();
  });

  it('every collectControlNow( and .link.current( in collectTempRoot follows the last await collectSwitches(', () => {
    expect(readsBeforeListing(planted(GOOD)), 'CONTROL: the planted job passes').toBeNull();
    expect(readsBeforeListing(planted(GOOD.replace('  const listedUnder',
      '  const early = collectControlNow(deps.control);\n  const listedUnder'))), 'CONTROL: a hoisted read is seen').not.toBeNull();
    expect(readsBeforeListing(executor())).toBeNull();
  });

  it('the pair’s before is bound from job.epoch before await collectAudit(', () => {
    expect(pairFromJob(planted(GOOD)), 'CONTROL: the planted job passes').toBeNull();
    expect(pairFromJob(planted(GOOD.replace('before: queuedUnder', 'before: listedUnder'))),
      'CONTROL: a pair taken from the listing’s epoch is seen').not.toBeNull();
    expect(pairFromJob(executor())).toBeNull();
  });

  it('.link.epochNow( stands before the final listing’s await and again after it', () => {
    expect(epochBracket(planted(GOOD)), 'CONTROL: the planted job passes').toBeNull();
    expect(epochBracket(planted(GOOD.replace('  const listedUnder = deps.link.epochNow();\n', ''))),
      'CONTROL: a missing read before the listing is seen').not.toBeNull();
    expect(epochBracket(executor())).toBeNull();
  });

  it('collectRetireLatch( follows the last await and precedes collectLaneEffective(', () => {
    expect(latchBeforeResolution(planted(GOOD)), 'CONTROL: the planted job passes').toBeNull();
    const late = GOOD.replace('  collectRetireLatch(deps.control, last, epoch);\n', '')
      .replace('  if (!collectLaneLive', '  collectRetireLatch(deps.control, last, epoch);\n  if (!collectLaneLive');
    expect(latchBeforeResolution(planted(late)), 'CONTROL: a latch after the resolution is seen').not.toBeNull();
    expect(latchBeforeResolution(executor())).toBeNull();
  });
});

describe('the watcher queues the job with the epoch it stands under (path-identity spec §5.5)', () => {
  const ACT_GOOD = [
    '  private collectAct(coord: CoordStore, id: string, pass: number, mono: number): void {',
    '    const epoch = (this.deps.fleetIdentity ?? NO_FLEET_IDENTITY).epochNow();',
    '    void this.deps.queue.run(id, () => collectTempRoot({ coord }, { id, epoch }))',
    '      .finally(() => { this.collectSettled(id, pass); });',
    '  }',
    '',
  ].join('\n');

  it('collectAct binds the job’s epoch outside the queue callback', () => {
    const sig = '  private collectAct(';
    expect(epochOutsideCallback(methodOf(ACT_GOOD, sig)!), 'CONTROL: the planted method passes').toBeNull();
    const inside = ACT_GOOD.replace('    const epoch = (this.deps.fleetIdentity ?? NO_FLEET_IDENTITY).epochNow();\n', '')
      .replace('{ id, epoch }', '{ id, epoch: (this.deps.fleetIdentity ?? NO_FLEET_IDENTITY).epochNow() }');
    expect(epochOutsideCallback(methodOf(inside, sig)!), 'CONTROL: an epoch read inside the callback is seen').not.toBeNull();
    const method = methodOf(code('watch.ts'), sig);
    expect(method, 'collectAct is gone').not.toBeNull();
    expect(epochOutsideCallback(method!)).toBeNull();
  });
});
