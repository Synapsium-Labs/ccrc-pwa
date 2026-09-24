// Design 2026-09-20 §13 (W3 Task 2) — the release notifier's DECISION: which
// tag a release push announces, on which channel, and whether the mark carries
// a push at all. `releaseToNotify` is L1: every case is a value in, a value
// out, so nothing here needs a fixture home, a store or a push double (Task 3
// wires it to all three). And the import block that keeps it L1 is read below.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  releaseToNotify, type NotifyInput, type NotifyNodeRow, type NotifyReleaseRow,
} from '../src/update/notify.js';
import type { NodeRow, ReleaseRow, UpdateIntentRow } from '../src/coord/store.js';
import type { NotifyMode, UpdateChannel } from '../../shared/api.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const T0 = 1_790_000_000_000;

// The store's rows ARE the inputs, structurally — notify.ts imports nothing
// from store.ts, so this is the one place that claim is checked (by
// `typecheck-tests.test.ts`; asserted below so the lines are read). A W2 column
// renamed or retyped under the notifier is a compile error here, not a silent
// `undefined` in production.
const releaseRowFits: [ReleaseRow] extends [NotifyReleaseRow] ? true : never = true;
const nodeRowFits: [NodeRow] extends [NotifyNodeRow] ? true : never = true;
const intentRowFits: [UpdateIntentRow] extends [NonNullable<NotifyInput['fleetIntent']>] ? true : never = true;

const rel = (tag: string, channel: UpdateChannel | null = 'stable', o: Partial<NotifyReleaseRow> = {}): NotifyReleaseRow =>
  ({ tag, channel, bundleListed: true, yanked: false, notifiedAt: null, ...o });
const measured = (currentVersion: string | null): NotifyNodeRow => ({ measuredAt: T0, currentVersion });
/** `markUnreachable`'s label placeholder: a row, never measured. */
const PLACEHOLDER: NotifyNodeRow = { measuredAt: null, currentVersion: null };
const fleet = (notify: NotifyMode, channel: UpdateChannel | null = 'stable'): NotifyInput['fleetIntent'] => ({ notify, channel });
/** The seed intent ('*': stable, notify channel), one stable release, a fleet and a server both behind it. */
const input = (o: Partial<NotifyInput> = {}): NotifyInput => ({
  fleetIntent: fleet('channel'), releases: [rel('v0.0.9')], nodes: [measured('v0.0.7'), measured('v0.0.7')], ...o,
});

describe('releaseToNotify — which tag, on which channel (design 2026-09-20 §13)', () => {
  it('the structural fits hold — the store rows are the inputs', () => {
    expect([releaseRowFits, nodeRowFits, intentRowFits]).toEqual([true, true, true]);
  });

  it('the seed intent announces the newest stable release, with a push, to a fleet behind it', () => {
    expect(releaseToNotify(input())).toEqual({ tag: 'v0.0.9', channel: 'stable', push: true });
  });

  it("notify 'off' decides nothing — there is nothing to mark either", () => {
    expect(releaseToNotify(input({ fleetIntent: fleet('off') }))).toBeNull();
    expect(releaseToNotify(input({ fleetIntent: fleet('off', 'dev'), releases: [rel('v0.0.10', 'dev')] }))).toBeNull();
  });

  it("no '*' row decides nothing — a per-node row is never an input", () => {
    expect(releaseToNotify(input({ fleetIntent: null }))).toBeNull();
  });

  it("notify 'channel' on a channel this build cannot read decides nothing — never the stable default (D-3181)", () => {
    expect(releaseToNotify(input({ fleetIntent: fleet('channel', null) }))).toBeNull();
  });

  it("notify 'stable' skips a newer dev tag, on a dev fleet too (§18 \"notify gates the push\")", () => {
    const releases = [rel('v0.0.10', 'dev'), rel('v0.0.9', 'stable')];
    expect(releaseToNotify(input({ fleetIntent: fleet('stable', 'dev'), releases })))
      .toEqual({ tag: 'v0.0.9', channel: 'stable', push: true });
    expect(releaseToNotify(input({ fleetIntent: fleet('stable', 'stable'), releases })))
      .toEqual({ tag: 'v0.0.9', channel: 'stable', push: true });
    // …and with only dev releases listed there is nothing on stable to announce.
    expect(releaseToNotify(input({ fleetIntent: fleet('stable', 'dev'), releases: [rel('v0.0.10', 'dev')] }))).toBeNull();
  });

  it("notify 'channel' on dev announces the newest of either channel — a stable release counts on dev (§9)", () => {
    expect(releaseToNotify(input({ fleetIntent: fleet('channel', 'dev'),
      releases: [rel('v0.0.10', 'dev'), rel('v0.0.9', 'stable')] })))
      .toEqual({ tag: 'v0.0.10', channel: 'dev', push: true });
    expect(releaseToNotify(input({ fleetIntent: fleet('channel', 'dev'),
      releases: [rel('v0.0.11', 'stable'), rel('v0.0.10', 'dev')] })))
      .toEqual({ tag: 'v0.0.11', channel: 'dev', push: true });
  });

  it("notify 'channel' on stable skips a dev tag", () => {
    expect(releaseToNotify(input({ releases: [rel('v0.0.10', 'dev'), rel('v0.0.9', 'stable')] })))
      .toEqual({ tag: 'v0.0.9', channel: 'stable', push: true });
  });

  it('an ineligible newest row is never the candidate — yanked, bundle not listed, or a channel this build cannot read', () => {
    for (const over of [{ yanked: true }, { bundleListed: false }, { channel: null }] as const) {
      const releases = [rel('v0.0.10', 'stable', over), rel('v0.0.9')];
      expect(releaseToNotify(input({ releases })), JSON.stringify(over)).toEqual({ tag: 'v0.0.9', channel: 'stable', push: true });
    }
    expect(releaseToNotify(input({ releases: [rel('v0.0.9', 'stable', { yanked: true })] }))).toBeNull();
    expect(releaseToNotify(input({ releases: [] }))).toBeNull();
  });

  it('tag order is semver, never string order: v0.0.10 is newer than v0.0.9, in either list order', () => {
    expect(releaseToNotify(input({ releases: [rel('v0.0.9'), rel('v0.0.10')] }))?.tag).toBe('v0.0.10');
    expect(releaseToNotify(input({ releases: [rel('v0.0.10'), rel('v0.0.9')] }))?.tag).toBe('v0.0.10');
  });

  it('a candidate already notified decides nothing — even when an OLDER eligible tag was never announced', () => {
    const releases = [rel('v0.0.10', 'stable', { notifiedAt: T0 }), rel('v0.0.9')];
    expect(releaseToNotify(input({ releases }))).toBeNull();
    // The control: the same list with the candidate unmarked decides the candidate.
    expect(releaseToNotify(input({ releases: [rel('v0.0.10'), rel('v0.0.9')] })))
      .toEqual({ tag: 'v0.0.10', channel: 'stable', push: true });
  });
});

