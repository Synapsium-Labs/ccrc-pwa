// The vocabulary piece's oracles and mutant sets (Overlord W1, `docs/superpowers/plans/2026-11-14-overlord-w1/
// w1-vocabulary.md`, Tasks 2 and 4). Each reader's cases are written ONCE here, as suite cases over a module:
// `single-definition/injected-prompts.test.ts` and `practice-triggers.test.ts` run them against the real modules, and
// `mutation-floors.test.ts` runs them against each named mutant (D-8217's every-run floors). The expected words are
// written out, not read from the code the cases judge.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import type { MutantSet, SuiteCase } from './mutate.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

// ---------- injectedPromptOf ----------

export type InjectedPromptsModule = typeof import('../../../shared/injected-prompts.mjs');

/** The census's "Rows" cases over a module's list and its reader. */
export function injectedRowCases(m: InjectedPromptsModule): Record<string, SuiteCase> {
  const rows = m.INJECTED_PROMPTS as unknown as Readonly<Record<string, { text: string; match: string; typer: string }>>;
  const of = (v: unknown): string | null => m.injectedPromptOf(v);
  const keys = Object.keys(rows);
  return {
    'the eight keys, kebab and unique': () => {
      expect(keys).toEqual(['mail-nudge', 'idle-compact-nudge', 'clear', 'resume', 'compact', 'effort', 'effort-ultracode', 'model']);
      for (const k of keys) expect(k, k).toMatch(/^[a-z]+(?:-[a-z]+)*$/);
      expect(new Set(keys).size).toBe(keys.length);
    },
    'texts are non-empty, single-line and unique': () => {
      const texts = keys.map((k) => rows[k]!.text);
      for (const t of texts) { expect(t.length).toBeGreaterThan(0); expect(t).not.toMatch(/\n/); }
      expect(new Set(texts).size).toBe(texts.length);
    },
    'no head row\'s text is a word-boundary prefix of another row\'s text, so no input matches two rows': () => {
      for (const h of keys.filter((k) => rows[k]!.match === 'head')) {
        for (const o of keys.filter((k) => k !== h)) {
          const a = rows[h]!.text, b = rows[o]!.text;
          expect(b === a || b.startsWith(`${a} `) || b.startsWith(`${a}\n`), `${h} is a prefix of ${o}`).toBe(false);
        }
      }
    },
    'each row\'s text reads back as its key; an exact row\'s with a trailing newline, a head row\'s with a word after it': () => {
      for (const k of keys) {
        expect(of(rows[k]!.text), k).toBe(k);
        if (rows[k]!.match === 'head') {
          expect(of(`${rows[k]!.text} word`), k).toBe(k);
          expect(of(`${rows[k]!.text}\nmore`), k).toBe(k);
        } else {
          expect(of(`${rows[k]!.text}\n`), k).toBe(k);
        }
      }
      expect(of('/effort ultracode')).toBe('effort-ultracode');
      expect(of('/compact keep the plan')).toBe('compact');
    },
    'null for a non-string or an empty string, never coerced': () => {
      for (const v of ['', ['/clear'], 42, null, undefined, { text: '/clear' }, true]) expect(of(v), String(v)).toBeNull();
    },
    'null for an exact row with a tail, a head row without a boundary, an inherited name and an operator sentence': () => {
      expect(of('/clear now')).toBeNull();
      expect(of('/model x')).toBeNull();
      expect(of('/compactfoo')).toBeNull();
      expect(of('constructor')).toBeNull();
      expect(of('Please continue with the plan and tell me when it is done.')).toBeNull();
    },
    'null for each text with one character changed, its case included': () => {
      for (const k of keys) {
        const t = rows[k]!.text;
        for (let i = 0; i < t.length; i++) {
          const c = t[i]!;
          const flipped = c.toUpperCase() !== c ? c.toUpperCase() : c.toLowerCase() !== c ? c.toLowerCase() : c === 'x' ? 'y' : 'x';
          expect(of(t.slice(0, i) + flipped + t.slice(i + 1)), `${k} with character ${i} changed`).toBeNull();
        }
      }
    },
  };
}

export const INJECTED_PROMPT_KEY = 'shared/injected-prompts.mjs#injectedPromptOf';
/** F7: each can be killed. "Try head rows first" and "read a non-string as ''" are equivalent over these rows. */
export const INJECTED_PROMPT_SET: MutantSet<InjectedPromptsModule> = {
  modulePath: path.join(ROOT, 'shared/injected-prompts.mjs'),
  mutants: [
    { id: 'I1 no word boundary', old: "if (next === '' || next === ' ' || next === '\\n') return r.key;", new: 'return r.key;' },
    { id: 'I2 exact matched as head', old: "const EXACT = ROWS.filter((r) => r.match === 'exact');\nconst HEAD = ROWS.filter((r) => r.match === 'head');", new: 'const EXACT = [];\nconst HEAD = ROWS;' },
    { id: 'I3 the first row for any string', old: "  if (typeof text !== 'string' || text === '') return null;\n", new: "  if (typeof text !== 'string' || text === '') return null;\n  return ROWS[0].key;\n" },
    { id: 'I4 a non-string coerced', old: "  if (typeof text !== 'string' || text === '') return null;\n", new: "  text = String(text);\n  if (text === '') return null;\n" },
    { id: 'I5 compared without case', old: 'for (const r of EXACT) if (whole === r.text) return r.key;', new: 'for (const r of EXACT) if (whole.toLowerCase() === r.text.toLowerCase()) return r.key;' },
  ],
  suite: injectedRowCases,
};

export const VOCABULARY_MUTANT_SETS: Record<string, MutantSet<never>> = {
  [INJECTED_PROMPT_KEY]: INJECTED_PROMPT_SET as MutantSet<never>,
};
