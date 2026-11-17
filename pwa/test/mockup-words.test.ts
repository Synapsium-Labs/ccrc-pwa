// The mockup viewer's words for what it refuses (native Docs reader, completion plan Task 8, C2, review A9). Every reason the
// pre-scan can refuse a page for, and every reason the planner can refuse a reference for, reads as one closed sentence of
// the viewer's own: never the raw reason word. The two tables are typed over the producers' own unions
// (`MOCKUP_REFUSAL_SENTENCE` over `MockupPrescan`'s `why`, the verdict's `refused.why` over `MockupRefusedWhy`), so a reason
// added at the source is a compile error at the words; these tests run the real producers over a table of inputs typed the
// same way, so a reason that table forgets is a compile error here too. Placeholders only.
import { describe, expect, it } from 'vitest';
import { DOC_IMAGE_REFUSED_SENTENCE, MOCKUP_REFUSAL_SENTENCE, mockupVerdictSentence } from '../src/docs/docsText';
import {
  MOCKUP_MAX_ATTRIBUTES, MOCKUP_MAX_DEPTH, MOCKUP_MAX_OPEN_FORMATTING, MOCKUP_MAX_TAGS,
} from '../src/docs/mockup/policy';
import { planMockupAssets } from '../src/docs/mockup/plan';
import type { MockupRef, MockupRefusedWhy } from '../src/docs/mockup/ports';
import { prescanMockup, type MockupPrescan } from '../src/docs/mockup/prescan';
import { entry, treeOk, COMMIT_A } from './docsFixtures';

type PrescanWhy = Extract<MockupPrescan, { ok: false }>['why'];

/** A page the pre-scan refuses for each of its reasons. */
const PRESCAN_INPUT: Record<PrescanWhy, string> = {
  'too-deep': '<div>'.repeat(MOCKUP_MAX_DEPTH + 1),
  'too-many-tags': '<br>'.repeat(MOCKUP_MAX_TAGS + 1),
  'too-many-formatting': '<b>'.repeat(MOCKUP_MAX_OPEN_FORMATTING + 1),
  'too-many-attributes': `<p ${Array.from({ length: MOCKUP_MAX_ATTRIBUTES + 1 }, (_, i) => `a${i}`).join(' ')}>`,
  'foreign-markup': '<svg><desc><b>x</b></desc></svg>',
};

/** A reference the planner refuses for each of its reasons, written in `specs/m.html` (`docs/superpowers/specs/m.html`). */
const REFERENCE_FOR: Record<MockupRefusedWhy, string> = {
  'repo': '../../../README.md',
  'scheme': 'ftp://files.example/a.png',
  'empty': '',
  'malformed': 'a b.png',
  'protocol-relative': '//cdn.example/a.png',
  'root-relative': '/a.png',
  'above-root': '../../../../a.png',
  'bad-path': 'a%zz.png',
};

describe('the pre-scan\'s refusal reasons each read as a closed sentence', () => {
  it.each(Object.keys(PRESCAN_INPUT) as PrescanWhy[])('%s: the producer gives this reason, and the table has its sentence', (why) => {
    const p = prescanMockup(PRESCAN_INPUT[why]);
    expect(p.ok).toBe(false);
    expect(p.ok ? null : p.why).toBe(why);
    expect(MOCKUP_REFUSAL_SENTENCE[why]).toMatch(/^[a-z]/);
    expect(MOCKUP_REFUSAL_SENTENCE[why]).not.toContain(why);
  });

  it('the table holds exactly the pre-scan\'s reasons, each with its own sentence', () => {
    expect(Object.keys(MOCKUP_REFUSAL_SENTENCE).sort()).toEqual(Object.keys(PRESCAN_INPUT).sort());
    expect(new Set(Object.values(MOCKUP_REFUSAL_SENTENCE)).size).toBe(Object.keys(PRESCAN_INPUT).length);
  });
});

describe('the planner\'s refusal reasons each read as a closed sentence, never the raw word', () => {
  const ctx = { project: 'demo', pin: { kind: 'committed' as const, commit: COMMIT_A, servedRef: 'refs/remotes/origin/main', section: 'specs' as const, path: 'm.html' }, tree: treeOk({ entries: [entry('specs', 'm.html')] }) };
  const refOf = (raw: string): MockupRef => ({ key: 'r0', raw, basePath: 'specs/m.html', kind: 'image', depth: 0 });

  it.each(Object.keys(REFERENCE_FOR) as MockupRefusedWhy[])('%s: the planner refuses with this reason and the sentence is the closed one', (why) => {
    const row = planMockupAssets([refOf(REFERENCE_FOR[why])], ctx).rows[0]!;
    expect(row.verdict).toEqual({ v: 'refused', why });
    const sentence = mockupVerdictSentence(row.verdict, false);
    expect(sentence).toBe(DOC_IMAGE_REFUSED_SENTENCE[why]);
    expect(sentence).not.toBe(why);
    expect(sentence.length).toBeGreaterThan(why.length);
  });

  it('every reason has its own sentence', () => {
    const sentences = (Object.keys(REFERENCE_FOR) as MockupRefusedWhy[]).map((w) => mockupVerdictSentence({ v: 'refused', why: w }, false));
    expect(new Set(sentences).size).toBe(sentences.length);
  });
});
