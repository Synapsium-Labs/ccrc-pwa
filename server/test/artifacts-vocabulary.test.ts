// The artifact tier's L0 vocabulary (native Docs HTML artifacts X5, plan Task A1.1).
import { describe, it, expect } from 'vitest';
import { DOCS_RASTER_EXT, DOCS_RASTER_TYPES } from '../../shared/docs.js';
import { CAPABILITY_TOKEN_CHARS, CAPABILITY_TOKEN_RE, isCapabilityToken } from '../../shared/capabilityToken.js';
import { CLAIM_CODE_RE, isClaimCode } from '../../shared/agent-protocol.js';
import {
  ARTIFACT_MIME, ARTIFACT_OFF_WHYS, ARTIFACT_PUBLIC_SUFFIXES, ARTIFACT_REFUSALS, ARTIFACT_SANDBOX_BASE, ARTIFACT_SANDBOX_WINDOWS, artifactMime,
} from '../../shared/artifacts.js';

describe('artifact L0 vocabulary (X5 A1.1)', () => {
  it('isCapabilityToken takes exactly 43 base64url characters', () => {
    expect(CAPABILITY_TOKEN_CHARS).toBe(43);
    expect(isCapabilityToken('A'.repeat(43))).toBe(true);
    expect(isCapabilityToken('a-_Z0'.repeat(8) + 'abc')).toBe(true);
    expect(isCapabilityToken('A'.repeat(42))).toBe(false);
    expect(isCapabilityToken('A'.repeat(44))).toBe(false);
    for (const c of ['+', '/', '=']) expect(isCapabilityToken('A'.repeat(42) + c)).toBe(false);
  });

  it('the box-token claim code is the same grammar, defined once (X5 A2)', () => {
    // The same object, not an equal copy: a literal regex back in `shared/agent-protocol.ts` is red here.
    expect(CLAIM_CODE_RE).toBe(CAPABILITY_TOKEN_RE);
    expect(isClaimCode('A'.repeat(43))).toBe(true);
    expect(isClaimCode('A'.repeat(42))).toBe(false);
  });

  it('artifactMime answers from the table, and attaches what it does not know', () => {
    expect(artifactMime('m.glb')).toEqual({ mime: 'model/gltf-binary', attachment: false });
    expect(artifactMime('x.exe')).toEqual({ mime: 'application/octet-stream', attachment: true });
    expect(artifactMime('A.WASM')).toEqual({ mime: 'application/wasm', attachment: false });
    expect(artifactMime('x.bin')).toEqual({ mime: 'application/octet-stream', attachment: false });
    expect(artifactMime('noext')).toEqual({ mime: 'application/octet-stream', attachment: true });
    expect(artifactMime('d/.hidden')).toEqual({ mime: 'application/octet-stream', attachment: true });
    expect(artifactMime('a.b/c')).toEqual({ mime: 'application/octet-stream', attachment: true });
    expect(artifactMime('x.constructor')).toEqual({ mime: 'application/octet-stream', attachment: true });
  });

  it('every raster row equals DOCS_RASTER_TYPES mime', () => {
    for (const [ext, type] of Object.entries(DOCS_RASTER_EXT)) {
      expect(ARTIFACT_MIME[ext]).toBe(DOCS_RASTER_TYPES[type].mime);
    }
  });

  it('vocabulary: base never holds `allow-popups`', () => {
    for (const bad of ['allow-top-navigation', 'allow-popups-to-escape-sandbox', 'allow-popups']) {
      expect(ARTIFACT_SANDBOX_BASE).not.toContain(bad);
    }
    // Pinned exactly, in the plan's order, so no other token (a top-navigation variant included) can join it.
    expect(ARTIFACT_SANDBOX_BASE).toEqual([
      'allow-scripts', 'allow-same-origin', 'allow-forms', 'allow-modals', 'allow-downloads', 'allow-pointer-lock',
    ]);
    expect(ARTIFACT_SANDBOX_WINDOWS).toBe('allow-popups');
  });

  it('the policy tables are frozen at run time', () => {
    expect(Object.isFrozen(ARTIFACT_MIME)).toBe(true);
    expect(Object.isFrozen(ARTIFACT_SANDBOX_BASE)).toBe(true);
    expect(Object.isFrozen(ARTIFACT_PUBLIC_SUFFIXES)).toBe(true);
  });

  it("vocabulary: the accept list is exactly `['duckdns.org']`", () => {
    expect(ARTIFACT_PUBLIC_SUFFIXES).toEqual(['duckdns.org']);
  });

  it('the refusals and the off words are exactly the union members', () => {
    expect([...ARTIFACT_REFUSALS]).toEqual([
      'auth-off', 'insecure-origin', 'unauthenticated', 'unsupported', 'artifact-host-unset', 'artifact-listener-down',
      'not-html', 'too-many', 'bad-origin', 'unmeasured', 'pin-moved', 'page-too-large', 'draft-too-large',
    ]);
    expect([...ARTIFACT_OFF_WHYS]).toEqual(['unset', 'partial', 'invalid', 'by-address', 'auth-off', 'listener-down']);
  });
});
