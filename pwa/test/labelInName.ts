// WCAG 2.5.3 (Label in Name), the way axe-core 4.14 measures it in the
// storybook-a11y job (D-7897): the visible label's WORDS are a contiguous run
// of the accessible name's words. Case is ignored, a parenthetical is dropped
// from both sides, and anything that is not a letter or a digit only separates
// words, so `↻`, `—` and `·` count for nothing while `esc` and `escape` stay
// two different words. A voice user says what they see, and when those words
// are not in the name, the command finds nothing.
//
// The jsdom suites cannot run axe, so this is the rule they hold a name to:
// a component test asks it of the same text the browser would read.

/** The words a label or a name is made of. */
export function labelWords(text: string): string[] {
  let s = text.normalize('NFKD');
  for (let prev = ''; prev !== s;) {
    prev = s;
    s = s.replace(/\([^()]*\)/g, '');
  }
  return s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w !== '');
}

/** Whether every word of `label` appears in `name`, in order and unbroken.
 *  A label with no words (a glyph, a `+`) is in every name. */
export function labelInName(label: string, name: string): boolean {
  const l = labelWords(label);
  if (l.length === 0) return true;
  const n = labelWords(name);
  for (let i = 0; i + l.length <= n.length; i++) {
    if (l.every((w, j) => n[i + j] === w)) return true;
  }
  return false;
}

/** The text an element SHOWS, the way axe-core reads it: every text node
 *  under it, `aria-hidden` ones included (a sighted user still sees them),
 *  `.sr-only` ones left out (nobody sees those), joined with no separator, so
 *  two adjacent spans with no space between them read as one word. */
export function shownText(el: Element): string {
  const copy = el.cloneNode(true) as Element;
  for (const sr of copy.querySelectorAll('.sr-only')) sr.remove();
  return copy.textContent ?? '';
}

/** Every control under `root` named by `aria-label` whose shown words are not
 *  in that name, as `"shown" in "name"` lines: the measurement above run over a
 *  whole region, for the controls no Storybook story renders (D-8383). Empty
 *  when every name holds its label. */
export function namesWithoutTheirLabel(root: Element): string[] {
  const out: string[] = [];
  for (const el of root.querySelectorAll('button[aria-label], [role="button"][aria-label]')) {
    const name = el.getAttribute('aria-label') ?? '';
    const shown = shownText(el);
    if (!labelInName(shown, name)) out.push(`${JSON.stringify(shown)} in ${JSON.stringify(name)}`);
  }
  return out;
}
