// A plan that reshapes what the operator SEES must say, in the plan, whether a
// design canvas is part of the work. The operator's ask, 2026-09-29: the
// orchestrator should be able to "wymuszać bądź at least pytać" — force, or at
// least ask.
//
// Prose alone cannot do that. This repo's own doctrine: "A comment is a
// request; a red suite is a mechanism." The coordinator skill can only act on a
// declaration that is RELIABLY there, so the declaration is what gets pinned —
// not the canvas, which is a judgement call, and not the coordinator's reading
// of it, which is prose by design.
//
// SCOPE IS DELIBERATELY NARROW. This scans plans, not source, and it checks
// that a QUESTION was answered — never which answer was given. `none` passes
// exactly as `required` does. A guard that demanded canvases would be a guard
// that lies about what it measures.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const PLANS = path.resolve(here, '..', '..', 'docs', 'superpowers', 'plans');

/** The floor, as a filename date. 101 plans predate this convention and none of
 *  them will ever grow the section — exempting them by LIST would be 101 lines
 *  that rot, so the boundary is the date this landed. A plan filed under an
 *  earlier date is out of scope whenever it was written; that is the cost of a
 *  boundary anyone can see without reading this file. */
const FLOOR = '2026-09-29';

/** What makes a plan a UI plan. Both roots render something the operator looks
 *  at: `ui/src` is the design system itself, and `pwa/src`'s `.tsx` are its call
 *  sites. A plan naming neither is not asked the question. */
const UI_PATH = /\b(ui\/src\/[\w./-]+|pwa\/src\/[\w./-]*\.tsx)\b/;

/** The three answers, and nothing else. An unrecognised word is a typo that
 *  would otherwise pass as a declaration. */
const POSTURE = /^\*\*Posture:\*\*\s+(required|offer|none)\b/m;

export function designVerdict(text: string): 'not-ui' | 'ok' | 'missing-section' | 'bad-posture' {
  if (!UI_PATH.test(text)) return 'not-ui';
  const at = text.search(/^## Design\b/m);
  if (at < 0) return 'missing-section';
  // Read only THIS section — the next `## ` heading ends it. Without the bound a
  // `**Posture:**` line anywhere later in the plan would satisfy the check.
  const rest = text.slice(at + 1);
  const end = rest.search(/^## /m);
  const section = end < 0 ? rest : rest.slice(0, end);
  return POSTURE.test(section) ? 'ok' : 'bad-posture';
}

function inScope(name: string): boolean {
  return name.endsWith('.md') && name.slice(0, 10) >= FLOOR;
}

describe('plans declare a design posture', () => {
  it('every in-scope plan that names a UI path carries ## Design with a valid posture', () => {
    const bad: string[] = [];
    for (const f of readdirSync(PLANS).filter(inScope)) {
      const verdict = designVerdict(readFileSync(path.join(PLANS, f), 'utf8'));
      if (verdict === 'missing-section' || verdict === 'bad-posture') bad.push(`${f}: ${verdict}`);
    }
    expect(bad, 'add a "## Design" section with **Posture:** required|offer|none').toEqual([]);
  });

  // The guard that guards the guard. Without these the suite above passes
  // vacuously the whole time no in-scope UI plan exists yet — which is TODAY.
  it('reds on a UI plan with no ## Design section', () => {
    expect(designVerdict('touches `ui/src/primitives/button.tsx`.\n')).toBe('missing-section');
  });

  it('reds on a ## Design section whose posture is not one of the three words', () => {
    const plan = 'edits `pwa/src/fleet/SessionLine.tsx`.\n\n## Design\n\n**Posture:** maybe\n';
    expect(designVerdict(plan)).toBe('bad-posture');
  });

  it('reds when the posture line sits in a LATER section rather than ## Design', () => {
    const plan =
      'edits `ui/src/primitives/button.tsx`.\n\n## Design\n\nno answer here\n\n' +
      '## Measurements\n\n**Posture:** required\n';
    expect(designVerdict(plan)).toBe('bad-posture');
  });

  it('passes a UI plan that answers none, exactly as one that answers required', () => {
    const base = 'edits `ui/src/primitives/button.tsx`.\n\n## Design\n\n';
    expect(designVerdict(`${base}**Posture:** none\n`)).toBe('ok');
    expect(designVerdict(`${base}**Posture:** required\n`)).toBe('ok');
  });

  it('asks nothing of a plan that names no UI path', () => {
    expect(designVerdict('rewrites `server/src/coord/store.ts`.\n')).toBe('not-ui');
  });
});
