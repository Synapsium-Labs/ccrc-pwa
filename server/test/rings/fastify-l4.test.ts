// D-6045 (plan docs/superpowers/plans/2026-10-19-consolidation-w0-pins.md, Task C0l; ARCH-04 (#545), stage 1).
// RING RULE: `fastify`, `@fastify/*` and every `Fastify*` name (FastifyReply above all) are imported only by the L4
// files `fastify-l4.data.ts` names, across `server/src`, `agent/src`, `pwa/src` and `ui/src`. The 08-10 spec's L1
// says "no `fastify` … **no `reply`**": a decision that can touch the reply can answer HTTP itself, and the refusal
// word, the status and the body stop having one owner.
//
// Every import form counts, a type import included: `import type`, a per-name `type`, `export … from`, a dynamic
// `import('fastify')`, a type query `import('fastify').FastifyReply`, and a `Fastify*` name re-bound from a local
// module. The set is held exactly, so the list can neither grow unseen nor go stale.
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { parseFile, parseSource, type ImportEdge, type ParsedFile } from '../scan/parse.js';
import { FASTIFY_L4_ALLOWLIST } from './fastify-l4.data.js';
import { malformedEntries } from './exemptions.js';
import { REPO, walkSrc } from './walkSrc.js';

const FASTIFY_PKG = /^(?:fastify|@fastify\/.+)$/;
const FASTIFY_NAME = /^Fastify/;

/** The edges by which a file reaches fastify. */
const fastifyEdges = (p: ParsedFile): ImportEdge[] =>
  p.imports.filter((e) => FASTIFY_PKG.test(e.specifier) || e.names.some((n) => FASTIFY_NAME.test(n)));

const files = (): string[] => walkSrc({ roots: ['server/src', 'pwa/src', 'agent/src', 'ui/src'], min: 390 });

describe('fastify is imported only by the L4 allowlist (ARCH-04 stage 1, D-6045)', () => {
  it('CONTROL: the predicate sees every import form, and nothing that is not one', () => {
    const seen = [
      "import type { FastifyReply } from 'fastify';",
      "import Fastify from 'fastify';",
      "import { type FastifyRequest } from 'fastify';",
      "export type { FastifyReply } from 'fastify';",
      "export * from 'fastify';",
      "const f = await import('fastify');",
      "import fastifyStatic from '@fastify/static';",
      "let r: import('fastify').FastifyReply;",
      "type F = typeof import('fastify');",
      "import type { FastifyReply } from './server.js';",
    ];
    for (const src of seen) expect(fastifyEdges(parseSource(src)), src).toHaveLength(1);
    const unseen = [
      "import type { Reply } from './reply.js';",
      "// import type { FastifyReply } from 'fastify';",
      "/** import('fastify').FastifyReply */ const x = 1;",
      "const s = 'fastify';",
      "import { notFastify } from './fastify-like.js';",
    ];
    for (const src of unseen) expect(fastifyEdges(parseSource(src)), src).toEqual([]);
  });

  it('CONTROL: the walk has a floor, and a walk over the wrong tree throws', () => {
    expect(() => walkSrc({ roots: ['server/src'], min: 1_000_000 })).toThrow(/below the floor/);
    expect(files()).toContain('server/src/coord/close.ts');
    for (const root of ['pwa/src/', 'agent/src/', 'ui/src/']) {
      expect(files().some((f) => f.startsWith(root)), root).toBe(true);
    }
  });

  it('CONTROL: an entry needs a one-line reason and a real date, not in the future', () => {
    const today = new Date('2026-10-20T12:00:00Z');
    expect(malformedEntries({ a: { reason: 'why', since: '2026-10-20' } }, today)).toEqual([]);
    expect(malformedEntries({
      blank: { reason: ' ', since: '2026-10-20' },
      lines: { reason: 'one\ntwo', since: '2026-10-20' },
      bad: { reason: 'why', since: '2026-02-30' },
      shape: { reason: 'why', since: '20 Oct 2026' },
      later: { reason: 'why', since: '2026-10-21' },
    }, today)).toEqual([
      'blank: the reason must be one non-empty line',
      'lines: the reason must be one non-empty line',
      "bad: since '2026-02-30' is not a YYYY-MM-DD day",
      "shape: since '20 Oct 2026' is not a YYYY-MM-DD day",
      "later: since '2026-10-21' is in the future",
    ]);
  });

  it('every allowlist entry has a reason and a date', () => {
    expect(malformedEntries(FASTIFY_L4_ALLOWLIST)).toEqual([]);
  });

  it('the files that reach fastify are exactly the allowlist', () => {
    const importers = new Map<string, string[]>();
    for (const f of files()) {
      const edges = fastifyEdges(parseFile(path.join(REPO, f)));
      if (edges.length > 0) importers.set(f, edges.map((e) => `:${e.line} ${e.specifier} {${e.names.join(', ')}}`));
    }
    const allowed = new Set(Object.keys(FASTIFY_L4_ALLOWLIST));
    const notAllowed = [...importers].filter(([f]) => !allowed.has(f)).map(([f, e]) => `${f} ${e.join('; ')}`);
    const stale = [...allowed].filter((f) => !importers.has(f));
    expect(notAllowed, 'a file outside the L4 allowlist reaches fastify: give it a port (ARCH-05), or, if it is '
      + 'an L4 delivery file, an entry with its reason in fastify-l4.data.ts').toEqual([]);
    expect(stale, 'an allowlist entry no longer reaches fastify: delete it').toEqual([]);
  });
});
