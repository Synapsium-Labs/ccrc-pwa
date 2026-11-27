// Every box frame fixture in the tree is reduced and clean (Desktop polish wave 187; plan
// docs/superpowers/plans/2026-11-26-box-frames-recipe.md section 5.4): the last check, not the only one. A session writes a
// fixture from the one read's reduced frame (`shared/framesFixture.ts`); this case reads EVERY file under the frames'
// fixture folder (`FRAMES_FIXTURE_DIR`), whatever its name and however deep (review 4069's A5), and holds each to its header
// and name, and to the reducer's own check (`checkReducedFrame`, with the committed private-name scan). The tree ratchets
// (`topology-clean`, `private-names`) scan every tracked file besides. The folder holds none today (it does not exist), so
// the tree case passes vacuously; the planted cases prove the checker reds.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CANARY } from '../../shared/private-names.mjs';
import { framesScan } from '../../shared/framesScan.mjs';
import { framesOurs } from '../../shared/framesCapture.js';
import { FRAMES_FIXTURE_DIR, frameFixtureName, frameFixtureOf, readFrameFixture } from '../../shared/framesFixture.js';
import { FRAMES_STATUS_TEXT, checkReducedFrame } from '../../shared/framesReduce.js';
import { FRAMES_PARTS, framesPartOfId } from '../../shared/framesResult.js';
import { mkTmp, removeTmpFixturesEachTest } from './tmpHelpers.js';

removeTmpFixturesEachTest();

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BOX = path.join(REPO, FRAMES_FIXTURE_DIR);

/** Every file under `dir`, at any depth, by its path relative to `dir`. */
function filesUnder(dir: string, rel = ''): string[] {
  if (!existsSync(path.join(dir, rel))) return [];
  return readdirSync(path.join(dir, rel)).sort().flatMap((n) => {
    const r = rel === '' ? n : `${rel}/${n}`;
    return statSync(path.join(dir, r)).isDirectory() ? filesUnder(dir, r) : [r];
  });
}

/** What is wrong with each file under `dir`, one line each; `[]` when all hold. Every file is a frame fixture. */
function fixtureFindings(dir: string): string[] {
  const out: string[] = [];
  for (const name of filesUnder(dir)) {
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
// The capture's status row sits directly under the box's lower rule (rule 8, review 4069's F3).
const STATUS = `  ${FRAMES_STATUS_TEXT}`;
const clean = frameFixtureOf('2.1.332', 'rows-3@220x50', '0123456789abcdef', [RULE, '❯ frames row 001 of 003 abcdefghij', RULE, STATUS, '  ? for shortcuts'].join('\n') + '\n');

describe('the box frame fixtures in the tree', () => {
  it('every one is reduced and clean, under its own name and header', () => {
    expect(fixtureFindings(BOX)).toEqual([]);
  });
  it('the frames\' folder is not the panes\' box folder, which holds the earlier box fixtures', () => {
    expect(FRAMES_FIXTURE_DIR).toBe('server/test/fixtures/box-frames');
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
  it('every file in the folder is checked, whatever its name and however deep (review 4069, A5)', () => {
    const dir = plant({ 'notes.txt': 'a note\n', [frameFixtureName('2.1.332', part)]: clean });
    mkdirSync(path.join(dir, 'deeper'));
    writeFileSync(path.join(dir, 'deeper', 'x.ansi'), clean);
    expect(fixtureFindings(dir)).toEqual(['deeper/x.ansi: the name is not its header\'s', 'notes.txt: no header on the grammar']);
  });
  it('a fixture with no header, or under another name, is named', () => {
    expect(fixtureFindings(plant({ 'cc2.1.332-frame-rows-3-220x50.ansi': 'no header\n' }))).toEqual(['cc2.1.332-frame-rows-3-220x50.ansi: no header on the grammar']);
    expect(fixtureFindings(plant({ 'cc2.1.331-frame-rows-3-220x50.ansi': clean }))).toEqual(['cc2.1.331-frame-rows-3-220x50.ansi: the name is not its header\'s']);
  });
  it('a fixture holding a path, a model line or the committed canary is named with its rule word', () => {
    const bad = (row: string): string => frameFixtureOf('2.1.332', 'rows-3@220x50', '0123456789abcdef', [row, RULE, STATUS].join('\n') + '\n');
    const n = frameFixtureName('2.1.332', part);
    expect(fixtureFindings(plant({ [n]: bad('  cwd …/projects/x') }))).toEqual([`${n}: private-shape`]);
    expect(fixtureFindings(plant({ [n]: bad('  Haiku 9.9') }))).toEqual([`${n}: private-shape`]);
    expect(fixtureFindings(plant({ [n]: bad(`  note ${CANARY}`) }))).toEqual([`${n}: private-name`]);
    const foreignStatus = frameFixtureOf('2.1.332', 'rows-3@220x50', '0123456789abcdef', [RULE, '  ~/work main', '  ? for shortcuts'].join('\n') + '\n');
    expect(fixtureFindings(plant({ [n]: foreignStatus }))).toEqual([`${n}: status-row`]);
  });
  it('the header grammar refuses a build or a frame the recipe does not have', () => {
    expect(readFrameFixture(frameFixtureOf('latest', 'rows-3@220x50', '0123456789abcdef', 'x\n'))).toBeNull();
    expect(readFrameFixture(frameFixtureOf('2.1.332', 'rows-3@220x30', '0123456789abcdef', 'x\n'))).toBeNull();
    expect(readFrameFixture(clean)).toMatchObject({ build: '2.1.332', part, version: '0123456789abcdef' });
  });
  // Review 4069's F7: the version's grammar is held once, by FRAMES_VERSION_SHAPE, and this case is what reds without it.
  it('the header grammar refuses a version off its shape: upper case, a letter past f, one short, one long, empty', () => {
    for (const v of ['0123456789ABCDEF', '0123456789abcdeg', '0123456789abcde', '0123456789abcdef0', 'zzzzzzzzzzzzzzzz']) {
      expect(readFrameFixture(frameFixtureOf('2.1.332', 'rows-3@220x50', v, 'x\n')), v).toBeNull();
    }
    expect(readFrameFixture('# ccrc box frame: build 2.1.332 frame rows-3@220x50 recipe \nx\n')).toBeNull();
    const n = frameFixtureName('2.1.332', part);
    expect(fixtureFindings(plant({ [n]: frameFixtureOf('2.1.332', 'rows-3@220x50', '0123456789ABCDEF', 'x\n') }))).toEqual([`${n}: no header on the grammar`]);
  });
});
