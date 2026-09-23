// The §9 resolver table (design 2026-09-20): channel resolution, eligibility,
// the floor, the pin, the sentences, both desireds, the auto-gate predicate —
// and the import block that keeps this file's subject L1. Every case is a
// value in, a value out: resolve.ts touches no fs and no store, so nothing
// here needs a fixture home.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PINNED_INELIGIBLE_WHYS, RESOLVE_DETAIL, RELEASE_TAG_INGRESS_MAX_BYTES, UPDATE_GATE_CAP,
  autoGateBlockers, eligibleTags, floorOf, isIngestibleReleaseTag, resolveNodeIntent,
  type EligibilityRow, type IntentView, type PinnedIneligibleWhy, type ResolveInput,
} from '../src/update/resolve.js';
import { FLEET_SCOPE, type UpdateChannel } from '../../shared/api.js';

const here = path.dirname(fileURLToPath(import.meta.url));

const rel = (tag: string, channel: UpdateChannel | null = 'stable', o: Partial<EligibilityRow> = {}): EligibilityRow =>
  ({ tag, channel, bundleListed: true, yanked: false, ...o });
const intent = (channel: UpdateChannel | null, pinnedTag: string | null = null, auto: IntentView['auto'] = 'off'): IntentView =>
  ({ channel, pinnedTag, auto });
/** A node at v0.0.9 with floor v0.0.9, following the fleet row on stable, no releases, no refusals. */
const input = (o: Partial<ResolveInput> = {}): ResolveInput => ({
  currentVersion: 'v0.0.9', highestVersion: 'v0.0.9', floorRead: 'measured', nodeIntent: null, fleetIntent: intent('stable'),
  releases: [], refusedByThisNode: new Set<string>(), ...o,
});

describe('the four floor sentences are §9\'s, verbatim', () => {
  it('pinned at or below the floor', () => {
    expect(RESOLVE_DETAIL.pinnedAtOrBelowFloor('v0.0.5', 'v0.0.9'))
      .toBe("pinned v0.0.5 is at or below this node's floor v0.0.9 — pin a newer tag, or use rollback");
  });
  it('newest eligible not newer than the floor (the yank/demotion sentence)', () => {
    expect(RESOLVE_DETAIL.notNewerThanFloor('v0.0.5', 'v0.0.9'))
      .toBe("newest eligible v0.0.5 is not newer than this node's floor v0.0.9 — a yank or demotion cannot move a node down; a newer release will");
  });
  it('rolled back below the floor (the sticky-rollback sentence)', () => {
    expect(RESOLVE_DETAIL.rolledBack('v0.0.8', 'v0.0.9'))
      .toBe('this node was rolled back to v0.0.8 and its floor is v0.0.9 — auto stays off this tag until a release above v0.0.9 exists (decision 8)');
  });
  it('no floor and no measured version', () => {
    expect(RESOLVE_DETAIL.noFloor()).toBe('no floor and no measured version — nothing to compare against');
  });
  it('floor unmeasured (fix round 1, D-3213, reworded by the review\'s m-2 so it holds for a never-reached placeholder too)', () => {
    expect(RESOLVE_DETAIL.floorUnmeasured())
      .toBe("this node's floor has not been measured — nothing resolves until it is");
  });
});

