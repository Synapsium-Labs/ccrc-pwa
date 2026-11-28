// The coordinator's decision procedure tells it how to WRITE an item: Markdown, a fenced block per command, inline code for a
// name, one act a step, asterisks for emphasis. The console draws that Markdown and summaries strip it (`itemPlainText`), so the
// paragraph is pinned: a softened sentence is a red suite.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '../..');
const procedure = readFileSync(path.join(root, 'ccd/coordinator-skill/references/decision-procedure.md'), 'utf8');
const operatorSection = procedure.split('\n## What only the operator decides\n')[1]!.split('\n- **O1.')[0]!;
// The paragraph runs from its first sentence to the O1 list, its tiny example fence included (a blank line sits around the fence).
const start = operatorSection.indexOf('Item text is Markdown');
const paragraph = start < 0 ? '' : operatorSection.slice(start);
const flat = paragraph.replace(/\s+/g, ' ');

describe('the item-writing paragraph of the decision procedure', () => {
  it('stands in the operator-decides section, before the O1 list', () => {
    expect(start).toBeGreaterThan(0);
  });
  it('says item text is Markdown', () => {
    expect(flat).toContain('Item text is Markdown, and the console draws it.');
  });
  it('puts every command alone in a fenced block, nothing in it that is not pasted', () => {
    expect(flat).toContain('Every command the operator is to run goes alone in a fenced block, one command or one pasteable sequence per block, with nothing in the block that is not to be pasted');
    expect(paragraph).toMatch(/```sh\n[^`]+\n```/);
  });
  it('gives a path or a name inside a sentence inline code', () => {
    expect(flat).toContain('A path or a name inside a sentence takes inline code (backticks), except a document the operator is to open: its repository path stays bare, outside backticks, so the console links it to the Docs reader.');
  });
  it('makes a How step one act, and a title and an option inline only, an option at most 140 characters', () => {
    expect(flat).toContain('A How step is one act.');
    expect(flat).toContain('A title and an option take inline marks only, no blocks, and an option is at most 140 characters.');
  });
  it('uses asterisks for emphasis, never underscores', () => {
    expect(flat).toContain('Emphasis uses asterisks, never underscores.');
  });
});
