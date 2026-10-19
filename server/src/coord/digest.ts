// The daily digest of what coordinators decided in the operator's name, and its correction mail (coordinator-first
// routing spec 2026-10-17 §10, plan Task 17, D-5300).
//
// `buildDigest` is PURE over the store's two durable tables (`asks`, `approvals`): it reads rows, never the feed ring
// and never the server's in-memory unredacted approval inputs, and every text it puts on a line passes
// `redactCommand` again, whatever the row stored (an asks row minted before the redactor ran at the mint carries its
// question raw). One predicate per table (`askDecision`, `approvalDecision`) says whether a row is a coordinator's
// decision and which; the digest lists it, and the correction route refuses a row it does not name
// (`not-coordinator`), so the two can never disagree about what a coordinator decided (D-5493).
//
// L3: it decides; `server.ts` owns the routes and `watch.ts` the once-a-day beat.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  ASK_OPERATOR_PRINCIPAL, DIGEST_COMMAND_CHARS, DIGEST_CORRECTION_MAX_CHARS, DIGEST_HOUR_FILE, DIGEST_LINE_KINDS,
  DIGEST_REFUSALS,
  type DigestAnswer, type DigestCorrectBody, type DigestLine, type DigestLineKind, type DigestRowKind, type DigestTotals,
} from '../../../shared/api.js';
import { redactCommand } from './redact.js';
import { insertSystemMailTx } from './rundefs.js';
import type { ApprovalRow, AskRow, CoordStore } from './store.js';

/** The digest's own kebab words (its line kinds and its refusals), for `mail-routes.test.ts`'s scan of every quoted
 *  kebab token under `server/src/coord`: admitted through this guard, derived from `shared/api.ts`'s tables, never a
 *  hand-kept allowlist, as every other lane's words are. */
export function isDigestKebab(tok: string): boolean {
  return (DIGEST_LINE_KINDS as readonly string[]).includes(tok) || (DIGEST_REFUSALS as readonly string[]).includes(tok);
}

/** The digest's default hour, UTC (spec §10, the coordinator's call: 07:00). `~/.ccrc/digest-hour` overrides it. */
export const DIGEST_HOUR_UTC = 7;

const DAY_MS = 86_400_000;

/** The digest hour in force: the override file's one integer 0 to 23, or `DIGEST_HOUR_UTC`. An absent file is the
 *  default, silently; a file that does not hold an hour is the default too, and said, because the operator placed it
 *  meaning something. Read on each beat, so a moved hour takes effect without a restart. */
export function readDigestHour(ccrcDir: string, warn: (msg: string) => void = (m) => console.warn(m)): number {
  let raw: string;
  try {
    raw = readFileSync(path.join(ccrcDir, DIGEST_HOUR_FILE), 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      warn(`ccrc-server: digest: ~/.ccrc/${DIGEST_HOUR_FILE} unreadable (${(err as Error).message}) — using ${DIGEST_HOUR_UTC}:00 UTC`);
    }
    return DIGEST_HOUR_UTC;
  }
  const t = raw.trim();
  if (/^\d{1,2}$/.test(t) && Number(t) <= 23) return Number(t);
  warn(`ccrc-server: digest: ~/.ccrc/${DIGEST_HOUR_FILE} does not hold an hour 0-23 — using ${DIGEST_HOUR_UTC}:00 UTC`);
  return DIGEST_HOUR_UTC;
}

