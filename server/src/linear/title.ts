/**
 * The display format of a ticket's title, in one place so the preview route and
 * the create route (a later stage) cannot spell it differently. The OFFLINE
 * title (no key, no such ticket, no network) is `shared/slug.ts`'s
 * `offlineTitle`, not a second copy here.
 *
 * L1: pure strings in, a string out; no I/O.
 */

/** `[TICKET] - {title}`: the operator's requested display format. A hyphen with spaces. */
export function ticketTitle(identifier: string, title: string): string {
  return `${identifier} - ${title}`;
}