describe('the floor read-state (fix round 1, D-3213): unmeasured is never absent', () => {
  it('an unmeasured floor with nothing carried resolves NOTHING — never falls back to currentVersion', () => {
    const r = resolveNodeIntent(input({
      highestVersion: null, floorRead: 'unmeasured', currentVersion: 'v0.0.9', releases: [rel('v0.0.10')],
    }));
    expect(r.desiredTag).toBeNull();
    expect(r.resolveDetail).toBe(RESOLVE_DETAIL.floorUnmeasured());
    expect(r.desiredStable).toBeNull();
    expect(r.desiredDev).toBeNull();
  });

  it('a pin does not rescue an unmeasured floor with nothing carried either', () => {
    const r = resolveNodeIntent(input({
      highestVersion: null, floorRead: 'unmeasured', currentVersion: null,
      fleetIntent: intent('stable', 'v0.0.10'), releases: [rel('v0.0.10')],
    }));
    expect(r.desiredTag).toBeNull();
    expect(r.resolveDetail).toBe(RESOLVE_DETAIL.floorUnmeasured());
  });

  // fix round 1, D-3213 re-review (N-3): after I-1's fix, a NORMAL carry
  // stores `measured` (see the store.ts/schema.ts docstrings) — `highestVersion`
  // non-NULL together with `floorRead: 'unmeasured'` is NOT the shape a carry
  // produces any more. The only path that reaches it is N-2's out-of-vocabulary
  // fold (an unknown stored token reads as `unmeasured`), reachable only after
  // a rollback from a newer build that wrote a token this build doesn't know.
  // Retitled rather than switched to `floorRead: 'measured'`: measured directly
  // (`__m4check`, this dispatch) — with `floorRead: 'measured'` the M4 mutation
  // (`floorOf(floorRead === 'unmeasured' ? null : highestVersion, …)`) is a
  // no-op, so the fixture would no longer bind it. What these two cases bind
  // today is the non-NULL-floor-constrains-regardless-of-label property, over
  // the one state that can still carry that label with a non-NULL value.
  it('a non-NULL floor constrains whatever its label says, even the out-of-vocabulary-fold label unmeasured — the un-current-equal-to-floor case', () => {
    const r = resolveNodeIntent(input({
      highestVersion: 'v0.0.9', floorRead: 'unmeasured', currentVersion: 'v0.0.9', releases: [rel('v0.0.10')],
    }));
    expect(r.desiredTag).toBe('v0.0.10');
  });

  it('a non-NULL floor constrains a ROLLED-BACK node exactly as a fresh one would, whatever its label says — this pin actually binds (fix round 1, I-3)', () => {
    // currentVersion ('v0.0.8') differs from the carried highestVersion
    // ('v0.0.9'), so an unconstrained answer (floorOf falling back to
    // currentVersion) and a constrained one DIVERGE — I-3's own reviewer
    // finding: the earlier pin above used current === highest, so the two
    // answers coincided and a broken resolver still passed it.
    const r = resolveNodeIntent(input({
      currentVersion: 'v0.0.8', highestVersion: 'v0.0.9', floorRead: 'unmeasured', releases: [rel('v0.0.9')],
    }));
    // Constrained (correct): the floor stays v0.0.9, and v0.0.9 is not
    // strictly newer than itself — decision 8's sticky-rollback sentence.
    expect(r.desiredTag).toBeNull();
    expect(r.resolveDetail).toBe(RESOLVE_DETAIL.rolledBack('v0.0.8', 'v0.0.9'));
    // Unconstrained (the regression this pin catches): floorOf(null, 'v0.0.8')
    // = 'v0.0.8', and v0.0.9 IS newer than that — it would resolve v0.0.9.
  });

  it('an absent floor (determined this sweep) is unconstrained exactly as before', () => {
    const r = resolveNodeIntent(input({
      highestVersion: null, floorRead: 'absent', currentVersion: 'v0.0.5', releases: [rel('v0.0.7')],
    }));
    expect(r.desiredTag).toBe('v0.0.7');
  });
});

describe('channel resolution', () => {
  const releases = [rel('v0.0.10'), rel('v0.0.11', 'dev')];

  it('the node\'s own row decides when it exists', () => {
    const r = resolveNodeIntent(input({ nodeIntent: intent('dev'), fleetIntent: intent('stable'), releases }));
    expect(r.channel).toBe('dev');
    expect(r.desiredTag).toBe('v0.0.11');
  });

  it('with no node row the fleet row decides', () => {
    const r = resolveNodeIntent(input({ releases }));
    expect(r.channel).toBe('stable');
    expect(r.desiredTag).toBe('v0.0.10');
  });

  it('an unknown channel token on the node row resolves NOTHING — it never falls back to the fleet row (§18)', () => {
    const r = resolveNodeIntent(input({ nodeIntent: intent(null, null, 'stable'), fleetIntent: intent('stable'), releases }));
    expect(r).toEqual({
      channel: null, desiredTag: null, resolveDetail: RESOLVE_DETAIL.unknownChannel(),
      desiredStable: null, desiredDev: null, auto: 'stable',
    });
  });

  it('an unknown channel token on the fleet row resolves nothing for a node without its own row', () => {
    const r = resolveNodeIntent(input({ fleetIntent: intent(null), releases }));
    expect(r.channel).toBeNull();
    expect(r.desiredTag).toBeNull();
    expect(r.resolveDetail).toBe(RESOLVE_DETAIL.unknownChannel());
  });

  it('no intent row at all resolves nothing, with its own sentence (not the unknown-token one)', () => {
    const r = resolveNodeIntent(input({ nodeIntent: null, fleetIntent: null, releases }));
    expect(r).toEqual({
      channel: null, desiredTag: null, resolveDetail: RESOLVE_DETAIL.noIntent(),
      desiredStable: null, desiredDev: null, auto: 'off',
    });
    expect(RESOLVE_DETAIL.noIntent()).not.toBe(RESOLVE_DETAIL.unknownChannel());
  });

  it('auto comes from the deciding row', () => {
    expect(resolveNodeIntent(input({ nodeIntent: intent('stable', null, 'channel'), fleetIntent: intent('stable', null, 'off'), releases })).auto)
      .toBe('channel');
    expect(resolveNodeIntent(input({ fleetIntent: intent('stable', null, 'stable'), releases })).auto).toBe('stable');
  });
});