/** `YYYY-MM-DD` that names a real UTC date, or null. */
export function parseDigestDay(s: unknown): string | null {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const ms = Date.parse(`${s}T00:00:00Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === s ? s : null;
}

/** The window the digest for `day` covers: the 24 hours before that day's digest hour. */
export function digestWindow(day: string, hourUtc: number): { fromMs: number; toMs: number } {
  const toMs = Date.parse(`${day}T00:00:00Z`) + hourUtc * 3_600_000;
  return { fromMs: toMs - DAY_MS, toMs };
}

/** The newest day whose window has closed at `now`: today once the hour has passed, else yesterday. */
export function digestDayFor(now: number, hourUtc: number): string {
  const today = new Date(now).toISOString().slice(0, 10);
  if (now >= digestWindow(today, hourUtc).toMs) return today;
  return new Date(now - DAY_MS).toISOString().slice(0, 10);
}

/** A question row's coordinator decision, or null when it is none: held for a coordinator at the mint
 *  (`releaseReason` null, a parent that is not the operator), and then answered by that coordinator, handed over by
 *  it, or lapsed. A row the operator answered while it was still held (no `releasedAt`) is the operator's, and a row
 *  that went stale (the dialog vanished) was decided by nobody. */
export function askDecision(a: AskRow): { kind: DigestLineKind; at: number } | null {
  if (a.releaseReason !== null || a.parentId === ASK_OPERATOR_PRINCIPAL) return null;
  if (a.state === 'answered' && a.answeredBy === a.parentId && a.answeredAt !== null) return { kind: 'answer', at: a.answeredAt };
  if (a.state === 'declined' && a.releasedAt !== null) return { kind: 'hand-over', at: a.releasedAt };
  if (a.releasedAt !== null && (a.state === 'released' || a.state === 'answering' || a.state === 'answered')) {
    return { kind: 'lapse', at: a.releasedAt };
  }
  return null;
}

/** An approval row's coordinator decision, or null: held for a coordinator at the mint, then allowed or denied by it
 *  (`answeredBy` the held-for claimant), handed over, or lapsed at its `notifyAt` (`released`, `stale`, or the
 *  operator's answer after the window). The operator's answer inside the window is the operator's. */
export function approvalDecision(r: ApprovalRow): { kind: DigestLineKind; at: number } | null {
  if (r.releaseReason !== null || r.parentId === ASK_OPERATOR_PRINCIPAL) return null;
  if ((r.state === 'allowed' || r.state === 'denied') && r.answeredBy === r.parentId && r.ruledAt !== null) {
    return { kind: r.state === 'allowed' ? 'allow' : 'deny', at: r.ruledAt };
  }
  if (r.state === 'declined' && r.ruledAt !== null) return { kind: 'hand-over', at: r.ruledAt };
  if (r.state === 'released' || r.state === 'stale') return { kind: 'lapse', at: r.notifyAt };
  if (r.state === 'operator' && r.ruledAt !== null && r.ruledAt >= r.notifyAt) return { kind: 'lapse', at: r.notifyAt };
  return null;
}

export type DigestBuilt = Pick<DigestAnswer, 'totals' | 'byCoordinator' | 'lines'>;

/** The digest over `[dayStartMs, dayEndMs)`: one line per coordinator decision, in time order (ties by table, then
 *  id), the totals, and each coordinator's count. Pure over the store's reads. */
export function buildDigest(store: CoordStore, dayStartMs: number, dayEndMs: number):
  { ok: true; digest: DigestBuilt } | { ok: false; detail: string } {
  const asks = store.digestAsks(dayStartMs, dayEndMs);
  if (!asks.ok) return asks;
  const approvals = store.digestApprovals(dayStartMs, dayEndMs);
  if (!approvals.ok) return approvals;
  const inWindow = (at: number): boolean => at >= dayStartMs && at < dayEndMs;
  const lines: DigestLine[] = [];
  for (const { ask, corrected } of asks.rows) {
    const d = askDecision(ask);
    if (d === null || !inWindow(d.at)) continue;
    lines.push({
      rowKind: 'ask', id: ask.id, kind: d.kind, at: d.at, coordinator: ask.parentId, childId: ask.childId,
      text: redactCommand(ask.question), tool: null, class: null,
      answer: d.kind === 'answer' && ask.answer !== null ? redactCommand(ask.answer) : null, reason: null, corrected,
    });
  }
  let guardForbidden = 0;
  for (const r of approvals.rows) {
    // D-5492: the guard's refusals are the requests the classifier classed `forbidden`; counted, never lines.
    if (r.releaseReason === 'forbidden' && inWindow(r.askAt)) guardForbidden += 1;
    const d = approvalDecision(r);
    if (d === null || !inWindow(d.at)) continue;
    lines.push({
      rowKind: 'approval', id: r.id, kind: d.kind, at: d.at, coordinator: r.parentId, childId: r.childId,
      // Redacted in full first, then cut: a cut first could split a token and leave its head unmasked.
      text: redactCommand(r.inputRedacted ?? '').slice(0, DIGEST_COMMAND_CHARS), tool: r.tool, class: r.class,
      answer: null, reason: r.reason === null ? null : redactCommand(r.reason), corrected: r.corrected,
    });
  }
  const order: Record<DigestRowKind, number> = { ask: 0, approval: 1 };
  lines.sort((a, b) => a.at - b.at || order[a.rowKind] - order[b.rowKind] || a.id - b.id);
  const count = (k: DigestLineKind): number => lines.filter((l) => l.kind === k).length;
  const totals: DigestTotals = {
    decisions: lines.length, answers: count('answer'), allows: count('allow'), denies: count('deny'),
    handOvers: count('hand-over'), lapses: count('lapse'), guardForbidden,
  };
  const per = new Map<string, number>();
  for (const l of lines) per.set(l.coordinator, (per.get(l.coordinator) ?? 0) + 1);
  const byCoordinator = [...per].map(([coordinator, decisions]) => ({ coordinator, decisions }))
    .sort((a, b) => b.decisions - a.decisions || a.coordinator.localeCompare(b.coordinator));
  return { ok: true, digest: { totals, byCoordinator, lines } };
}

/** The one `coord` push (spec §10): a title with the count, a body that names what was decided (never empty,
 *  D-5302), one tag per day so a repeat replaces, and the deep link to that day's digest screen. */
export function digestPushCopy(day: string, t: DigestTotals): { title: string; body: string; tag: string; url: string } {
  const parts = [
    [t.answers, 'answered'], [t.allows, 'allowed'], [t.denies, 'denied'], [t.handOvers, 'handed over'], [t.lapses, 'lapsed'],
  ].filter(([n]) => (n as number) > 0).map(([n, w]) => `${n} ${w}`);
  return {
    title: `Coordinators decided ${t.decisions} ${t.decisions === 1 ? 'thing' : 'things'} in your name`,
    body: `${parts.join(' · ')} — tap to review and correct`,
    tag: `digest-${day}`,
    url: `/digest?day=${day}`,
  };
}

/** The mail's subject, one per row (spec §10): it names the ask or approval id. */
export const digestCorrectionSubject = (rowKind: DigestRowKind, id: number): string =>
  `Operator correction on ${rowKind} ${id}`;

/** `POST /api/digest/correct`'s body, read: the row and the operator's sentence (trimmed, one to
 *  `DIGEST_CORRECTION_MAX_CHARS` characters). */
export function parseDigestCorrectBody(raw: unknown):
  { ok: true; body: DigestCorrectBody } | { ok: false; why: 'bad-request' | 'oversize' } {
  if (raw === null || typeof raw !== 'object') return { ok: false, why: 'bad-request' };
  const b = raw as Record<string, unknown>;
  if (b['rowKind'] !== 'ask' && b['rowKind'] !== 'approval') return { ok: false, why: 'bad-request' };
  const id = b['id'];
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id < 1) return { ok: false, why: 'bad-request' };
  if (typeof b['text'] !== 'string') return { ok: false, why: 'bad-request' };
  const text = b['text'].trim();
  if (text === '') return { ok: false, why: 'bad-request' };
  if (text.length > DIGEST_CORRECTION_MAX_CHARS) return { ok: false, why: 'oversize' };
  return { ok: true, body: { rowKind: b['rowKind'], id, text } };
}

export type DigestCorrectResult =
  | { ok: true; mailId: number; deliveryId: number; to: string }
  | { ok: false; why: 'unknown-ask' | 'unknown-approval' | 'not-coordinator' | 'duplicate' | 'digest-unreadable' };

/** The correction (spec §10): durable system mail from `operator` to the row's coordinator (the held-for claimant,
 *  never the child), kind `finding`, the subject naming the row, the operator's text verbatim; and the row marked
 *  `corrected`, in the same transaction. A row that is no coordinator's decision is `not-coordinator`; a correction
 *  on the same row still undelivered is `duplicate` (the coordinator has not read the first yet). */
export function correctDigestRow(coord: CoordStore, b: DigestCorrectBody): DigestCorrectResult {
  let coordinator: string;
  if (b.rowKind === 'ask') {
    const read = coord.askForCorrection(b.id);
    if (!read.ok) return { ok: false, why: 'digest-unreadable' };
    if (read.row === null) return { ok: false, why: 'unknown-ask' };
    if (askDecision(read.row.ask) === null) return { ok: false, why: 'not-coordinator' };
    coordinator = read.row.ask.parentId;
  } else {
    const read = coord.approvalById(b.id);
    if (!read.ok) return { ok: false, why: 'digest-unreadable' };
    if (read.row === null) return { ok: false, why: 'unknown-approval' };
    if (approvalDecision(read.row) === null) return { ok: false, why: 'not-coordinator' };
    coordinator = read.row.parentId;
  }
  const subject = digestCorrectionSubject(b.rowKind, b.id);
  // D-5493 (4): said, never silently dropped as `queueSystemMail`'s dedupe would.
  if (coord.hasOutstandingMail('operator', null, coordinator, subject)) return { ok: false, why: 'duplicate' };
  const q = coord.correctWithMail(b.rowKind, b.id, () => insertSystemMailTx(coord, null,
    { fromId: 'operator', toId: coordinator, runId: null, kind: 'finding', subject, body: b.text }));
  return { ok: true, mailId: q.mailId, deliveryId: q.deliveryId, to: coordinator };
}
