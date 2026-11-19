// Flows (spec 2026-11-19 §7): the operator's flows and their published versions. Ring: L3 adapter over the coord.db handle, context Coordination (C5).
// SQL only: every function is synchronous over the store's own database handle, and `CoordStore` keeps a one-line
// delegate for each. No repository and no async wrapper.
//
// ONE WRITER: these functions are the only writers of `flows` and `flow_versions`. A published version is
// INSERTED once and never updated; `publishFlow` takes the next number inside its own transaction.
//
// THE READ checks shape only (`parseFlowDoc`): a stored document it cannot read is `unreadable` with its
// reason, never folded into absent or into an empty flow. A throw is `{ ok: false, detail }`.
import type { DatabaseSync } from 'node:sqlite';
import type { RunState } from '../../../shared/api.js';
import { canonicalFlowJson, parseFlowDoc, type FlowDoc, type FlowParse, type FlowSource, type FlowSummary, type FlowVersionRow } from '../../../shared/flows.js';
import { tx } from '../coord/tx.js';

export type { FlowSource, FlowSummary, FlowVersionRow };
export interface FlowRecord extends FlowSummary { draft: FlowParse; versions: FlowVersionRow[] }

export type FlowsRead<T> = { ok: true; value: T } | { ok: false; detail: string };

interface FlowRowSql { id: number; title: string; sourceTemplate: string | null; sourceVersion: number | null; updatedAt: number; latest: number | null; pinnedBy: number }

const summary = (r: FlowRowSql): FlowSummary => ({
  id: r.id, title: r.title, updatedAt: r.updatedAt, latestVersion: r.latest, pinnedBy: r.pinnedBy,
  source: r.sourceTemplate !== null && r.sourceVersion !== null ? { template: r.sourceTemplate, version: r.sourceVersion } : null,
});

function readDoc(json: string): FlowParse {
  try { return parseFlowDoc(JSON.parse(json)); } catch { return { ok: false, reason: 'the stored document is not JSON' }; }
}

function guard<T>(fn: () => T): FlowsRead<T> {
  try { return { ok: true, value: fn() }; } catch (err) { return { ok: false, detail: err instanceof Error ? err.message : String(err) }; }
}

const SELECT = `SELECT f.id, f.title, f.sourceTemplate, f.sourceVersion, f.updatedAt,
  (SELECT MAX(version) FROM flow_versions v WHERE v.flowId = f.id) AS latest,
  (SELECT COUNT(*) FROM programs p WHERE p.flowId = f.id) AS pinnedBy FROM flows f`;

export function listFlows(db: DatabaseSync): FlowsRead<FlowSummary[]> {
  return guard(() => (db.prepare(`${SELECT} ORDER BY f.updatedAt DESC, f.id DESC`).all() as unknown as FlowRowSql[]).map(summary));
}

export function readFlow(db: DatabaseSync, id: number): FlowsRead<FlowRecord | null> {
  return guard(() => {
    const row = db.prepare(`${SELECT} WHERE f.id = ?`).get(id) as unknown as FlowRowSql | undefined;
    if (!row) return null;
    const { draft } = db.prepare('SELECT draft FROM flows WHERE id = ?').get(id) as { draft: string };
    const versions = db.prepare('SELECT version, publishedAt FROM flow_versions WHERE flowId = ? ORDER BY version')
      .all(id) as unknown as FlowVersionRow[];
    return { ...summary(row), draft: readDoc(draft), versions };
  });
}

export function readFlowVersion(db: DatabaseSync, id: number, version: number): FlowsRead<{ doc: FlowParse; publishedAt: number } | null> {
  return guard(() => {
    const row = db.prepare('SELECT doc, publishedAt FROM flow_versions WHERE flowId = ? AND version = ?').get(id, version) as
      { doc: string; publishedAt: number } | undefined;
    return row ? { doc: readDoc(row.doc), publishedAt: row.publishedAt } : null;
  });
}

export function createFlow(db: DatabaseSync, doc: FlowDoc, source: FlowSource | null, now: number): number {
  const r = db.prepare('INSERT INTO flows (title, sourceTemplate, sourceVersion, draft, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)')
    .run(doc.title, source?.template ?? null, source?.version ?? null, canonicalFlowJson(doc), now, now);
  return Number(r.lastInsertRowid);
}

/** `changed: false` when no flow has that id. */
export function saveFlowDraft(db: DatabaseSync, id: number, doc: FlowDoc, now: number): { changed: boolean } {
  const r = db.prepare('UPDATE flows SET draft = ?, title = ?, updatedAt = ? WHERE id = ?').run(canonicalFlowJson(doc), doc.title, now, id);
  return { changed: Number(r.changes) > 0 };
}

/** Publishes `doc` as the next version, but only while it is still the stored draft: the caller validated
 *  exactly this document, so a draft saved in between is refused `stale`, never published unchecked. */
