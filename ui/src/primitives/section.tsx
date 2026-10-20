// Section — one titled card on a scaffolded page (D-5102; its slots D-5666).
//
// A head, then a hairline card on `--bg-surface` at `--pad-card`, `--r-lg` and
// `--elev-card`. The head carries the Settings spec's §15.3 C3 slots:
//   - `scope`: whose setting this is ("This device", "Whole fleet"). Refined
//     draws it as the eyebrow above the title; Instrument as a mono tag at the
//     head's right, because its section titles are already mono caps and two
//     stacked mono-caps lines blur together (that spec's §3.3);
//   - `title`: the h2, at the section type roles (`--fs-section` and its four
//     companions), which Instrument re-points to 11px mono caps;
//   - `purpose`: one sentence under the head saying what the card is for.
//
// THE SCOPE'S PLACE IS ONE TOKEN. Only skins.css may select on `data-skin`
// (skin-identity.test.ts, census (k)), so the head cannot say "in Instrument,
// put the scope on the right". It says `flex-direction: var(--section-flow)`:
// `column-reverse` in Refined lifts the scope (second in the DOM) above the
// title; `row` in Instrument puts it beside the title, pushed right by
// `justify-between`. The DOM order is the reading order in both: the title,
// then whose it is.
//
// No stylesheet: utilities over tokens, measured as token pairs
// (`--ink-primary`, `--ink-secondary` and `--ink-tertiary` on `--bg-page`; the
// card's contents on `--bg-surface`).
import { useId, type HTMLAttributes, type ReactNode } from 'react';
import { cn } from '../lib/cn';

export const SECTION = 'grid min-w-0 gap-2';
/** The head: the title and the scope, placed by the skin. */
export const SECTION_HEAD =
  'flex [flex-direction:var(--section-flow)] flex-wrap items-baseline justify-between gap-x-3 gap-y-1';
export const SECTION_TITLE =
  'm-0 min-w-0 text-section font-(family-name:--family-section) font-(--weight-section)'
  + ' [text-transform:var(--case-section)] tracking-(--ls-section) leading-tight text-ink-primary';
/** The eyebrow idiom: mono caps on the 11px floor, in the tertiary ink. */
export const SECTION_SCOPE = 'm-0 font-mono text-2xs font-medium uppercase tracking-caps leading-tight text-ink-tertiary';
export const SECTION_PURPOSE = 'm-0 text-meta leading-normal text-ink-secondary';
export const SECTION_CARD =
  'grid min-w-0 gap-2 rounded-lg border border-edge-subtle bg-surface p-card shadow-card';

export interface SectionProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  /** Whose this is: drawn as the eyebrow (Refined) or the head's tag (Instrument). */
  scope?: ReactNode;
  /** The h2. A section without one is an unnamed card on the page. */
  title?: ReactNode;
  /** One sentence: what the card is for. */
  purpose?: ReactNode;
  children?: ReactNode;
  className?: string;
}

export function Section({ scope, title, purpose, children, className, ...props }: SectionProps): ReactNode {
  const titleId = useId();
  const named = title !== undefined;
  return (
    <section aria-labelledby={named ? titleId : undefined} className={cn(SECTION, className)} {...props}>
      {(named || scope !== undefined) && (
        <div className={SECTION_HEAD}>
          {named && <h2 id={titleId} className={SECTION_TITLE}>{title}</h2>}
          {scope !== undefined && <p className={SECTION_SCOPE}>{scope}</p>}
        </div>
      )}
      {purpose !== undefined && <p className={SECTION_PURPOSE}>{purpose}</p>}
      <div className={SECTION_CARD}>{children}</div>
    </section>
  );
}