describe('eligibility (§9, decision 16)', () => {
  it('stable takes only stable releases; dev takes either channel', () => {
    const releases = [rel('v0.0.10'), rel('v0.0.11', 'dev')];
    expect(resolveNodeIntent(input({ releases })).desiredTag).toBe('v0.0.10');
    expect(resolveNodeIntent(input({ fleetIntent: intent('dev'), releases })).desiredTag).toBe('v0.0.11');
    // A stable release is also the newest thing on dev until the next merge.
    expect(resolveNodeIntent(input({ fleetIntent: intent('dev'), releases: [rel('v0.0.12'), rel('v0.0.11', 'dev')] })).desiredTag)
      .toBe('v0.0.12');
  });

  it('skips an unlisted, a yanked, a refused-by-this-node and an unknown-channel release — each alone (§18)', () => {
    const variants: { name: string; o: Partial<ResolveInput> }[] = [
      { name: 'unlisted', o: { releases: [rel('v0.0.11', 'stable', { bundleListed: false }), rel('v0.0.10')] } },
      { name: 'yanked', o: { releases: [rel('v0.0.11', 'stable', { yanked: true }), rel('v0.0.10')] } },
      { name: 'refused by this node', o: { releases: [rel('v0.0.11'), rel('v0.0.10')], refusedByThisNode: new Set(['v0.0.11']) } },
      { name: 'unknown channel', o: { releases: [rel('v0.0.11', null), rel('v0.0.10')] } },
    ];
    for (const v of variants) {
      expect(resolveNodeIntent(input(v.o)).desiredTag, v.name).toBe('v0.0.10');
      expect(resolveNodeIntent(input({ fleetIntent: intent('dev'), ...v.o })).desiredTag, `${v.name} on dev`).toBe('v0.0.10');
    }
  });

  it('only THIS node\'s refusals are an input — the same listing with an empty set resolves the newest', () => {
    // The refusal by ANOTHER node never reaches this input at all: resolveInputFor
    // builds the set from refusalsFor(this node) — update-projection.test.ts pins that half.
    expect(resolveNodeIntent(input({ releases: [rel('v0.0.11'), rel('v0.0.10')] })).desiredTag).toBe('v0.0.11');
  });

  it('eligibleTags orders newest first, agreeing with `sort -V -r` (the comparator, not string order)', () => {
    const tags = ['v0.0.10', 'v0.1.0', 'v0.0.9', 'v1.0.0', 'v0.0.100', 'v0.10.0', 'v0.2.0'];
    const sortV = spawnSync('bash', ['-c', 'printf "%s\\n" "$@" | sort -V -r', '--', ...tags], { encoding: 'utf8' });
    expect(sortV.status, sortV.stderr).toBe(0);
    expect(eligibleTags(tags.map((t) => rel(t)), 'stable', new Set())).toEqual(sortV.stdout.trim().split('\n'));
    // And the resolver reads that head: v0.0.10 beats v0.0.9, which a string sort gets backwards.
    expect(resolveNodeIntent(input({ currentVersion: 'v0.0.8', highestVersion: 'v0.0.8', releases: [rel('v0.0.9'), rel('v0.0.10')] })).desiredTag)
      .toBe('v0.0.10');
  });

  it('nothing eligible → NULL with the no-eligible sentence', () => {
    const r = resolveNodeIntent(input({ releases: [rel('v0.0.11', 'dev')] }));
    expect(r.desiredTag).toBeNull();
    expect(r.resolveDetail).toBe(RESOLVE_DETAIL.noEligible('stable'));
  });
});

