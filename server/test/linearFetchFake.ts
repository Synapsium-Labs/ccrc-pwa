/**
 * The one way a test answers as Linear (#1444, spec §6.7). `FetchLike` answers carry `headers`, as `fetch`'s own
 * `Response` does, so `callLinear` can read `Retry-After`; every fake builds its answer through `linearAnswer` rather
 * than spelling the shape, so a field the seam gains later reaches every fake from here.
 *
 * Nothing here reaches the network. The header names are read case-insensitively, as `Headers#get` reads them.
 */
import type { FetchLike } from '../src/linear/client.js';

/** What one `FetchLike` call resolves to. */
export type LinearAnswer = Awaited<ReturnType<FetchLike>>;

/** A response's headers as `Headers#get` reads them: any case, `null` for one Linear did not send. */
export const linearHeaders = (sent: Readonly<Record<string, string>> = {}): LinearAnswer['headers'] => {
  const byName = new Map(Object.entries(sent).map(([k, v]) => [k.toLowerCase(), v]));
  return { get: (name: string) => byName.get(name.toLowerCase()) ?? null };
};

/** An answer of this shape, with these response headers (none when omitted). */
export const linearAnswer = (
  a: Omit<LinearAnswer, 'headers'> & { headers?: Readonly<Record<string, string>> },
): LinearAnswer => ({ ok: a.ok, status: a.status, json: a.json, headers: linearHeaders(a.headers) });
