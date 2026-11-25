// Each chat row's key once (desktop polish wave 175).
//
// A row is keyed by what its event carries (`chatItems.ts`): a message by its uuid, a call by its toolId. A uuid names a
// RECORD, and a record can carry two message events (two text blocks of one user record), so two rows could share a key
// (`eventIdentity.ts` says why). The list keeps the reader's place, remembers open rows and measures heights by the key,
// so a key must name one row. A repeated key gets a count after it, counted from the NEWEST end: a page of older rows
// prepended at the top never renames a row already shown, and only the older of two rows sharing a key is renamed.
//
// L1: pure, no I/O, no React.

/** `items` with every key unique: the newest row with a key keeps it, and each older one is `<key>~<n>`. A fresh array;
 *  an item whose key is unchanged is the same object. */
export function uniqueKeys<T extends { readonly key: string }>(items: readonly T[]): T[] {
  const seen = new Map<string, number>();
  const out = items.slice();
  for (let i = out.length - 1; i >= 0; i -= 1) {
    const item = out[i]!;
    const n = seen.get(item.key) ?? 0;
    seen.set(item.key, n + 1);
    if (n > 0) out[i] = { ...item, key: `${item.key}~${n}` };
  }
  return out;
}
