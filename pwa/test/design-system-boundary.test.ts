// THE BOUNDARY BETWEEN @ccrc/ui AND THIS APP, AS A MECHANISM.
//
// This guard exists because the boundary was crossed silently once already.
// Wave 2 retired `styles/legacy.css`, whose `.btn-primary`/`.btn-ghost` rules
// were the last copy of the button's styling outside the design system. While
// that work sat on a branch, `main` grew four new files that hand-wrote those
// same class names on raw `<button>` elements. Both sides were green: the app's
// suite never rendered those buttons against the retired stylesheet, and the
// contrast gate reads stylesheets, so a class with no rule behind it is
// invisible to it. The defect only appeared on the rebase, as ten buttons with
// no styling at all.
//
// The rule is therefore not "prefer the primitive". It is that the VOCABULARY
// belongs to the primitive: `btn-primary` and `btn-ghost` are emitted by
// `buttonVariants` in @ccrc/ui and by nothing else. A call site that needs a
// button imports `Button`; one that needs to style a link as a button imports
// `buttonVariants`. Either way the class arrives from the one definition, so it
// cannot outlive it.
//
// The classes themselves STAY on the rendered element on purpose — several
// scoped descendant rules (`.block-screen .btn-primary`, `.update-banner-actions
// .btn-ghost`, `.btn-ghost.settings-move`) select on them from this package's
// own stylesheets, and those sheets are imported unlayered so they still beat
// the utilities. Structural hooks, not styling.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const SRC = path.join(import.meta.dirname, '..', 'src');

/** Class names whose only legitimate source is @ccrc/ui's cva. */
const OWNED = ['btn-primary', 'btn-ghost'];

/** Every `className="..."` / `className={'...'}` string literal in a file. */
export function ownedClassLiterals(source: string): string[] {
  const hits: string[] = [];
  for (const m of source.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\}|\{'([^']*)'\})/g)) {
    const value = m[1] ?? m[2] ?? m[3] ?? '';
    for (const owned of OWNED) {
      if (new RegExp(`(^|\\s)${owned}(\\s|$)`).test(value)) hits.push(owned);
    }
  }
  return hits;
}

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...tsxFiles(p));
    else if (e.name.endsWith('.tsx')) out.push(p);
  }
  return out;
}

describe('the design-system boundary', () => {
  it('no component hand-writes a class the Button primitive owns', () => {
    const offenders: string[] = [];
    for (const f of tsxFiles(SRC)) {
      const hits = ownedClassLiterals(readFileSync(f, 'utf8'));
      if (hits.length > 0) {
        offenders.push(`${path.relative(SRC, f)}: ${[...new Set(hits)].join(', ')}`);
      }
    }
    expect(
      offenders,
      'import Button (or buttonVariants for a link) from @ccrc/ui instead of writing its classes',
    ).toEqual([]);
  });

  // Guards the guard: the scan above passes vacuously the moment its matcher
  // stops matching, and a matcher that silently matches nothing is exactly how
  // the original drift survived.
  it('reds on a raw button wearing the primitive vocabulary', () => {
    expect(ownedClassLiterals('<button className="btn-primary" />')).toEqual(['btn-primary']);
    expect(ownedClassLiterals('<a className="btn-ghost x" />')).toEqual(['btn-ghost']);
    expect(ownedClassLiterals('<div className={`btn-primary ${x}`} />')).toEqual(['btn-primary']);
  });

  it('does not fire on a substring or an unrelated class', () => {
    expect(ownedClassLiterals('<div className="btn-primary-ish" />')).toEqual([]);
    expect(ownedClassLiterals('<div className="settings-move" />')).toEqual([]);
  });

  it('does not fire on the variant call, which is the sanctioned route', () => {
    expect(ownedClassLiterals("<a className={buttonVariants({ variant: 'ghost' })} />")).toEqual([]);
  });
});