export function publishFlow(db: DatabaseSync, id: number, doc: FlowDoc, now: number):
  { ok: true; version: number } | { ok: false; reason: 'absent' | 'stale' } {
  return tx(db, () => {
    const row = db.prepare('SELECT draft FROM flows WHERE id = ?').get(id) as { draft: string } | undefined;
    if (!row) return { ok: false, reason: 'absent' } as const;
    const json = canonicalFlowJson(doc);
    if (row.draft !== json) return { ok: false, reason: 'stale' } as const;
    const { next } = db.prepare('SELECT COALESCE(MAX(version), 0) + 1 AS next FROM flow_versions WHERE flowId = ?').get(id) as { next: number };
    db.prepare('INSERT INTO flow_versions (flowId, version, doc, publishedAt) VALUES (?, ?, ?, ?)').run(id, next, json, now);
    db.prepare('UPDATE flows SET updatedAt = ? WHERE id = ?').run(now, id);
    return { ok: true, version: next } as const;
  });
}

/** Removes a flow and its versions, refused while any programme pins it (spec §7). Deleting the default clears it. */
export function deleteFlow(db: DatabaseSync, id: number): { changed: boolean } | { refused: 'pinned'; by: number } {
  return tx(db, () => {
    const by = flowPinnedBy(db, id);
    if (by > 0) return { refused: 'pinned', by } as const;
    db.prepare('UPDATE flow_settings SET defaultFlowId = NULL WHERE defaultFlowId = ?').run(id);
    db.prepare('DELETE FROM flow_versions WHERE flowId = ?').run(id);
    return { changed: Number(db.prepare('DELETE FROM flows WHERE id = ?').run(id).changes) > 0 };
  });
}

// ── Wave 2: the default flow and the programme's flow pin ────────────────────

export type FlowPin = { flowId: number; version: number };

/** The flow new programmes pin, or null for none. */
export function readDefaultFlow(db: DatabaseSync): number | null {
  const row = db.prepare('SELECT defaultFlowId FROM flow_settings WHERE id = 1').get() as { defaultFlowId: number | null } | undefined;
  return row?.defaultFlowId ?? null;
}

/** Names the default (null clears it). Only a flow with a published version can be one: a programme pins a version. */
export function setDefaultFlow(db: DatabaseSync, id: number | null): { ok: true } | { ok: false; refused: 'not-found' | 'unpublished' } {
  return tx(db, () => {
    if (id !== null) {
      const row = db.prepare('SELECT (SELECT MAX(version) FROM flow_versions WHERE flowId = f.id) AS latest FROM flows f WHERE f.id = ?')
        .get(id) as { latest: number | null } | undefined;
      if (!row) return { ok: false, refused: 'not-found' } as const;
      if (row.latest === null) return { ok: false, refused: 'unpublished' } as const;
    }
    db.prepare('UPDATE flow_settings SET defaultFlowId = ? WHERE id = 1').run(id);
    return { ok: true } as const;
  });
}

/** How many programmes pin the flow. */
export function flowPinnedBy(db: DatabaseSync, id: number): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM programs WHERE flowId = ?').get(id) as { n: number }).n;
}

/** The flow a programme pinned, or null for none (or no such programme). */
export function readProgrammeFlowPin(db: DatabaseSync, slug: string): FlowPin | null {
  const row = db.prepare('SELECT flowId, flowVersion FROM programs WHERE slug = ?').get(slug) as
    { flowId: number | null; flowVersion: number | null } | undefined;
  return row && row.flowId !== null && row.flowVersion !== null ? { flowId: row.flowId, version: row.flowVersion } : null;
}

// ── Wave 3a: the programmes on a flow, with the run facts a position is derived from ─────────────────────────────

/** One programme that pins the flow, and the facts `position.ts#flowPositionOf` reads. */
export interface FlowProgrammeFacts {
  slug: string; title: string; version: number;
  facts: { programmeState: string; work: { id: number; state: RunState; wave: number; waveOf: number } | null; reviewOpen: boolean };
}

/** Every programme pinning the flow, newest first. `terminalSql` is the store's one spelling of the terminal run states
 *  (`store.ts#TERMINAL_RUN_STATES_SQL`), passed in as `portfolio.ts` takes it. Reads only. */
export function flowProgrammes(db: DatabaseSync, flowId: number, terminalSql: string): FlowsRead<FlowProgrammeFacts[]> {
  return guard(() => {
    const rows = db.prepare('SELECT slug, title, state, flowVersion FROM programs WHERE flowId = ? ORDER BY createdAt DESC, slug')
      .all(flowId) as unknown as { slug: string; title: string; state: string; flowVersion: number }[];
    const newest = db.prepare(
      "SELECT id, state, wave, waveOf FROM runs WHERE program = ? AND kind = 'work' ORDER BY wave DESC, id DESC LIMIT 1");
    const review = db.prepare(`SELECT 1 FROM runs WHERE program = ? AND kind = 'review' AND state NOT IN ${terminalSql} LIMIT 1`);
    return rows.map((r) => {
      const w = newest.get(r.slug) as { id: number; state: RunState; wave: number; waveOf: number } | undefined;
      return { slug: r.slug, title: r.title, version: r.flowVersion,
        facts: { programmeState: r.state, work: w ?? null, reviewOpen: review.get(r.slug) !== undefined } };
    });
  });
}