describe('the floor (§9, decision 8)', () => {
  it('floorOf: highest, else current, else nothing — and the higher of the two when both are tags', () => {
    expect(floorOf(null, null)).toBeNull();
    expect(floorOf('v0.0.9', null)).toBe('v0.0.9');
    expect(floorOf(null, 'v0.0.5')).toBe('v0.0.5');
    expect(floorOf('v0.0.9', 'v0.0.8')).toBe('v0.0.9');
    // D-3202: a stale floor (a deploy.sh placement never raises it) cannot license a downgrade.
    expect(floorOf('v0.0.9', 'v0.0.12')).toBe('v0.0.12');
    // A value that is not a tag is no floor at all.
    expect(floorOf('0.0.9', 'v0.0.5')).toBe('v0.0.5');
  });

  it('below / at / above: only a release strictly newer than the floor resolves', () => {
    const releases = [rel('v0.0.8'), rel('v0.0.9'), rel('v0.0.10')];
    expect(resolveNodeIntent(input({ currentVersion: 'v0.0.8', highestVersion: 'v0.0.8', releases })).desiredTag).toBe('v0.0.10');
    const at = resolveNodeIntent(input({ currentVersion: 'v0.0.10', highestVersion: 'v0.0.10', releases }));
    expect(at.desiredTag).toBeNull();
    expect(at.resolveDetail).toBe(RESOLVE_DETAIL.notNewerThanFloor('v0.0.10', 'v0.0.10'));
    const above = resolveNodeIntent(input({ currentVersion: 'v0.0.11', highestVersion: 'v0.0.11', releases }));
    expect(above.desiredTag).toBeNull();
    expect(above.resolveDetail).toBe(RESOLVE_DETAIL.notNewerThanFloor('v0.0.10', 'v0.0.11'));
  });

  it('a demoted newest never moves the node down — NULL with the at-floor sentence (§18 "never goes below the floor")', () => {
    // v0.0.10 was demoted back to a prerelease; the newest stable is now v0.0.9.
    const r = resolveNodeIntent(input({
      currentVersion: 'v0.0.10', highestVersion: 'v0.0.10', releases: [rel('v0.0.10', 'dev'), rel('v0.0.9')],
    }));
    expect(r.desiredTag).toBeNull();
    expect(r.resolveDetail).toBe(RESOLVE_DETAIL.notNewerThanFloor('v0.0.9', 'v0.0.10'));
  });

  it('a yanked newest never moves the node down either', () => {
    const r = resolveNodeIntent(input({
      currentVersion: 'v0.0.10', highestVersion: 'v0.0.10', releases: [rel('v0.0.10', 'stable', { yanked: true }), rel('v0.0.9')],
    }));
    expect(r.desiredTag).toBeNull();
    expect(r.resolveDetail).toBe(RESOLVE_DETAIL.notNewerThanFloor('v0.0.9', 'v0.0.10'));
  });

  it('a rolled-back node gets the below-floor sentence, never the yank one (§18 "the two floor sentences")', () => {
    const r = resolveNodeIntent(input({ currentVersion: 'v0.0.8', highestVersion: 'v0.0.9', releases: [rel('v0.0.9'), rel('v0.0.8')] }));
    expect(r.desiredTag).toBeNull();
    expect(r.resolveDetail).toBe(RESOLVE_DETAIL.rolledBack('v0.0.8', 'v0.0.9'));
  });

  it('a NULL highestVersion is unconstrained: the measured version stands in — never v0.0.0, never a refusal (§18)', () => {
    // Not a refusal: a newer release resolves.
    expect(resolveNodeIntent(input({ highestVersion: null, currentVersion: 'v0.0.5', releases: [rel('v0.0.7')] })).desiredTag)
      .toBe('v0.0.7');
    // Not v0.0.0: an older release does not.
    const r = resolveNodeIntent(input({ highestVersion: null, currentVersion: 'v0.0.9', releases: [rel('v0.0.5')] }));
    expect(r.desiredTag).toBeNull();
    expect(r.resolveDetail).toBe(RESOLVE_DETAIL.notNewerThanFloor('v0.0.5', 'v0.0.9'));
  });

  it('no floor and no measured version → NULL, pinned or not', () => {
    const releases = [rel('v0.0.7')];
    const unpinned = resolveNodeIntent(input({ highestVersion: null, currentVersion: null, releases }));
    expect(unpinned.desiredTag).toBeNull();
    expect(unpinned.resolveDetail).toBe(RESOLVE_DETAIL.noFloor());
    const pinned = resolveNodeIntent(input({ highestVersion: null, currentVersion: null, fleetIntent: intent('stable', 'v0.0.7'), releases }));
    expect(pinned.desiredTag).toBeNull();
    expect(pinned.resolveDetail).toBe(RESOLVE_DETAIL.noFloor());
  });

  it('a version above a stale floor is the floor (D-3202)', () => {
    const r = resolveNodeIntent(input({ highestVersion: 'v0.0.9', currentVersion: 'v0.0.12', releases: [rel('v0.0.11')] }));
    expect(r.desiredTag).toBeNull();
    expect(r.resolveDetail).toBe(RESOLVE_DETAIL.notNewerThanFloor('v0.0.11', 'v0.0.12'));
  });
});

