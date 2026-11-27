import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { generate, OUT } from '../../core/gen/vocab.mjs';

// The Go core's vocabulary is generated from its owners (spec 2026-11-24 §5), as the PWA's palettes are from their
// seeds (`themes:check`): a value changed in its owner and not regenerated here is red, never a Go copy that drifts.
describe('core/internal/kernel/vocab/vocab_gen.go: the generated vocabulary', () => {
  it('is exactly what core/gen/vocab.mjs writes from the owners today', async () => {
    const committed = fs.readFileSync(path.resolve(__dirname, '../..', OUT), 'utf8');
    const now = await generate();
    if (committed !== now) {
      expect(committed, `${OUT} is stale: run \`node core/gen/vocab.mjs\` and commit the result`).toBe(now);
    }
  }, 120_000);
});
