// Child reclamation wave 10 (path-identity spec 2026-10-12 §5): what the operator documents say about the temp-root
// collector's switch in Settings. The lane has two arms, then one: the legacy file until its journaled retirement, and
// Settings for the fleet node measured on the current connection. These rows pin the sentences that say so, the
// whole-state restore boundary, the two as-built notes and the CCR-15 spec's wave 10 paragraph and row, CLAUDE.md's
// coord.db bullet, and the two carried retitles (inventory items 38 and 40). Wave 9's `collect-lane-prose.test.ts` keeps
// its pins and is run, never edited. The marker's name and the journal's basename are imported from their definers, so
// this file is a second holder of neither spelling.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { COLLECT_LANE_LIVE_MARKER } from '../src/collectLane.js';
import { COLLECT_LANE_JOURNAL_BASENAME } from '../src/coord/collectLaneJournal.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (f: string): string => readFileSync(path.join(root, f), 'utf8');
/** Hard-wrapped prose read as one line, so a re-wrap never reds a row. */
const flat = (s: string): string => s.replace(/\s+/g, ' ');
/** A comment or docstring read as prose: each continuation line's `//` or `*` leader dropped, then flattened. */
const prose = (s: string): string => flat(s.replace(/\n[ \t]*(?:\/\/|\*)[ \t]?/g, ' '));
/** The text from `from` up to the next `to`, both asserted present, so a match elsewhere cannot satisfy a row. */
const between = (name: string, text: string, from: string, to: string): string => {
  const a = text.indexOf(from);
  expect(a, `${name}: the opening anchor is gone`).toBeGreaterThan(-1);
  const b = text.indexOf(to, a + from.length);
  expect(b, `${name}: the closing anchor is gone`).toBeGreaterThan(a);
  return text.slice(a, b);
};

const MARKER = `\`$REG/${COLLECT_LANE_LIVE_MARKER}\``;
const JOURNAL = `\`~/.ccrc/${COLLECT_LANE_JOURNAL_BASENAME}\``;
const PI_SPEC = 'docs/superpowers/specs/2026-10-12-path-identity-design.md';
const CCR_SPEC = 'docs/superpowers/specs/2026-09-22-child-workspace-reclamation-design.md';
const CONTRACT = 'docs/superpowers/programs/child-reclamation-contract.md';
const LEAVING = 'server/test/collect-lane-leaving.test.ts';
/** A deviation number. No note of this wave carries one: the coordinator assigns them. */
const DEVIATION = /\bD-\d/;