describe('isIngestibleReleaseTag (fix round 1, D-3216, F11) — ingress-only, on top of isReleaseTag', () => {
  it('a leading zero in any component but a bare 0 is refused', () => {
    expect(isIngestibleReleaseTag('v0.0.010')).toBe(false);
    expect(isIngestibleReleaseTag('v01.2.3')).toBe(false);
    expect(isIngestibleReleaseTag('v1.02.3')).toBe(false);
  });

  it('a bare 0 component, and a multi-digit component with no leading zero, are both fine', () => {
    expect(isIngestibleReleaseTag('v0.0.0')).toBe(true);
    expect(isIngestibleReleaseTag('v10.20.30')).toBe(true);
  });

  it('a byte length over the cap is refused; one at exactly the cap is kept', () => {
    expect(RELEASE_TAG_INGRESS_MAX_BYTES).toBe(64);
    const at64 = `v${'1'.repeat(59)}.0.0`;
    const at65 = `v${'1'.repeat(60)}.0.0`;
    expect(Buffer.byteLength(at64, 'utf8')).toBe(64);
    expect(Buffer.byteLength(at65, 'utf8')).toBe(65);
    expect(isIngestibleReleaseTag(at64)).toBe(true);
    expect(isIngestibleReleaseTag(at65)).toBe(false);
  });

  it('anything isReleaseTag itself refuses is refused here too', () => {
    for (const bad of ['0.0.9', 'v0.0', 'v0.0.9 ', 'V0.0.9', 'v0.0.9\n', 9, null, undefined]) {
      expect(isIngestibleReleaseTag(bad)).toBe(false);
    }
  });
});

describe('a pin', () => {
  it('an eligible pin above the floor wins over a newer release', () => {
    const r = resolveNodeIntent(input({ fleetIntent: intent('stable', 'v0.0.10'), releases: [rel('v0.0.10'), rel('v0.0.11')] }));
    expect(r.desiredTag).toBe('v0.0.10');
    expect(r.resolveDetail).toBeNull();
  });

  it('a pin at or below the floor resolves NULL with its sentence, never the newer release (§18)', () => {
    const releases = [rel('v0.0.5'), rel('v0.0.9'), rel('v0.0.11')];
    const at = resolveNodeIntent(input({ fleetIntent: intent('stable', 'v0.0.9'), releases }));
    expect(at.desiredTag).toBeNull();
    expect(at.resolveDetail).toBe(RESOLVE_DETAIL.pinnedAtOrBelowFloor('v0.0.9', 'v0.0.9'));
    const below = resolveNodeIntent(input({ fleetIntent: intent('stable', 'v0.0.5'), releases }));
    expect(below.desiredTag).toBeNull();
    expect(below.resolveDetail).toBe(RESOLVE_DETAIL.pinnedAtOrBelowFloor('v0.0.5', 'v0.0.9'));
  });

  it('an ineligible pin resolves NULL with its reason and never falls through to the newest (§18)', () => {
    const cases: { why: PinnedIneligibleWhy; o: Partial<ResolveInput> }[] = [
      { why: 'not-in-catalogue', o: { releases: [rel('v0.0.13')] } },
      { why: 'no-bundle-listed', o: { releases: [rel('v0.0.12', 'stable', { bundleListed: false }), rel('v0.0.13')] } },
      { why: 'yanked', o: { releases: [rel('v0.0.12', 'stable', { yanked: true }), rel('v0.0.13')] } },
      { why: 'refused-by-this-node', o: { releases: [rel('v0.0.12'), rel('v0.0.13')], refusedByThisNode: new Set(['v0.0.12']) } },
      { why: 'not-on-stable', o: { releases: [rel('v0.0.12', 'dev'), rel('v0.0.13')] } },
      { why: 'unknown-release-channel', o: { releases: [rel('v0.0.12', null), rel('v0.0.13')] } },
    ];
    // Every reason the resolver can give has a case here.
    expect(cases.map((c) => c.why).sort()).toEqual([...PINNED_INELIGIBLE_WHYS].sort());
    for (const c of cases) {
      const r = resolveNodeIntent(input({ fleetIntent: intent('stable', 'v0.0.12'), ...c.o }));
      expect(r.desiredTag, c.why).toBeNull();
      expect(r.resolveDetail, c.why).toBe(RESOLVE_DETAIL.pinnedIneligible('v0.0.12', c.why));
      expect(r.resolveDetail, c.why).toMatch(/^pinned v0\.0\.12 is not eligible on this node — /);
    }
  });

  it('a prerelease pin is eligible on dev', () => {
    const r = resolveNodeIntent(input({ fleetIntent: intent('dev', 'v0.0.12'), releases: [rel('v0.0.12', 'dev'), rel('v0.0.13')] }));
    expect(r.desiredTag).toBe('v0.0.12');
  });
});

