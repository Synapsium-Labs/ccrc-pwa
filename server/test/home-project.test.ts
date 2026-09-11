// The home-project decision, as a pure function, driven over every branch —
// including the one the shipped constant does not currently take. `POST
// /api/runs`'s route test (run-routes.test.ts) proves the LIVE branch; this file
// proves the RULE, and it is the only place the legacy flip can be measured
// before it happens.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HOME_PROJECT_LEGACY_ACCEPTED, homeProjectVerdict, shapeHomeProject } from '../src/coord/routes.js';

describe('homeProjectVerdict', () => {
  it('writes the body home on a programme this box has never seen', () => {
    expect(homeProjectVerdict({ body: 'demo', known: false, stored: null, legacyAccepted: true }))
      .toEqual({ kind: 'write' });
  });

  it('backfills a stored NULL home, first writer wins', () => {
    expect(homeProjectVerdict({ body: 'demo', known: true, stored: null, legacyAccepted: true }))
      .toEqual({ kind: 'backfill', home: 'demo' });
  });

  it('says nothing to do when the stored home already agrees', () => {
    expect(homeProjectVerdict({ body: 'demo', known: true, stored: 'demo', legacyAccepted: true }))
      .toEqual({ kind: 'agrees' });
  });

  it('refuses a differing home and names the STORED one', () => {
    // `by` is the stored value, not the body's: the caller already knows what it
    // sent, and what it needs told is what this programme has said since wave 1.
    expect(homeProjectVerdict({ body: 'other-project', known: true, stored: 'demo', legacyAccepted: true }))
      .toEqual({ kind: 'mismatch', by: 'demo' });
  });

  it('flips on the legacy constant, and BOTH branches are real', () => {
    // THE FLIP, measured before it ships (design §3 F2, §9 wave 3). The route
    // passes `HOME_PROJECT_LEGACY_ACCEPTED` here; wave 3's PR changes that one
    // constant and nothing else, and this case is what says the other branch
    // already works.
    const absent = { body: undefined, known: false, stored: null };
    expect(homeProjectVerdict({ ...absent, legacyAccepted: true })).toEqual({ kind: 'legacy' });
    expect(homeProjectVerdict({ ...absent, legacyAccepted: false })).toEqual({ kind: 'required' });
    // An absent home is decided by the constant ALONE — never by whether the
    // programme is known or what it stores, because the column stays NULL
    // either way and nothing is guessed into it.
    expect(homeProjectVerdict({ body: undefined, known: true, stored: 'demo', legacyAccepted: true }))
      .toEqual({ kind: 'legacy' });
  });

  it("the route's `required` arm answers with a detail — a bare bad-request would be the body-shape guard's own answer", () => {
    // A scan, not a request, because the constant cannot be flipped from here
    // (D-2056) and this branch is dormant until wave 3 flips it: the day it
    // goes live, the one refusal the flip exists to produce must not reach the
    // caller as the same bytes a malformed body gets (CLAUDE.md, "no overloaded
    // null at a seam"). PR #75 review round 1, F3.
    const here = path.dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(path.resolve(here, '../src/coord/routes.ts'), 'utf8');
    const arm = /homeVerdict\.kind === 'required'\) \{[\s\S]{0,700}?reply\.code\(400\)\.send\(\{[^}]*\bdetail: 'homeProject is required'/.exec(src);
    expect(arm, "the `required` arm sends no `detail`").not.toBeNull();
  });

  it('is shipped in the legacy generation — and this is the line wave 3 changes', () => {
    expect(HOME_PROJECT_LEGACY_ACCEPTED).toBe(true);
  });
});

describe('shapeHomeProject', () => {
  // THE ONE SHAPING of a home, at the door of POST /api/runs (PR #75 review
  // round 1, F2 + F4). The first non-NULL home a programme stores is permanent
  // — `setProgramHome` is `WHERE homeProject IS NULL` — and `ledgerAbsPath`
  // joins it under `projectsRoot`, so a value that is trimmed for the check
  // but stored raw homes the programme at `'demo\n'` forever, and a `..`
  // segment names a file outside the projects root.
  it('trims the value it accepts', () => {
    expect(shapeHomeProject(' demo ')).toEqual({ ok: true, home: 'demo' });
    expect(shapeHomeProject('demo\n')).toEqual({ ok: true, home: 'demo' });
    expect(shapeHomeProject('demo')).toEqual({ ok: true, home: 'demo' });
  });

  it('accepts the shapes a project directory name actually takes', () => {
    expect(shapeHomeProject('ccrc-pwa')).toEqual({ ok: true, home: 'ccrc-pwa' });
    expect(shapeHomeProject('demo.v2_x')).toEqual({ ok: true, home: 'demo.v2_x' });
  });

  it('refuses a value that is empty after the trim, with a detail that names the field', () => {
    for (const raw of ['', '   ', '\n']) {
      const r = shapeHomeProject(raw);
      expect(r.ok, JSON.stringify(raw)).toBe(false);
      if (!r.ok) expect(r.detail).toContain('homeProject');
    }
  });

  it('refuses anything that is not a single path segment — a separator, `.`, `..`', () => {
    for (const raw of ['a/b', '../x', '/etc', 'demo/', '.', '..', ' ../x ']) {
      const r = shapeHomeProject(raw);
      expect(r.ok, JSON.stringify(raw)).toBe(false);
      if (!r.ok) expect(r.detail).toContain('homeProject');
    }
  });
});