describe("the switch's prose is true (path-identity spec §5)", () => {
  const README = read('README.md');
  const switchBlock = (): string => flat(between('README, the switch', README,
    '**The switch in Settings (child reclamation wave 10).**', "**Reclaim's tail, corrected in wave 7"));

  it('README names the Settings arm, the four hand steps, the latch and the ignored re-created file', () => {
    const s = switchBlock();
    expect(s).toContain('**The switch in Settings (child reclamation wave 10).** The lane now has two arms, then one.');
    expect(s).toContain(`- the legacy file ${MARKER} stands and its retirement has not been recorded;`);
    expect(s).toContain('- Settings (**Temp root collector**) stores exactly Live for the fleet node the server measured on '
      + 'its current connection to the fleet box');
    expect(s).toContain('so a move from the file to Settings while both arm writes no row and keeps every pair');
    expect(s).toContain(`first appends one generation to ${JOURNAL}`);
    for (const step of [
      '1. Deploy a build with the switch.',
      '2. In Settings, confirm Live for the fleet node the server is connected to.',
      `3. Remove ${MARKER} by hand on the fleet box. That act is the operator's, never a session's.`,
      '4. The next registry listing that is coherent, unpaused and on the same connection proves the file absent, and the '
        + 'server records its retirement through the journal, with one feed row. From then on Settings alone arms the lane.',
    ]) expect(s, step).toContain(step);
    expect(s).toContain('After the retirement, a re-created file is reported and ignored.');
    expect(s).toContain('**Off is refused before the retirement** (`409 marker-still-controls`)');
    expect(s).toContain('Live is refused while sign-in is dark (`403 sign-in-unarmed`).');

    const settings = flat(between('README, the Settings paragraph', README,
      '**Settings, the update banner and release pushes', 'In remote mode the foot'));
    const lead = 'Settings then has a further section, **Temp root collector**';
    expect(settings.indexOf(lead), 'the section follows Stall watch')
      .toBeGreaterThan(settings.indexOf('Settings then has a further section, **Stall watch**'));
    expect(settings).toContain('(child-reclamation wave 10), read and written through `/api/coord/collect-lane` by a poll of its own.');
    expect(settings).toContain('It shows only what the server decided and counts nothing itself');
    expect(settings).toContain('**Pause all cleanup**, which stops child reclamation, archived-workspace expiry, the '
      + 'dead-coordinator lane and this collector; Resume stays on `/runs`.');
    expect(settings).toContain('A server without the route shows "Not available on this server."');

    expect(flat(README)).toContain(`or by ${MARKER} until that file's retirement is recorded |`);
  });

  it('README states the whole-state restore boundary and leaves the journal in place', () => {
    const s = switchBlock();
    expect(s).toContain(`but no backup copies \`${COLLECT_LANE_JOURNAL_BASENAME}\`, and no restore, rollback or watchdog `
      + 'moves it: leave it in place when you put a `coord.db` snapshot back.');
    expect(s).toContain("A database restored alone from before the switch's last change then disagrees with the journal "
      + 'and is safety-stopped, so an older snapshot cannot arm the collector again.');
    expect(s).toContain('A restore that rolls both files back together, a whole home or a whole file system, is outside '
      + 'this proof: after one, raise the cleanup pause and make a fresh confirmed change in Settings before allowing Live.');
    const deploy = flat(between('README, the Deploy backup paragraph', README,
      'Never restore one half of `ccd` alone', '## Live end-to-end tests'));
    expect(deploy).toContain(`\`coord.db\`. Leave ${JOURNAL} in place when you put that snapshot back: no backup copies `
      + "it, and a `coord.db` restored alone from before the switch's last change then disagrees with it, so the temp-root "
      + 'collector stays safety-stopped until a fresh change in Settings.');
  });

  it('README no longer says removing the file always shadows it', () => {
    const readme = flat(README);
    expect(readme).not.toContain('Removing the file shadows it again.');
    expect(readme).toContain('Wave 10 adds an arm in Settings and then retires this file (below); until that retirement, '
      + 'removing the file shadows the lane again unless Settings arms it.');
  });

  it("CLAUDE.md's coord.db bullet names the switch and the journal clause", () => {
    const bullet = flat(between('CLAUDE.md, the coord.db bullet', read('CLAUDE.md'),
      '- `~/.ccrc/coord.db`:', '- **Zero new ccd verbs'));
    expect(bullet).toContain('update intents, the stall-watch settings choice, the collector switch — is gone without the snapshot');
    expect(bullet).toContain(`The switch's \`${COLLECT_LANE_JOURNAL_BASENAME}\` is never copied into a snapshot or restored `
      + "with one: leave it in place, so a database restored alone never re-arms the collector (one from before the switch's "
      + 'last change is safety-stopped).');
  });

  it('the path-identity spec carries §5 as built', () => {
    const spec = read(PI_SPEC);
    const heading = '### §5 as built (CCR-15 wave 10, run 400)';
    expect(spec.indexOf('### 5.9 Proof'), 'the note sits after §5.9').toBeLessThan(spec.indexOf(heading));
    const note = flat(between('the path-identity spec, §5 as built', spec, heading, '## 6. The waves'));
    expect(note).not.toMatch(DEVIATION);
    expect(note).toContain('Inventory items 38, 40 and 41 shipped in this wave.');
    expect(note).toContain('A stored Live while the current node is unmeasured or in collision is stopped as an unknown '
      + 'fleet, never shadowed');
    expect(note).toContain('Only a control state that cannot be proved coherent is safety-stopped');
    expect(note).toContain("An act job carries the epoch its lane's pairs stand under, captured when the job is queued.");
    expect(note).toContain('So a stored Live on an unknown node still retires a removed file.');
    expect(note).toContain("the 409's facts carry neither the nonce nor the epoch");
    expect(note).toContain("An Off accepted after an act's argv was handed to ccd cannot stop that act.");
    expect(note).toContain('`marker-removal-after-the-last-listing-still-composes`');
    expect(note).toContain('`pre-latch-snapshot-repair-readopts-an-unset-latch`');
    expect(note).toContain('**Departures found while building.**');
  });

  it('the contract carries §17 as built', () => {
    const c = read(CONTRACT);
    const heading = '### §17 as built (wave 10, run 400)';
    expect(c.indexOf('- **R98 — corrections.**'), 'the note follows R98').toBeGreaterThan(-1);
    expect(c.indexOf(heading), 'the note follows R98').toBeGreaterThan(c.indexOf('- **R98 — corrections.**'));
    // The note ends at the next `##`/`###` heading, so a following note's text cannot satisfy it.
    const at = c.indexOf(heading);
    const next = c.slice(at + 1).search(/\n#{2,3} /);
    const note = flat(c.slice(at, next < 0 ? c.length : at + 1 + next));
    expect(note).not.toMatch(DEVIATION);
    expect(note).toContain('**R96 (two arms, then one), reconciled before the build.**');
    expect(note).toContain('A stored Live while the current node is unmeasured or in collision is stopped as an unknown '
      + 'fleet, never shadowed');
    expect(note).toContain("An Off accepted after an act's argv was handed to ccd cannot stop that act.");
    expect(note).toContain('`marker-removal-after-the-last-listing-still-composes`');
    expect(note).toContain('`pre-latch-snapshot-repair-readopts-an-unset-latch`');
    expect(note).toContain('**Departures found while building.**');
  });

  it('the CCR-15 spec carries wave 10 in §5.10 and in §8', () => {
    const s = flat(read(CCR_SPEC));
    const para = '**The Settings switch (wave 10), as built.** Wave 10 gives the lane two arms, then one';
    expect(s).toContain(para);
    expect(s.indexOf(para), 'the paragraph sits in §5.10').toBeLessThan(s.indexOf('## 6. What this changes outside itself'));
    expect(s).toContain('The lane flips on the effective boolean, never on its source');
    expect(s).toContain('| 10 | server + pwa | the collector switch in Settings, as built:');
    expect(s).toContain("Wave 10 changes what arms the collector's deletion, so it is reviewed for safety too");
  });

  it('the item-40 sites say rebuilt and no longer latest change', () => {
    const leaving = read(LEAVING);
    const sites: readonly (readonly [string, string])[] = [
      ["collectLane.ts, collectBoxProbesAtArrival's docstring", prose(between('collectLane.ts', read('server/src/collectLane.ts'),
        '/** The box-wide probes after one answer, by when it ARRIVED', 'export function collectBoxProbesAtArrival('))],
      ["watch.ts, the collector's arrival comment", prose(between('watch.ts', read('server/src/watch.ts'),
        '/** Folds one AUDIT answer (spec §5.10).', '*/'))],
      ['collect-lane-leaving, the header comment', prose(between(LEAVING, leaving,
        '// Child reclamation wave 9 (spec §5.10)', '\nimport '))],
      ['collect-lane-leaving, the describe title', leaving.split('\n').find((l) => l.startsWith("describe('an answer ")) ?? ''],
    ];
    for (const [name, text] of sites) {
      expect(text, `${name}: the site is gone`).not.toBe('');
      expect(text, name).toContain('rebuilt');
      expect(text, name).not.toContain('latest change');
    }
  });

  it('the item-38 title says ahead of the forgotten-id return', () => {
    const leaving = read(LEAVING);
    expect(leaving).toContain("the act’s answer counts for the box ahead of the forgotten-id return', async () => {");
    expect(leaving).not.toContain('before its id is looked up');
  });
});
