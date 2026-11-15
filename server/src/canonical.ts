// Overlord W1 (spec 2026-11-09 §7.6, H27): the canonical encodings a hash-chained journal hashes and checks, stated once.
// Ring L1, context K: pure, with no I/O, and `node:crypto` its only import (hashing is a computation, which the server
// ring rule allows in L1). It names no context and no journal: each caller hands in `fail`, which makes the caller's
// OWN error from a refusal's detail, so a refusal keeps its class and its message wherever it is thrown from.
//
// Moved here from `coord/delegation-model.ts`, which binds each function under its old name with its own errors
// (`canonicalDelegationJson`, `delegationSha256Hex`, `parseDelegationInstant`), so no record, hash or message changed.
//
// WHY `rfc8785Json` IS NOT `shared/api.ts#canonicalJson`. That one is the approvals' digest encoder: integer-only, and it
// answers `null` for a value outside its domain. This one is RFC 8785 over a closed domain, and it throws. Two encodings,
// two names, so neither is mistaken for the other and the single-definition scan still sees one `canonicalJson`.
import { createHash } from 'node:crypto';

// ── Canonical JSON (RFC 8785 over a closed domain) ──────────────────────────────────────────────────────────────────

/** A high surrogate not followed by a low one, or a low one not preceded by a high one. UTF-8 cannot carry either, and
 *  `Buffer` would hash both as U+FFFD, so two different strings would share a hash. */
export const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

/** A refusal's detail, made into the caller's own error. */
type Fail = (detail: string) => Error;

const wellFormed = (s: string, where: string, fail: Fail): string => {
  if (LONE_SURROGATE.test(s)) throw fail(`${where} holds a lone surrogate`);
  return s;
};

/** Own keys of an object, with an engine refusal (a Proxy whose `ownKeys` repeats a key throws a TypeError itself)
 *  surfaced as OUR refusal: a repeated input key is rejected before any encoding. */
const ownKeysOf = (o: object, where: string, fail: Fail): Array<string | symbol> => {
  try { return Reflect.ownKeys(o); } catch (err) {
    throw fail(`${where} cannot enumerate its keys (${err instanceof Error ? err.message : String(err)})`);
  }
};

/** UTF-16 code unit order, the order RFC 8785 sorts properties in (the default `<` on strings, not a locale compare). */
const byCodeUnits = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function canon(value: unknown, where: string, ancestors: readonly object[], fail: Fail): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean': return value ? 'true' : 'false';
    case 'string': return JSON.stringify(wellFormed(value, where, fail));
    case 'number':
      if (!Number.isFinite(value)) throw fail(`${where} is not a finite number`);
      if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
        throw fail(`${where} is an integer outside the JavaScript safe range`);
      }
      return JSON.stringify(value);                       // ECMAScript Number-to-String; -0 is "0"
    case 'object': break;
    default: throw fail(`${where} is ${typeof value}, which is outside the JSON domain`);
  }
  const obj: object = value;
  if (ancestors.includes(obj)) throw fail(`${where} is a cycle`);
  const chain = [...ancestors, obj];
  if (Array.isArray(obj)) {
    if (Object.getPrototypeOf(obj) !== Array.prototype) throw fail(`${where} is not a plain array`);
    if (Object.getOwnPropertySymbols(obj).length > 0) throw fail(`${where} has a symbol key`);
    if (Object.keys(obj).length !== obj.length) throw fail(`${where} is a sparse array or has extra properties`);
    const items: string[] = [];
    for (let i = 0; i < obj.length; i++) {
      const d = Object.getOwnPropertyDescriptor(obj, i);
      if (d === undefined || !('value' in d)) throw fail(`${where}[${i}] is not a data element`);
      items.push(canon(d.value, `${where}[${i}]`, chain, fail));
    }
    return `[${items.join(',')}]`;
  }
  const proto = Object.getPrototypeOf(obj) as unknown;
  if (proto !== Object.prototype && proto !== null) throw fail(`${where} is not a plain object`);
  const keys = ownKeysOf(obj, where, fail);
  const names: string[] = [];
  for (const k of keys) {
    if (typeof k === 'symbol') throw fail(`${where} has a symbol key`);
    names.push(k);
  }
  names.sort(byCodeUnits);
  const members: string[] = [];
  for (const k of names) {
    const d = Object.getOwnPropertyDescriptor(obj, k);
    if (d === undefined || !('value' in d) || d.enumerable !== true) {
      throw fail(`${where}.${k} is not an enumerable data property`);
    }
    members.push(`${JSON.stringify(wellFormed(k, `${where} key`, fail))}:${canon(d.value, `${where}.${k}`, chain, fail)}`);
  }
  return `{${members.join(',')}}`;
}

/**
 * RFC 8785 (JSON Canonicalization Scheme) over a closed JSON domain: UTF-8 text without a BOM (the result is a JS string;
 * encode it as UTF-8 to hash or write it), properties sorted by UTF-16 code units at every depth, ECMAScript string
 * escaping and number serialisation, no optional whitespace, lowercase `true`/`false`/`null`.
 *
 * REJECTED before encoding, with `fail(detail)`: an integer outside the safe range, NaN and the infinities, a lone
 * surrogate (in a value or a key), a sparse array or one with extra properties, `undefined`, a bigint, a symbol, a
 * function, any object that is not plain (a class instance, a Date, a Map, an accessor, a symbol key, a non-enumerable
 * property), a cycle, and a Proxy whose keys repeat. No generic JSON writer may stand in for this one: a journal
 * preimage hashed from anything else is a different record.
 */
export function rfc8785Json(value: unknown, fail: (detail: string) => Error): string {
  return canon(value, '$', [], fail);
}

/** Lowercase SHA-256 of the text's UTF-8 bytes. A lone surrogate throws `fail(detail)`. */
export function sha256HexOfText(text: string, fail: (detail: string) => Error): string {
  return createHash('sha256').update(wellFormed(text, 'the hashed text', fail), 'utf8').digest('hex');
}

/** A lowercase 64-hex SHA-256. */
export const isLowerHex64 = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);

// ── The canonical instant ─────────────────────────────────────────────────────────────────────────────────────────────

/** A canonical UTC millisecond instant's text (`2026-10-14T00:15:00.000Z`). */
export const CANONICAL_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** A canonical UTC millisecond instant as epoch milliseconds, between 1970 and year 9999; anything else (no
 *  milliseconds, an offset, a date that rolls over (Feb 30), hour 24) throws `fail(detail)`, and is never normalised. */
export function parseCanonicalInstant(iso: string, fail: (detail: string) => Error): number {
  if (typeof iso !== 'string' || !CANONICAL_INSTANT.test(iso)) {
    throw fail(`${JSON.stringify(iso)} is not a canonical UTC millisecond instant`);
  }
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0 || new Date(ms).toISOString() !== iso) {
    throw fail(`${iso} is not an instant a table can hold`);
  }
  return ms;
}
