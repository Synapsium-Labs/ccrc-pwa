// D-5381 (audit ticket ARCH-11a): one status per route refusal word, held in
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

/** THE RATCHET'S PREDICATE: an inline refusal send is a numeric status literal
 *  handed straight to `send` with an `ok: false` body, line breaks allowed. */
const INLINE_SEND = /\.code\(\s*\d{3}\s*\)\s*\.send\(\s*\{\s*ok:\s*false\b/g;
/** The same send whose `error` is a string literal, capturing status and word. */
const INLINE_WORD = /\.code\(\s*(\d{3})\s*\)\s*\.send\(\s*\{\s*ok:\s*false\s*,\s*error:\s*'([^']+)'/g;
/** A `refuseRoute` call naming its word as a literal. */
const HELPER_WORD = /\brefuseRoute\(\s*reply\s*,\s*'([^']+)'/g;

/** Measured on landing day (D-5381). MAY ONLY SHRINK: a file whose count
 *  falls lowers its pin in the same change; a new inline send is red — answer
 *  it with `refuseRoute` (or a file's typed helper) instead. */
const INLINE_SEND_PINS: Readonly<Record<string, number>> = {
  'auth/gate.ts': 2,
  'coord/routes.ts': 177,
  'server.ts': 123,
  'token/routes.ts': 1,   // the rotate route's 501, a `RotateAnswer`
};

/** The one measured disagreement with the table (audit ticket ARCH-11b unifies it):
 *  `server.ts` answers `registry-unmeasurable` with 503, three times. */
const ALLOWED_SPLITS: readonly { file: string; word: string; status: number; count: number }[] = [
  { file: 'server.ts', word: 'registry-unmeasurable', status: 503, count: 3 },
];

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
  });

  it('holds every claim refusal (the claim door answers each one through the table)', () => {
    for (const w of CLAIM_REFUSALS) expect(ROUTE_REFUSALS).toContain(w);
  });

  it('every literal inline refusal still answers its word\'s status — the one allowed split excepted, counted', () => {
    const splits = new Map<string, number>();
    const wrong: string[] = [];
    for (const { rel, text } of sources()) {
      for (const m of text.matchAll(INLINE_WORD)) {
        const status = Number(m[1]); const word = m[2];
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

  it('every GenericRefusal is still sent by some route — a dead word leaves the list', () => {
    const sent = new Set<string>();
    for (const { text } of sources()) {
      for (const m of text.matchAll(INLINE_WORD)) sent.add(m[2]);
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
      for (const m of read(rel).matchAll(/\brefuse\(\s*reply\s*,\s*([^,)]+)/g)) {
        const arg = m[1].trim();
        if (/^\d/.test(arg) || /(^|\.)(status|code)$/.test(arg) || /\?/.test(arg)) hits.push(`${rel}: refuse(reply, ${arg}, …)`);
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
      const n = (text.match(INLINE_SEND) ?? []).length;
      if (n > 0) counts[rel] = n;
    }
    expect(counts, 'a count that FELL lowers its pin here; one that ROSE is a new inline send — use refuseRoute').toEqual(INLINE_SEND_PINS);
  });

  it('the predicate is live — it counts a send split across lines', () => {
    const sample = "return reply.code(404)\n  .send({\n    ok: false, error: 'gone' });";
    expect(sample.match(INLINE_SEND)?.length).toBe(1);
    expect([...sample.matchAll(INLINE_WORD)].map((m) => [m[1], m[2]])).toEqual([['404', 'gone']]);
  });
});
