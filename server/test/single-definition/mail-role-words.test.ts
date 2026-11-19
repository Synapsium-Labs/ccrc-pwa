// One home for the two sender role words of mid-turn mail (ruling `urgent-role-words-two-homes`, mid-turn mail PR 2).
// `coordinator` and `overlord` are the roles an urgent delivery is stored under (`mail.urgentAs`, the sender rule
// `server/src/coord/urgentMail.ts#urgentSenderVerdict`) and the roles the hold names (`shared/mailHold.ts#MAILHOLD_ROLES`).
// PR 3 landed the L0 list first, so the rule imports it and keeps no copy: no two-word list or two-word union of them is
// spelled in code outside `shared/mailHold.ts`. A union that names more roles (the continuity card's five) is another
// vocabulary and is not matched. The migration's SQL CHECK on `mail.urgentAs` is the database's own guard over the
// same words and lives in `schema.ts`'s frozen migration text, which this scan does not read as TypeScript.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { MAILHOLD_ROLES } from '../../../shared/mailHold.js';
import { ALL, rel } from './helpers.js';

/** Source with line comments and the text of block comments removed, so prose that spells the two words is not a copy. */
const code = (f: string): string =>
  readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/(^|\s)\/\/.*$/, '$1')).join('\n');

const W = `'(?<a>coordinator|overlord)'`;
const W2 = `'(?!\\k<a>')(coordinator|overlord)'`;
/** A two-word array literal of the role words, in either order. */
const LIST = new RegExp(`\\[\\s*${W}\\s*,\\s*${W2}\\s*\\]`);
/** A two-word union of the role words, in either order, not part of a longer union. */
const UNION = new RegExp(`(^|[^|\\s])\\s*${W}\\s*\\|\\s*${W2}\\s*(?![\\s|]*\\|)`, 'm');

const holders = (): string[] =>
  ALL.filter((f) => f.endsWith('.ts') || f.endsWith('.tsx')).filter((f) => { const t = code(f); return LIST.test(t) || UNION.test(t); }).map(rel).sort();

describe('the mid-turn mail role words have one home (urgent-role-words-two-homes)', () => {
  it('CONTROL: the home spells the list, and the matchers see both shapes and skip a longer union', () => {
    expect([...MAILHOLD_ROLES]).toEqual(['coordinator', 'overlord']);
    expect(LIST.test(`const R = ['overlord', 'coordinator'] as const;`)).toBe(true);
    expect(UNION.test(`type R = 'coordinator' | 'overlord';`)).toBe(true);
    expect(UNION.test(`type R = 'overlord' | 'coordinator' | 'worker';`)).toBe(false);
    expect(LIST.test(`const R = ['coordinator', 'coordinator'];`)).toBe(false);
  });
  it('no two-word list or union of the role words is spelled outside shared/mailHold.ts', () => {
    expect(holders()).toEqual(['shared/mailHold.ts']);
  });
});
