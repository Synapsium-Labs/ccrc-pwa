/**
 * D-6045, stage 2 (Task C0n; ARCH-04 (#545)): one stamp per may-only-shrink exemption set, keyed
 * `<repo-relative file>#<exported or declared name>`. `size` is the set's size, held exactly, so any change to the
 * set edits its stamp in the same diff; `reason` says why the set is still not empty, and `since` is the day the
 * set last changed or that reason was last re-dated. `exemption-age.test.ts` turns a non-empty set red once its
 * stamp is more than 60 days old: a debt nobody has shrunk or re-justified in two months has stopped being tracked.
 *
 * Every `*_EXEMPTIONS` set in a `rings/*.data.ts` file needs a stamp. An allowlist (`FASTIFY_L4_ALLOWLIST`, the
 * `.mjs` carve-out) is not a debt and has none.
 */
export interface SetStamp {
  size: number;
  reason: string;
  since: string;
}

export const EXEMPTION_SET_STAMPS: Readonly<Record<string, SetStamp>> = {
  'server/test/rings/outward-edges.data.ts#OUTWARD_EDGE_EXEMPTIONS': { size: 13, reason: 'the outward runtime edges left after ARCH-05 (#551) moved configDirFor and tx inward (D-5896); ARCH-05 drains the rest', since: '2026-10-20' },
  'server/test/rings/host-imports.data.ts#HOST_IMPORT_EXEMPTIONS': { size: 0, reason: 'empty since ARCH-03 (#541)', since: '2026-10-20' },
  'server/test/rings/shared-imports.data.ts#SHARED_IMPORT_EXEMPTIONS': { size: 0, reason: 'empty since stage 1 landed', since: '2026-10-20' },
  'server/test/rings/mjs-node.data.ts#REACHABLE_MJS_EXEMPTIONS': { size: 0, reason: 'empty since stage 1 landed', since: '2026-10-20' },
  'server/test/rings/pwa-rings.data.ts#PWA_L1_EXEMPTIONS': { size: 14, reason: 'the PWA L1 modules\' merge-day runtime edges to a .tsx file, a store or lib/api.ts (D-6118); each drains by moving its value inward', since: '2026-10-20' },
  'server/test/rings/pwa-rings.data.ts#UI_PWA_EXEMPTIONS': { size: 0, reason: 'empty since stage 3 landed (D-6118)', since: '2026-10-20' },
  'server/test/rings/wire-totality.data.ts#WIRE_TOTALITY_EXEMPTIONS': { size: 28, reason: 'merge-day listless literal unions in shared/; ARCH-12 follow-ups drain them', since: '2026-10-20' },
  'server/test/growth-exemptions.json#exemptions': { size: 0, reason: 'empty: an entry names one PR the operator exempted from the growth check, and goes once that PR lands (D-6211)', since: '2026-10-21' },
  'server/test/deviation-refs.test.ts#GRANDFATHERED': { size: 16, reason: "re-reviewed 2026-10-20: the 16 pre-allocator D-number collisions all still collide (deviation-refs pins each member); wave 10's reconciliation drains them", since: '2026-10-20' },
};
