// Docs W8a Task 7: the shared Markdown library's frame assets as ccrc loads them (`docs/reader/assets.ts`) and the
// numbers the frame's policy and bridge carry (M8.2, M8.12, the spec's section 4.4 and 4.6 constants). These cases pin
// the INSTALLED library's own values against the spec's literals, which is the point of them: a library bump that
// moves one reds here, not in a browser.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import {
  BRIDGE_LIMITS, BRIDGE_PROTOCOL, ERROR_WHY, FRAME_MANIFEST, MERMAID_GATE_DEFAULTS, PREF_KEYS, frameCsp,
} from '@synapsium-labs/docserver/frame';
import { READER_IMAGE_BUDGET_BYTES } from '../src/lib/readerLimits';
import { loadMermaidAsset, loadReaderAssets } from '../src/docs/reader/assets';

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

/** frameCsp() re-tokenised: directive name to its source list, in order. */
function directives(csp: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const part of csp.split(';')) {
    const tokens = part.trim().split(/\s+/).filter((t) => t !== '');
    if (tokens.length === 0) continue;
    out[tokens[0]!] = tokens.slice(1);
  }
  return out;
}

const csp = (): Record<string, string[]> => directives(frameCsp());

describe('the asset texts', () => {
  it('each asset text\'s sha256 equals FRAME_MANIFEST\'s entry', async () => {
    const a = await loadReaderAssets();
    const mermaid = await loadMermaidAsset();
    expect(sha256(a.guard)).toBe(FRAME_MANIFEST.guard.sha256);
    expect(sha256(a.bootstrap)).toBe(FRAME_MANIFEST.bootstrap.sha256);
    expect(sha256(a.enhance)).toBe(FRAME_MANIFEST.enhance.sha256);
    expect(sha256(a.css)).toBe(FRAME_MANIFEST.css.sha256);
    expect(sha256(mermaid)).toBe(FRAME_MANIFEST.mermaid.sha256);
  }, 60_000);

  it('each asset\'s ?raw specifier is its manifest path', () => {
    const file = path.join(__dirname, '..', 'src', 'docs', 'reader', 'assets.ts');
    const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const specifiers: string[] = [];
    const walk = (n: ts.Node): void => {
      if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const arg = n.arguments[0];
        specifiers.push(arg !== undefined && ts.isStringLiteralLike(arg) ? arg.text : '<not a literal>');
      }
      ts.forEachChild(n, walk);
    };
    walk(sf);
    const want = (['guard', 'bootstrap', 'enhance', 'css', 'mermaid'] as const)
      .map((k) => `@synapsium-labs/docserver/assets/${FRAME_MANIFEST[k].path}?raw`);
    expect(specifiers).toHaveLength(5);
    expect([...specifiers].sort()).toEqual([...want].sort());
  });
});

describe('the frame policy (M8.2, M8.12)', () => {
  it('frameCsp\'s script-src hashes are the manifest\'s csp sources for guard, bootstrap, enhance and Mermaid', () => {
    expect([...csp()['script-src']!].sort()).toEqual(
      [FRAME_MANIFEST.guard.csp, FRAME_MANIFEST.bootstrap.csp, FRAME_MANIFEST.enhance.csp, FRAME_MANIFEST.mermaid.csp].sort(),
    );
  });

  it('M8.2: frameCsp re-tokenised has exactly the listed directives', () => {
    expect(Object.keys(csp()).sort()).toEqual(
      ['base-uri', 'default-src', 'font-src', 'form-action', 'img-src', 'script-src', 'style-src'],
    );
    expect(csp()['default-src']).toEqual(["'none'"]);
  });

  it('M8.2: script-src holds sha256 sources only', () => {
    for (const s of csp()['script-src']!) expect(s).toMatch(/^'sha256-[A-Za-z0-9+/]+={0,2}'$/);
  });

  it('M8.2: no host, self, unsafe-eval, connect-src or frame-src', () => {
    const all = csp();
    expect(Object.keys(all)).not.toContain('connect-src');
    expect(Object.keys(all)).not.toContain('frame-src');
    for (const tokens of Object.values(all)) {
      for (const t of tokens) {
        expect(t).not.toMatch(/^https?:|^\/\/|\*|\.[a-z]/i);
        expect(t).not.toBe("'self'");
        expect(t).not.toBe("'unsafe-eval'");
      }
    }
  });

  it('M8.2: base-uri and form-action are none; img-src and font-src are data: only', () => {
    expect(csp()['base-uri']).toEqual(["'none'"]);
    expect(csp()['form-action']).toEqual(["'none'"]);
    expect(csp()['img-src']).toEqual(['data:']);
    expect(csp()['font-src']).toEqual(['data:']);
  });

  it('M8.2: the re-tokenised policy is exactly this map', () => {
    // The order is the order frameCsp() emits, measured at Step 0: guard, bootstrap, enhance, then Mermaid.
    expect(csp()).toEqual({
      'default-src': ["'none'"],
      'script-src': [FRAME_MANIFEST.guard.csp, FRAME_MANIFEST.bootstrap.csp, FRAME_MANIFEST.enhance.csp, FRAME_MANIFEST.mermaid.csp],
      'style-src': ["'unsafe-inline'", 'data:'],
      'font-src': ['data:'],
      'img-src': ['data:'],
      'base-uri': ["'none'"],
      'form-action': ["'none'"],
    });
  });
});

describe('the spec\'s numbers, as the installed library carries them', () => {
  it('the bridge constants are the spec\'s numbers', () => {
    expect(BRIDGE_LIMITS).toMatchObject({
      bucketCapacity: 40, bucketRefillPerSecond: 20, storeSetBucketCapacity: 10, storeSetRefillPerSecond: 10,
      changesInFlight: 1, coalesceMs: 250, refusalsToClose: 16, valueMaxBytes: 65536, copyMaxBytes: 65536,
      hashMaxCodeUnits: 256, storeBudgetBytes: 1048576,
    });
    expect(BRIDGE_PROTOCOL).toBe(1);
    expect([...ERROR_WHY].sort()).toEqual(['assets', 'boot', 'mermaid', 'protocol', 'render']);
    expect([...PREF_KEYS]).toEqual(['prefs', 'ui']);
  });

  it('the Mermaid gate defaults are the spec\'s 24, 16384 and 131072', () => {
    expect(MERMAID_GATE_DEFAULTS).toEqual({ maxFences: 24, maxFenceChars: 16384, maxTotalChars: 131072 });
  });

  it('READER_IMAGE_BUDGET_BYTES is the spec\'s 5 MiB or lower', () => {
    expect(READER_IMAGE_BUDGET_BYTES).toBeLessThanOrEqual(5 * 1024 * 1024);
    expect(READER_IMAGE_BUDGET_BYTES).toBeGreaterThan(0);
  });
});
