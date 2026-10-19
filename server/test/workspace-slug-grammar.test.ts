// The dispatch body's optional `slug` is refused at the server ingress against
// `WORKSPACE_SLUG_RE` so a bad name never reaches the fleet — but the authority
// is ccd's own `_ws_slug_valid`, the grammar `cmd_ws_add` enforces. Two spellings
// of one rule drift silently unless something holds them equal: this does, by
// reading the shipped `ccd/ccd` text rather than a copy of it.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { WORKSPACE_SLUG_RE } from '../../shared/api.js';
import { CCD } from './ccdWsHelpers.js';

describe('workspace slug grammar', () => {
  it('WORKSPACE_SLUG_RE is exactly ccd\'s _ws_slug_valid pattern', () => {
    const m = /^_ws_slug_valid\(\) \{ \[\[ "\$1" =~ (\S+) ]]; \}$/m.exec(readFileSync(CCD, 'utf8'));
    expect(m, '_ws_slug_valid not found in ccd/ccd in its one-line form').not.toBeNull();
    expect(WORKSPACE_SLUG_RE.source).toBe(m![1]);
  });
});
