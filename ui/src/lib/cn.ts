import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Merge class lists, last-wins on conflicting Tailwind utilities. The shadcn
 *  convention: every component takes `className` and passes it through here,
 *  so a caller can override any utility the variant set.
 *
 *  twMerge only knows Tailwind's OWN class names. This theme adds custom keys
 *  (bg-surface, text-ink-primary, min-h-tap), and twMerge resolves those by
 *  utility PREFIX, so `bg-surface` and `bg-raised` still collapse correctly.
 *  What it cannot resolve is two different prefixes that touch the same
 *  property — `bg-accent` vs `bg-linear-to-r`. Don't rely on it for those. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
