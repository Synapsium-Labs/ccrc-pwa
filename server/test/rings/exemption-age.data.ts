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
  'server/test/rings/outward-edges.data.ts#OUTWARD_EDGE_EXEMPTIONS': { size: 16, reason: 'the outward runtime edges on the tree when stage 2 landed; ARCH-05 (#551) drains them', since: '2026-10-20' },
  'server/test/rings/host-imports.data.ts#HOST_IMPORT_EXEMPTIONS': { size: 0, reason: 'empty since ARCH-03 (#541)', since: '2026-10-20' },
  'server/test/rings/shared-imports.data.ts#SHARED_IMPORT_EXEMPTIONS': { size: 0, reason: 'empty since stage 1 landed', since: '2026-10-20' },
  'server/test/rings/mjs-node.data.ts#REACHABLE_MJS_EXEMPTIONS': { size: 0, reason: 'empty since stage 1 landed', since: '2026-10-20' },
  'server/test/deviation-refs.test.ts#GRANDFATHERED': { size: 16, reason: "the pre-allocator D-number collisions, grandfathered by measurement; wave 10's reconciliation shrinks them", since: '2026-08-24' },
};
