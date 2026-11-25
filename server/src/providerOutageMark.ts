// The provider outages' durable mark (the provider-failure ladder, wave 1; the disk episode's shape, `diskepisode.ts`). L3:
// one small JSON file in the ccrc dir holds the outages that stand, so a restarted server resumes them and repeats no push.
// An unreadable or malformed mark reads as none, which costs one repeated push and never a silent outage.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** One standing outage as it is kept: its provider's key and name, and when it was raised. */
export interface OutageMark { readonly key: string; readonly name: string; readonly since: number }

function markPath(ccrcDir: string): string { return path.join(ccrcDir, 'provider-outages.json'); }

export function readOutageMarks(ccrcDir: string): OutageMark[] {
  try {
    const raw: unknown = JSON.parse(readFileSync(markPath(ccrcDir), 'utf8'));
    if (!Array.isArray(raw)) return [];
    return raw.filter((r): r is OutageMark => typeof r === 'object' && r !== null && typeof (r as OutageMark).key === 'string'
      && typeof (r as OutageMark).name === 'string' && Number.isSafeInteger((r as OutageMark).since))
      .map((r) => ({ key: r.key, name: r.name, since: r.since }));
  } catch { return []; }
}

/** Writes the standing outages, or removes the mark when there are none. A write that fails costs the restart dedupe only. */
export function writeOutageMarks(ccrcDir: string, marks: readonly OutageMark[]): void {
  try {
    if (marks.length === 0) { rmSync(markPath(ccrcDir), { force: true }); return; }
    mkdirSync(ccrcDir, { recursive: true });
    writeFileSync(markPath(ccrcDir), `${JSON.stringify(marks)}\n`);
  } catch { /* the notice still goes out */ }
}
