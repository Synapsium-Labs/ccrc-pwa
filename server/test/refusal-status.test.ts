// D-5381 (audit ticket #547, ARCH-11a): one status per route refusal word, held in
// `shared/refusal.ts`'s `REFUSAL_STATUS`, consulted by the typed refuse
// helpers instead of a status argument; every word a route sends as a literal
// declared there; and a may-only-shrink ratchet on inline literal sends.
//
// Every scan below reads the SHIPPED source text under `server/src`, so the
// predicates are written here, in the test, and nowhere else.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyReply } from 'fastify';
import { GENERIC_REFUSALS, REFUSAL_STATUS, ROUTE_REFUSALS, type RouteRefusal } from '../../shared/refusal.js';
import { CLAIM_REFUSALS } from '../../shared/box-token.js';
import { refuseRoute } from '../src/refuse.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(here, '..', 'src');

function sources(): { rel: string; text: string }[] {
  const out: { rel: string; text: string }[] = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.ts')) out.push({ rel: path.relative(SRC, p).split(path.sep).join('/'), text: readFileSync(p, 'utf8') });
    }
  };
  walk(SRC);
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}

/** Index just past the `close` that balances the `open` at `i`, skipping
 *  string and template literals; -1 when it never balances. */
function balanced(t: string, i: number, open: string, close: string): number {
  let depth = 0; let quote: string | null = null;
  for (let j = i; j < t.length; j++) {
    const c = t[j];
    if (quote) { if (c === '\\') { j++; continue; } if (c === quote) quote = null; continue; }
    if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
    if (c === open) depth++;
    else if (c === close && --depth === 0) return j + 1;
  }
  return -1;
}

/** One refusal send: `.code(S)` or `.status(S)`, any `.header(…)` chain, then
 *  `.send({ … })` whose object literal holds `ok: false` at any key position.
 *  `status` is the literal number, or null when `S` is computed; `word` is the
 *  first `error: '<literal>'` anywhere in the body, or null. */
interface Send { line: number; arg: string; status: number | null; word: string | null; body: string }

/** THE RATCHET'S PREDICATE (D-5381), widened on review: the bare
 *  `.code(N).send({ ok: false, error: '…'` regex missed header chains,
 *  `.status(N)` and an `error` key that is not second. */
