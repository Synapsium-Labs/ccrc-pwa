// Every box frame fixture in the tree is reduced and clean (Desktop polish wave 187; plan
// docs/superpowers/plans/2026-11-26-box-frames-recipe.md section 5.4): the last check, not the only one. A session writes a
// fixture from the one read's reduced frame (`shared/framesFixture.ts`); this case reads every `*-frame-*.ansi` under the
// panes' box directory and holds each to its header and name, and to the reducer's own check (`checkReducedFrame`, with the
// committed private-name scan). The tree ratchets (`topology-clean`, `private-names`) scan every tracked file besides.
// The directory holds none today, so the tree case passes vacuously; the planted cases prove the checker reds.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CANARY } from '../../shared/private-names.mjs';
import { framesScan } from '../../shared/framesScan.mjs';
import { framesOurs } from '../../shared/framesCapture.js';
import { frameFixtureName, frameFixtureOf, readFrameFixture } from '../../shared/framesFixture.js';
import { checkReducedFrame } from '../../shared/framesReduce.js';
import { FRAMES_PARTS, framesPartOfId } from '../../shared/framesResult.js';
import { mkTmp, removeTmpFixturesEachTest } from './tmpHelpers.js';

removeTmpFixturesEachTest();

const BOX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'panes', 'box');

/** What is wrong with each frame fixture in `dir`, one line each; `[]` when all hold. */
function fixtureFindings(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).filter((f) => /-frame-.*\.ansi$/.test(f))) {
    const fx = readFrameFixture(readFileSync(path.join(dir, name), 'utf8'));
    if (fx === null) { out.push(`${name}: no header on the grammar`); continue; }
    if (frameFixtureName(fx.build, fx.part) !== name) { out.push(`${name}: the name is not its header's`); continue; }
    const p = FRAMES_PARTS[fx.part]!;
    const check = checkReducedFrame(fx.text, p.pane, framesOurs(p.case, p.pane), framesScan);
    if (!check.ok) out.push(`${name}: ${check.refusal}`);
  }
  return out;
}

const RULE = '─'.repeat(60);
const part = framesPartOfId('rows-3@220x50')!;
const clean = frameFixtureOf('2.1.332', 'rows-3@220x50', '0123456789abcdef', [RULE, '❯ frames row 001 of 003 abcdefghij', RULE, '  ? for shortcuts'].join('\n') + '\n');

describe('the box frame fixtures in the tree', () => {
  it('every one is reduced and clean, under its own name and header', () => {
    expect(fixtureFindings(BOX)).toEqual([]);
  });
});

describe('the checker reds (planted fixtures)', () => {
  const plant = (files: Record<string, string>): string => {
    const dir = path.join(mkTmp('frame-fixtures-'), 'box');
    mkdirSync(dir, { recursive: true });
    for (const [n, t] of Object.entries(files)) writeFileSync(path.join(dir, n), t);
    return dir;
  };
  it('a clean fixture passes', () => {
    expect(fixtureFindings(plant({ [frameFixtureName('2.1.332', part)]: clean }))).toEqual([]);
  });
  it('a fixture with no header, or under another name, is named', () => {
    expect(fixtureFindings(plant({ 'cc2.1.332-frame-rows-3-220x50.ansi': 'no header\n' }))).toEqual(['cc2.1.332-frame-rows-3-220x50.ansi: no header on the grammar']);
    expect(fixtureFindings(plant({ 'cc2.1.331-frame-rows-3-220x50.ansi': clean }))).toEqual(['cc2.1.331-frame-rows-3-220x50.ansi: the name is not its header\'s']);
  });
  it('a fixture holding a path, a model line or the committed canary is named with its rule word', () => {
    const bad = (row: string): string => frameFixtureOf('2.1.332', 'rows-3@220x50', '0123456789abcdef', [row, RULE].join('\n') + '\n');
    const n = frameFixtureName('2.1.332', part);
    expect(fixtureFindings(plant({ [n]: bad('  cwd …/projects/x') }))).toEqual([`${n}: private-shape`]);
    expect(fixtureFindings(plant({ [n]: bad('  Haiku 9.9') }))).toEqual([`${n}: private-shape`]);
    expect(fixtureFindings(plant({ [n]: bad(`  note ${CANARY}`) }))).toEqual([`${n}: private-name`]);
  });
  it('the header grammar refuses a build or a frame the recipe does not have', () => {
    expect(readFrameFixture(frameFixtureOf('latest', 'rows-3@220x50', '0123456789abcdef', 'x\n'))).toBeNull();
    expect(readFrameFixture(frameFixtureOf('2.1.332', 'rows-3@220x30', '0123456789abcdef', 'x\n'))).toBeNull();
    expect(readFrameFixture(clean)).toMatchObject({ build: '2.1.332', part, version: '0123456789abcdef' });
  });
});
