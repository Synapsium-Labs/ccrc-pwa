import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/** tailwind-merge, TAUGHT THIS THEME'S TWO RENAMED FAMILIES.
 *
 *  theme.css renames six token families because Tailwind v4 owns the
 *  namespaces (`--text-*` -> `--fs-*`, `--font-*` -> `--family-*`, and so on,
 *  argued in that file's header). Two of those renames collide with how
 *  tailwind-merge classifies a utility it does not recognise: it reads the
 *  PREFIX, so `text-input` and `text-2xs` look like text COLOURS, and
 *  `font-regular`/`font-medium`/`font-semibold` look like font FAMILIES.
 *
 *  The consequence was silent and shipped. Seven class strings in this package
 *  lost a utility on the way to the DOM — measured, not feared:
 *
 *    TEXT_INPUT          lost  text-ink-primary  and  font-ui
 *    SELECT              lost  text-ink-primary  and  font-ui
 *    BackButton's base   lost  font-ui
 *    Banner's base       lost  font-ui
 *    Toast's base        lost  font-ui
 *    ControlRow's base   lost  font-mono
 *    Well's base         lost  font-mono
 *
 *  `cn(TEXT_INPUT)` returned a string with no ink utility at all: the field
 *  inherited whatever ink was behind it, and `utility-pairs.test.ts` went on
 *  measuring a pair the DOM never carried — the exact drift that file exists
 *  to stop, running backwards. The two mono components rendered in the UI
 *  family. Nothing caught it because every guard in the tree reads the class
 *  STRING, and the string was right; the loss happens inside this function.
 *
 *  The skin axis's roles (D-5093) were the same failure waiting to ship, and
 *  were measured before they could: untaught, `cn('text-ink-primary',
 *  'text-meta')` returned "text-meta" — the ink deleted — and so did
 *  `text-ui`, `text-prose`, `text-page` and `text-section` (`text-md` alone
 *  survived, because twMerge reads `md` as a T-shirt size). The spacing roles
 *  failed the other way round: `cn('p-4', 'p-gutter')` kept BOTH, so a
 *  caller's role could never replace a component's step and Tailwind's emit
 *  order picked. Both are taught below, in the change that introduced them.
 *
 *  So the groups are declared. `ui/test`'s `cn` spec pins both directions:
 *  a size and an ink survive together, and a caller's override still wins. */
const merge = extendTailwindMerge({
  extend: {
    // The density roles (D-5093), as SPACING keys: one entry places
    // `p-gutter`, `px-card`, `gap-section`, `m-*`, `h-row` and `min-h-row` in
    // the same groups as their scale twins, so either replaces the other.
    theme: {
      spacing: ['gutter', 'row', 'card', 'section'],
    },
    classGroups: {
      // The sizes Tailwind has no name for: two scale steps and the type
      // roles (D-5093). Tailwind's own six (`xs`…`2xl`) were never misread;
      // `md` is listed although twMerge already reads it as a T-shirt size,
      // so the whole new scale step is declared in one place.
      'font-size': [{ text: ['2xs', 'input', 'md', 'ui', 'prose', 'meta', 'page', 'section'] }],
      // The weights. Tailwind's own are `font-normal`/`font-medium`/…; this
      // theme says `--font-weight-regular`, so `font-regular` is ours.
      'font-weight': [{ font: ['regular', 'medium', 'semibold'] }],
      // THE TAP FLOOR AND THE NAMED LAYERS, which twMerge could not place in
      // a group at all — so it kept BOTH halves of a conflict and let
      // Tailwind's emit order pick. Measured twice: `cn(BARE_ROW, 'min-h-0')`
      // kept `min-h-tap` beside `min-h-0`, and the terminal drawer carried
      // `z-sheet` and `z-drawer` together and sank to 40 (`z-sheet` emits
      // later). Declared, a later one replaces an earlier one, as every
      // Tailwind-native pair already does.
      'min-h': [{ 'min-h': ['tap'] }],
      'min-w': [{ 'min-w': ['tap'] }],
      z: [{ z: ['header', 'sheet', 'drawer', 'toast', 'block'] }],
    },
  },
});

/** Merge class lists, last-wins on conflicting Tailwind utilities. The shadcn
 *  convention: every component takes `className` and passes it through here,
 *  so a caller can override any utility the variant set.
 *
 *  twMerge only knows Tailwind's OWN class names. This theme adds custom keys
 *  (bg-surface, text-ink-primary, min-h-tap), and twMerge resolves those by
 *  utility PREFIX, so `bg-surface` and `bg-raised` still collapse correctly —
 *  and the two places where that prefix rule got the GROUP wrong are declared
 *  above. What it cannot resolve is two different prefixes that touch the same
 *  property — `bg-phosphor` vs `bg-linear-to-r`. Don't rely on it for those. */
export function cn(...inputs: ClassValue[]): string {
  return merge(clsx(inputs));
}
