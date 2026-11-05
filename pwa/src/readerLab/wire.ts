// The reader lab door's read, checked (native Docs reader, the reader lab plan of 2026-11-03, Task 9, refinement (s)).
// Ring L1: pure, over `lib/wire.ts`'s guards. A read is a run only when it names every probe of this page's vocabulary,
// with a count in every class; anything less is an older door, and the run stops with "update the server".
import {
  LAB_ORIGIN_CLASSES, LAB_PROBE_NAMES, LAB_SITE_CLASSES,
  type LabOriginClass, type LabProbeName, type LabProbeTally, type LabRunView, type LabSiteClass,
} from '../../../shared/readerLab';
import { isCount, isRecord } from '../lib/wire';

/** A count for each of `keys` in `v`, or null when one is missing or not a count. */
function countsOf<K extends string>(v: unknown, keys: readonly K[]): Record<K, number> | null {
  if (!isRecord(v)) return null;
  const out = {} as Record<K, number>;
  for (const k of keys) {
    const n = v[k];
    if (!isCount(n)) return null;
    out[k] = n;
  }
  return out;
}

/** The run in a `GET /api/reader-lab/runs/:nonce` answer, or null. Null has one meaning: the body is not a whole run of
 *  this page's vocabulary. */
export function readLabRunView(body: unknown): LabRunView | null {
  if (!isRecord(body) || body['ok'] !== true) return null;
  const run = body['run'];
  if (!isRecord(run)) return null;
  const { openedAt, expiresAt, counted, ignored, saturated, probes: given } = run;
  if (!isCount(openedAt) || !isCount(expiresAt) || !isCount(counted) || !isCount(ignored) || typeof saturated !== 'boolean'
    || !isRecord(given)) return null;
  const probes = {} as Record<LabProbeName, LabProbeTally>;
  for (const n of LAB_PROBE_NAMES) {
    const t = Object.hasOwn(given, n) ? given[n] : undefined;
    if (!isRecord(t)) return null;
    const { hits, cookie, upgrade } = t;
    const site = countsOf<LabSiteClass>(t['site'], LAB_SITE_CLASSES);
    const origin = countsOf<LabOriginClass>(t['origin'], LAB_ORIGIN_CLASSES);
    if (!isCount(hits) || !isCount(cookie) || !isCount(upgrade) || site === null || origin === null) return null;
    probes[n] = { hits, cookie, upgrade, site, origin };
  }
  return { openedAt, expiresAt, counted, ignored, saturated, probes };
}