function refusalSends(text: string): Send[] {
  const out: Send[] = [];
  for (const m of text.matchAll(/\.(?:code|status)\(/g)) {
    const open = (m.index ?? 0) + m[0].length - 1;
    const argEnd = balanced(text, open, '(', ')');
    if (argEnd < 0) continue;
    let k = argEnd;
    for (;;) {
      const h = /^\s*\.header\(/.exec(text.slice(k, k + 200));
      if (!h) break;
      const end = balanced(text, k + h[0].length - 1, '(', ')');
      if (end < 0) break;
      k = end;
    }
    const s = /^\s*\.send\(\s*\{/.exec(text.slice(k, k + 200));
    if (!s) continue;
    const bodyAt = k + s[0].length - 1;
    const bodyEnd = balanced(text, bodyAt, '{', '}');
    if (bodyEnd < 0) continue;
    const body = text.slice(bodyAt, bodyEnd);
    if (!/\bok:\s*false\b/.test(body)) continue;
    const arg = text.slice(open + 1, argEnd - 1).trim();
    out.push({
      line: text.slice(0, m.index).split('\n').length,
      arg,
      status: /^\d{3}$/.test(arg) ? Number(arg) : null,
      word: /\berror:\s*'([^']+)'/.exec(body)?.[1] ?? null,
      body,
    });
  }
  return out;
}
/** A computed status that IS a table: the helpers' own one send each —
 *  `refuseRun`'s `RUN_REFUSAL_STATUS` included (D-5384). */
const TABLE_STATUS = /^(?:RUN_)?REFUSAL_STATUS\[/;
/** A `refuseRoute` call naming its word as a literal. */
const HELPER_WORD = /\brefuseRoute\(\s*reply\s*,\s*'([^']+)'/g;

/** Measured on landing day (D-5381). MAY ONLY SHRINK: a file whose count
 *  falls lowers its pin in the same change; a new inline send is red — answer
 *  it with `refuseRoute` (or a file's typed helper) instead. Counts every
 *  literal-status refusal send, whatever its body's key order or headers. */
const INLINE_SEND_PINS: Readonly<Record<string, number>> = {
  'auth/gate.ts': 2,
  'coord/routes.ts': 153,  // D-5384: the open route's 24 precondition, child-gate, openRun-conflict and hold-verb sends answer through refuseRoute/refuseRun
  'server.ts': 130,
  'token/routes.ts': 2,   // the rotate route's 501, a `RotateAnswer`; the claim door's oversized-body 413
};

/** Refusal sends whose status is computed and is not the table. MAY ONLY
 *  SHRINK, like the literal pins: a ternary status is no escape hatch. */
const COMPUTED_SEND_PINS: Readonly<Record<string, number>> = {
  'coord/routes.ts': 2,
  'server.ts': 6,
};

/** The measured disagreements with the table, each counted (D-5381). The
 *  computed sends' words are not literal, so the 503 `registry-unmeasurable`
 *  ternaries are counted on their own below. */
const ALLOWED_SPLITS: readonly { file: string; word: string; status: number; count: number }[] = [
  // registry-unmeasurable: 502 in coord/routes.ts (the table), 503 in server.ts until #549 (ARCH-11b) unifies it.
  { file: 'server.ts', word: 'registry-unmeasurable', status: 503, count: 4 },
  // The lockout: `unauthenticated` with verdict `locked-out` and a retry-after header.
  { file: 'server.ts', word: 'unauthenticated', status: 429, count: 3 },
  // Fastify's own oversized-body 413, reshaped into the small claim body (spec 4.6).
  { file: 'token/routes.ts', word: 'bad-request', status: 413, count: 1 },
];
/** server.ts's `read.reason === 'unlistable' ? 503 : 404` sends, whose word is
 *  the matching `'registry-unmeasurable' : 'unknown-session'` ternary. */
const COMPUTED_REGISTRY_UNMEASURABLE_503 = 4;

describe('REFUSAL_STATUS (D-5381)', () => {
  it('maps every route refusal word to exactly one HTTP error status', () => {
    expect(new Set(ROUTE_REFUSALS).size).toBe(ROUTE_REFUSALS.length);
    for (const w of ROUTE_REFUSALS) {
      const s = REFUSAL_STATUS[w];
      expect(Number.isInteger(s) && s >= 400 && s <= 599, `${w} → ${s}`).toBe(true);
    }
    // Spot rows the helpers' callers rely on — one per helper family.
    expect(REFUSAL_STATUS['stale-uuid']).toBe(403);         // mail
    expect(REFUSAL_STATUS['code-expired']).toBe(410);       // claim door
    expect(REFUSAL_STATUS['auto-needs-rollback-gate']).toBe(409);   // update
    expect(REFUSAL_STATUS['unknown-session']).toBe(404);    // generic
    expect(REFUSAL_STATUS['write-failed']).toBe(503);       // collect lane
    expect(REFUSAL_STATUS['sign-in-unarmed']).toBe(403);    // collect lane
  });

  it('holds every claim refusal (the claim door answers each one through the table)', () => {
    for (const w of CLAIM_REFUSALS) expect(ROUTE_REFUSALS).toContain(w);
  });

  it('every literal inline refusal still answers its word\'s status — the three measured splits excepted, counted', () => {
    const splits = new Map<string, number>();
    const wrong: string[] = [];
    for (const { rel, text } of sources()) {
      for (const { status, word } of refusalSends(text)) {
        if (status === null || word === null) continue;
        if (!(ROUTE_REFUSALS as string[]).includes(word)) { wrong.push(`${rel}: '${word}' is declared in no RouteRefusal`); continue; }
        if (REFUSAL_STATUS[word as RouteRefusal] === status) continue;
        const allowed = ALLOWED_SPLITS.find((a) => a.file === rel && a.word === word && a.status === status);
        if (allowed) { const k = `${rel}|${word}`; splits.set(k, (splits.get(k) ?? 0) + 1); continue; }
        wrong.push(`${rel}: '${word}' answered ${status}, the table says ${REFUSAL_STATUS[word as RouteRefusal]}`);
      }
    }
    expect(wrong).toEqual([]);
    expect(Object.fromEntries(splits)).toEqual(Object.fromEntries(ALLOWED_SPLITS.map((a) => [`${a.file}|${a.word}`, a.count])));
  });

  it('server.ts\'s computed 503 registry-unmeasurable sends are counted — eight 503s in all with the literal four', () => {
    const text = sources().find((s) => s.rel === 'server.ts')!.text;
    const ternaries = refusalSends(text).filter((s) =>
      /^read\.reason === 'unlistable' \? 503 : 404$/.test(s.arg)
      && /error:\s*read\.reason === 'unlistable' \? 'registry-unmeasurable' : 'unknown-session'/.test(s.body));
    expect(ternaries.length).toBe(COMPUTED_REGISTRY_UNMEASURABLE_503);
  });

  it('every GenericRefusal is still sent by some route — a dead word leaves the list', () => {
    const sent = new Set<string>();
    for (const { text } of sources()) {
      for (const { word } of refusalSends(text)) if (word !== null) sent.add(word);
      for (const m of text.matchAll(HELPER_WORD)) sent.add(m[1]);
    }
    expect(GENERIC_REFUSALS.filter((w) => !sent.has(w))).toEqual([]);
  });
});

describe('the typed refuse helpers take no status (D-5381)', () => {
  const read = (rel: string): string => readFileSync(path.join(SRC, rel), 'utf8');

  it('no helper call passes a status, literal or computed', () => {
    const hits: string[] = [];
    for (const rel of ['token/routes.ts', 'update/routes.ts', 'coord/routes.ts']) {
      for (const m of read(rel).matchAll(/\b(refuse|collectRefuse)\(\s*reply\s*,\s*([^,)]+)/g)) {
        const arg = m[2].trim();
        if (/^\d/.test(arg) || /(^|\.)(status|code)$/.test(arg) || /\?/.test(arg)) hits.push(`${rel}: ${m[1]}(reply, ${arg}, …)`);
      }
    }
    expect(hits).toEqual([]);
  });

  it('update/routes.ts\'s refusal builders carry no status of their own', () => {
    expect(read('update/routes.ts').match(/\bcode:\s*\d{3}\b/g) ?? []).toEqual([]);
  });

  it('the mail refuse still records the rejection before it answers', () => {
    const text = read('coord/routes.ts');
    const at = text.indexOf('const refuse = (');
    expect(at).toBeGreaterThan(-1);
    const body = text.slice(at, text.indexOf('};', at));
    expect(body).toMatch(/recordRejection\(\{ \.\.\.ctx, code, detail \}\)[\s\S]*REFUSAL_STATUS\[code\]/);
  });
});

describe('refuseRoute (D-5381)', () => {
  function fakeReply(): { reply: FastifyReply; sent: { code?: number; body?: unknown } } {
    const sent: { code?: number; body?: unknown } = {};
    const reply = {
      code(n: number) { sent.code = n; return reply; },
      send(b: unknown) { sent.body = b; return reply; },
    } as unknown as FastifyReply;
    return { reply, sent };
  }

  it('answers the table\'s status with the body an inline send wrote, key order included', () => {
    const { reply, sent } = fakeReply();
    refuseRoute(reply, 'unknown-session', { detail: 'x' });
    expect(sent.code).toBe(404);
    expect(JSON.stringify(sent.body)).toBe(JSON.stringify({ ok: false, error: 'unknown-session', detail: 'x' }));
    const bare = fakeReply();
    refuseRoute(bare.reply, 'not-configured');
    expect(bare.sent.code).toBe(501);
    expect(JSON.stringify(bare.sent.body)).toBe('{"ok":false,"error":"not-configured"}');
  });

  it('refuses a word outside RouteRefusal at compile time (typecheck-tests holds the directive)', () => {
    const { reply } = fakeReply();
    // @ts-expect-error — 'no-such-refusal' is not a RouteRefusal
    refuseRoute(reply, 'no-such-refusal');
    // @ts-expect-error — an extra may not overwrite the word
    refuseRoute(reply, 'gone', { error: 'internal' });
    expect(true).toBe(true);
  });
});

describe('the inline-send ratchet (D-5381) — may only shrink', () => {
  it('each file\'s count of inline refusal sends equals its pin', () => {
    const counts: Record<string, number> = {};
    for (const { rel, text } of sources()) {
      const n = refusalSends(text).filter((s) => s.status !== null).length;
      if (n > 0) counts[rel] = n;
    }
    expect(counts, 'a count that FELL lowers its pin here; one that ROSE is a new inline send — use refuseRoute').toEqual(INLINE_SEND_PINS);
  });

  it('each file\'s count of computed-status refusal sends (the table\'s own excepted) equals its pin', () => {
    const counts: Record<string, number> = {};
    for (const { rel, text } of sources()) {
      const n = refusalSends(text).filter((s) => s.status === null && !TABLE_STATUS.test(s.arg)).length;
      if (n > 0) counts[rel] = n;
    }
    expect(counts, 'a computed status is still an inline send — use refuseRoute').toEqual(COMPUTED_SEND_PINS);
  });

  it('the predicate is live — it counts a send split across lines', () => {
    const sample = "return reply.code(404)\n  .send({\n    ok: false, error: 'gone' });";
    expect(refusalSends(sample).map((s) => [s.status, s.word])).toEqual([[404, 'gone']]);
  });

  it('the predicate is live — a header chain, `.status()`, a later `error` key and a computed status all count', () => {
    const sample = [
      "reply.code(400).header('x-a', 'b').send({ ok: false, error: 'brand-new-word' });",
      "reply.code(429).header('retry-after', String(n))\n  .header('x-b', 'c').send({ ok: false, error: 'unauthenticated', verdict: 'locked-out' });",
      "reply.status(418).send({ ok: false, error: 'unknown-session' });",
      "reply.code(400).send({ error: 'another-new-word', ok: false });",
      "reply.code(cond ? 400 : 409).send({ ok: false, error: 'x' });",
      "reply.code(200).send({ ok: true, error: 'not-a-refusal' });",
      "reply.code(REFUSAL_STATUS[error]).send({ ok: false, error });",
    ].join('\n');
    expect(refusalSends(sample).map((s) => [s.status, s.word])).toEqual([
      [400, 'brand-new-word'], [429, 'unauthenticated'], [418, 'unknown-session'], [400, 'another-new-word'],
      [null, 'x'], [null, null],
    ]);
    expect(refusalSends(sample).filter((s) => s.status === null && !TABLE_STATUS.test(s.arg)).length).toBe(1);
  });
});