describe('push, or mark only (D-3294, D-3300)', () => {
  it('a current fleet: marked, not pushed — every measured node runs the candidate', () => {
    expect(releaseToNotify(input({ nodes: [measured('v0.0.9'), measured('v0.0.9')] })))
      .toEqual({ tag: 'v0.0.9', channel: 'stable', push: false });
  });

  it('a node already PAST the candidate (a hand-deployed newer build) counts as current', () => {
    expect(releaseToNotify(input({ nodes: [measured('v0.0.10'), measured('v0.0.9')] })))
      .toEqual({ tag: 'v0.0.9', channel: 'stable', push: false });
  });

  it('one node behind is enough to push', () => {
    expect(releaseToNotify(input({ nodes: [measured('v0.0.9'), measured('v0.0.8')] }))?.push).toBe(true);
  });

  it('an unversioned node (currentVersion null) is behind — nothing proves it current', () => {
    expect(releaseToNotify(input({ nodes: [measured('v0.0.9'), measured(null)] }))?.push).toBe(true);
  });

  it('a currentVersion that is not a tag is behind, and never reaches the comparator (which throws on it)', () => {
    for (const v of ['0.0.9', 'v0.0', 'garbage', '']) {
      expect(releaseToNotify(input({ nodes: [measured('v0.0.9'), measured(v)] }))?.push, v).toBe(true);
    }
  });

  it('the behind test is semver too: a node on v0.0.9 is behind v0.0.10', () => {
    expect(releaseToNotify(input({ releases: [rel('v0.0.10')], nodes: [measured('v0.0.10'), measured('v0.0.9')] })))
      .toEqual({ tag: 'v0.0.10', channel: 'stable', push: true });
  });

  it('no measured node: no decision, nothing to mark — the empty fleet and the placeholder-only fleet alike', () => {
    expect(releaseToNotify(input({ nodes: [] }))).toBeNull();
    expect(releaseToNotify(input({ nodes: [PLACEHOLDER] }))).toBeNull();
    expect(releaseToNotify(input({ nodes: [PLACEHOLDER, PLACEHOLDER] }))).toBeNull();
  });

  it('a placeholder row is not an unversioned node — beside a current measured node the tag is marked, not pushed', () => {
    expect(releaseToNotify(input({ nodes: [measured('v0.0.9'), PLACEHOLDER] })))
      .toEqual({ tag: 'v0.0.9', channel: 'stable', push: false });
  });
});

describe('the ring (design 2026-09-20 §6; the update ring scan in single-definition.test.ts)', () => {
  it('notify.ts imports only shared/api, shared/semver and the L1 resolver — no fs, no store, no push', () => {
    const src = readFileSync(path.join(here, '..', 'src', 'update', 'notify.ts'), 'utf8');
    const specs = [...src.matchAll(/^\s*(?:import|export)\b[^;]*?\bfrom\s+'([^']+)'|^\s*import\s+'([^']+)'/gm)]
      .map((m) => m[1] ?? m[2]);
    expect(specs.length).toBeGreaterThan(0);
    expect(new Set(specs)).toEqual(new Set(['../../../shared/api.js', '../../../shared/semver.js', './resolve.js']));
    expect(/\brequire\(|import\(/.test(src)).toBe(false);
  });
});