describe('both desireds (§9: --channel selects the other one without a local resolution)', () => {
  const releases = [rel('v0.0.10'), rel('v0.0.11', 'dev')];

  it('on stable: desired = desired-stable, and desired-dev is the dev resolution of the same row', () => {
    expect(resolveNodeIntent(input({ fleetIntent: intent('stable', null, 'stable'), releases }))).toEqual({
      channel: 'stable', desiredTag: 'v0.0.10', resolveDetail: null, desiredStable: 'v0.0.10', desiredDev: 'v0.0.11', auto: 'stable',
    });
  });

  it('on dev: desired = desired-dev', () => {
    const r = resolveNodeIntent(input({ fleetIntent: intent('dev'), releases }));
    expect(r.desiredTag).toBe('v0.0.11');
    expect(r.desiredDev).toBe('v0.0.11');
    expect(r.desiredStable).toBe('v0.0.10');
  });

  it('a pin runs in both resolutions: a prerelease pin is NULL on stable and resolves on dev', () => {
    const r = resolveNodeIntent(input({ fleetIntent: intent('stable', 'v0.0.11'), releases }));
    expect(r.desiredTag).toBeNull();
    expect(r.resolveDetail).toBe(RESOLVE_DETAIL.pinnedIneligible('v0.0.11', 'not-on-stable'));
    expect(r.desiredStable).toBeNull();
    expect(r.desiredDev).toBe('v0.0.11');
  });
});

describe('autoGateBlockers (§9: the intent route\'s advisory 409)', () => {
  const nodes = [
    { nodeId: 'a', caps: ['verify', 'node-id', 'floor'] },
    { nodeId: 'b', caps: ['verify', UPDATE_GATE_CAP] },
    { nodeId: 'c', caps: [] },   // never measured: no caps is no gate
  ];

  it('the fleet scope names every node lacking update-gate, reachable or not', () => {
    expect(autoGateBlockers(FLEET_SCOPE, nodes)).toEqual(['a', 'c']);
  });

  it('a node scope names only that node, and only when it lacks the word', () => {
    expect(autoGateBlockers('a', nodes)).toEqual(['a']);
    expect(autoGateBlockers('b', nodes)).toEqual([]);
  });
});

describe('the ring (design 2026-09-20 D-3187)', () => {
  it('resolve.ts imports only shared/api and shared/semver — no fs, no store, no fastify', () => {
    const src = readFileSync(path.join(here, '..', 'src', 'update', 'resolve.ts'), 'utf8');
    const specs = [...src.matchAll(/^\s*(?:import|export)\b[^;]*?\bfrom\s+'([^']+)'|^\s*import\s+'([^']+)'/gm)]
      .map((m) => m[1] ?? m[2]);
    expect(specs.length).toBeGreaterThan(0);
    expect(new Set(specs)).toEqual(new Set(['../../../shared/api.js', '../../../shared/semver.js']));
    expect(/\brequire\(|import\(/.test(src)).toBe(false);
  });
});
