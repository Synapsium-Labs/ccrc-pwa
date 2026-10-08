// The box token at boot, ring L3 (spec 4.2, 4.2.1 and 4.10; D-4388): an L3
// composition helper that `index.ts` (L5) calls once and whose warnings it
// prints. Order: finish a recorded promotion; read mail.token; recover a proved
// server-written file; refuse a retired value; mint if absent with no history,
// recover if absent with history; adopt a hand-made value; read the auxiliary
// files; then, on a recorded both box only, make the fleet file agree.
//
// Never prints a value, a code or a digest: every warning carries paths,
// display sequence numbers and words only.
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import type { NodeRole } from '../../../shared/api.js';
import type { FleetMode, RoleSource } from '../config.js';
import { BoxTokenHolder, readMailToken, type HolderSlots } from '../coord/token.js';
import {
  fileExists, mintGenerationId, mintValue, readAgentEnvMarksFleet, readRetired, readState, readValueFile, renameOverAtomic,
  tokenPaths, valueDigestHex, writeFleetTokenFile, writeGenerationFile, writeState, writeValueFileAtomic,
  type TokenPaths, type ValueRead,
} from './files.js';
import {
  CONFIRM_DEADLINE_MS, GRACE_HARD_MS, GRACE_MS, adoptedState, bothRoleWriterArmed, mintedState, owe, promotedState,
  provedWrite, recoveryPlan, type BoxTokenState, type FileMetaLike, type WriteRecord,
} from './policy.js';
import { GENERATION_ID_RE, type OwedReason } from '../../../shared/box-token.js';

export interface BootInput { mailTokenPath: string; home: string; role: NodeRole; roleSource: RoleSource; fleetMode: FleetMode; now: number }
/** `agentEnvMarksFleet` is an addition to the contract's shape: the driver's gate needs the answer boot used. */
export interface BootResult {
  holder: BoxTokenHolder; state: BoxTokenState | null; mintFailed: boolean;
  bothWriterArmed: boolean; agentEnvMarksFleet: boolean; warnings: string[];
}

const W = (line: string): string => `ccrc-server: box token: ${line}`;
const errno = (e: unknown): string => (e as NodeJS.ErrnoException)?.code ?? 'EIO';
const PENDING_FILE_RE = /^mail-pending-([0-9a-f]{16})\.token$/;

function likeOf(r: ValueRead | null): FileMetaLike | null {
  if (r === null) return null;
  if (r.kind === 'value') return { meta: r.meta, usable: true, placeholder: false, digest: valueDigestHex(r.value) };
  if (r.kind === 'unusable') return { meta: r.meta, usable: false, placeholder: false, digest: null };
  return { meta: null, usable: false, placeholder: r.kind === 'placeholder', digest: null };   // absent: meta null
}
const recOf = (r: ValueRead): WriteRecord | null =>
  r.kind === 'value' ? { dev: r.meta.dev, ino: r.meta.ino, writtenAtMs: Math.ceil(r.meta.mtimeMs) } : null;

/** The refusal for a hand-made mail.token is `readMailToken`'s own throw (its classes and words), so boot
 *  refuses exactly as today. A file that changed between the two reads still refuses. */
function refuseAsToday(p: string, detail: string): never {
  readMailToken(p);
  throw new Error(`${p}: ${detail}`);
}

/** A state or retired file that cannot be READ (EACCES, EIO, EISDIR...) is not an unusable one: reading it as "no
 *  history" would rewrite box-token.json and lose the hand-out record, the retired history and the owed reason on a
 *  transient error. Boot refuses instead, naming the path and the errno only (D-4403 item 2). */
function refuseUnreadable(p: string, code: string): never {
  throw new Error(`${p}: unreadable (${code}); boot refuses rather than rewrite it`);
}

interface Ctx { state: BoxTokenState | null; current: string | null; mintFailed: boolean; warnings: string[] }

export async function bootBoxToken(i: BootInput): Promise<BootResult> {
  const paths = tokenPaths(i.mailTokenPath, i.home);
  const now = i.now;
  const holder = new BoxTokenHolder();
  const ctx: Ctx = { state: null, current: null, mintFailed: false, warnings: [] };
  const warn = (line: string): void => { ctx.warnings.push(W(line)); };

  const retiredRead = await readRetired(paths.retired);
  if (retiredRead.kind === 'unreadable') refuseUnreadable(paths.retired, retiredRead.code);
  if (retiredRead.kind === 'unusable') warn(`${paths.retired} is unusable; a written-back retired value cannot be recognised until it is repaired`);
  const retired = retiredRead.kind === 'retired' ? retiredRead.digests : [];
  holder.setRetired(retired);
  const isRetired = (v: string): boolean => retired.includes(valueDigestHex(v));

  const agentEnvMarksFleet = await readAgentEnvMarksFleet(paths.agentEnv);   // D-4399
  const armed = bothRoleWriterArmed({ role: i.role, roleSource: i.roleSource, fleetMode: i.fleetMode, agentEnvMarksFleet });

  const sr = await readState(paths.state);
  if (sr.kind === 'unreadable') refuseUnreadable(paths.state, sr.code);
  ctx.state = sr.kind === 'state' ? sr.state : null;
  if (sr.kind === 'unusable') warn(`${paths.state} is unusable; value files beside it are treated as unverifiable`);

  // 1. Finish a recorded promotion before anything reads mail.token (spec 4.2 step 1, §5).
  if (ctx.state?.promoting) ctx.state = await finishPromotion(ctx.state, paths, now, isRetired, warn);

  const mint = async (owed: OwedReason | null, line: string | null): Promise<void> => {
    const v = mintValue();
    let rec: WriteRecord | null = null;
    try {
      rec = await writeValueFileAtomic(paths.current, `${v}\n`);
    } catch (e) {
      // A rejection from the post-rename directory fsync means the file WAS replaced with its durability unproven
      // (D-4404): read it back, and if the new value is in place, record it rather than boot unconfigured over it.
      const after = await readValueFile(paths.current);
      if (after.kind === 'value' && after.value === v) {
        rec = recOf(after);
        warn(`could not confirm the directory sync after writing ${paths.current} (${errno(e)}); the new value is in place`);
      } else {
        ctx.mintFailed = true;
        if (ctx.state !== null) ctx.state = { ...ctx.state, mintFailedAt: now };
        warn(`could not mint at ${paths.current} (${errno(e)}); every box-token lane answers 401 until a mint succeeds — the driver retries each minute`);
        return;
      }
    }
    // `owed` is never null over a prior state: every call with a prior names its reason.
    ctx.state = mintedState(now, rec as WriteRecord, ctx.state, owed, mintGenerationId());
    ctx.current = v;
    if (line !== null) warn(line);
  };
  const adopt = (value: string): void => {
    ctx.state = adoptedState(now, ctx.state);
    ctx.current = value;
    warn(`adopted the hand-made value at ${paths.current}; the first rotation is owed`);
  };
  const recover = async (s: BoxTokenState, value: string, already: WriteRecord | null): Promise<void> => {
    ctx.state = await recoverFromPrevious(s, value, paths, now, already, warn);
    ctx.current = value;
  };

  // 2.-6. mail.token and its arms.
  const cur = await readValueFile(paths.current);
  const s0 = ctx.state;
  if (cur.kind === 'unreadable' || cur.kind === 'placeholder') refuseAsToday(paths.current, cur.kind);
  if (cur.kind === 'unusable') {
    const prevRead = s0?.previous ? await readValueFile(paths.previous) : null;
    const plan = recoveryPlan({ state: s0, current: likeOf(cur) as FileMetaLike, pending: null, previous: likeOf(prevRead), retired });
    if (plan.kind !== 'from-previous' || prevRead?.kind !== 'value' || s0 === null) {
      refuseAsToday(paths.current, 'no usable value, and no proved server-written sibling');
    }
    await recover(s0, prevRead.value, null);
  } else if (cur.kind === 'absent') {
    if (s0 === null) {
      await mint(null, `minted a new value at ${paths.current} (no token existed)`);
    } else {
      const prevRead = s0.previous ? await readValueFile(paths.previous) : null;
      const plan = recoveryPlan({ state: s0, current: likeOf(cur) as FileMetaLike, pending: null, previous: likeOf(prevRead), retired });
      if (plan.kind === 'from-previous' && prevRead?.kind === 'value') await recover(s0, prevRead.value, null);
      else await mint('recovered', `${paths.current} is missing on a box with history and no sibling qualifies; minted a new value and a rotation is owed`);
    }
  } else if (isRetired(cur.value)) {
    await mint('retired-written-back', `${paths.current} held a retired value; it was not adopted, a fresh value was minted and a rotation is owed`);
  } else if (s0 === null) {
    adopt(cur.value);
  } else if (s0.recovering !== null && s0.previous !== null) {
    // A recovery that stopped after its write and before its record: mail.token already holds the sibling.
    const prevRead = await readValueFile(paths.previous);
    if (prevRead.kind === 'value' && prevRead.value === cur.value) await recover(s0, cur.value, recOf(cur));
    else adopt(cur.value);
  } else if (s0.origin !== 'adopted' && !provedWrite(likeOf(cur) as FileMetaLike, s0.current.write)) {
    adopt(cur.value);   // something other than the driver changed mail.token: adopted as today (spec 4.2)
  } else {
    ctx.current = cur.value;
  }

  // Auxiliary files: pending and previous through the same measured reads.
  const slots: HolderSlots = { current: ctx.current, pending: [], previous: null };
  let st = ctx.state as BoxTokenState | null;
  if (st !== null && sr.kind === 'state') {
    const keep: BoxTokenState['pending'] = [];
    const pend: { id: string; value: string }[] = [];
    for (const p of st.pending) {
      if (p.handedOutAt === null) { await fsp.rm(paths.pending(p.id), { force: true }); continue; }   // staged: discarded
      const r = await readValueFile(paths.pending(p.id));
      if (r.kind === 'value' && !isRetired(r.value)) { keep.push(p); pend.push({ id: p.id, value: r.value }); continue; }
      warn(`${paths.pending(p.id)} (generation #${p.seq}) carries no usable value; its slot is empty and a rotation is owed`);
      st = owe(st, 'aux-unusable');
    }
    st = { ...st, pending: keep };
    slots.pending = pend;
    if (st.previous !== null) {
      const r = await readValueFile(paths.previous);
      if (r.kind === 'value' && !isRetired(r.value)) slots.previous = { value: r.value, until: st.previous.hardUntil };
      else {
        warn(`${paths.previous} carries no usable value; its slot is empty and a rotation is owed`);
        st = owe({ ...st, previous: null }, 'aux-unusable');
      }
    }
  } else if (st !== null) {
    // Value files with no state file: accepted as unverifiable; a forward rotation's confirmation discards them.
    const found = await unverifiable(paths, now, isRetired);
    if (found.pending.length > 0 || found.previous !== null) {
      st = owe({ ...st, pending: found.pending.map((f) => f.gen), previous: found.previous?.prev ?? null }, 'unverifiable-files');
      slots.pending = found.pending.map((f) => ({ id: f.gen.id, value: f.value }));
      slots.previous = found.previous ? { value: found.previous.value, until: found.previous.prev.hardUntil } : null;
      warn(`value files beside ${paths.current} have no state record; they stay accepted as unverifiable and a rotation is owed`);
    }
  }
  holder.setSlots(slots);

  // 7. The both-role boot write (spec 4.10), recorded role only.
  if (armed && ctx.current !== null && st !== null) {
    try {
      const f = await readValueFile(paths.fleetFile);
      if (f.kind !== 'value' || f.value !== ctx.current) await writeFleetTokenFile(paths.fleetFile, ctx.current);
      if (st.current.id !== null) await writeGenerationFile(paths.generation, st.current.id);
      st = { ...st, fleetConfirmed: st.current.id };
    } catch (e) {
      warn(`could not write ${paths.fleetFile} (${errno(e)}); this box's notify.sh is refused until it is written`);
    }
  } else if (i.role === 'both' && i.roleSource !== 'recorded' && i.fleetMode === 'local' && !agentEnvMarksFleet
    && !(await fileExists(paths.fleetFile))) {
    warn(`this box's role is not recorded as both, so the server will not write ${paths.fleetFile}; with no file there, notify.sh is refused (record CCRC_ROLE=both in ~/.ccrc/ccrc.env)`);
  }

  if (st !== null) {
    try { await writeState(paths.state, st); } catch (e) {
      warn(`could not record ${paths.state} (${errno(e)}); the driver records it on its next tick`);
    }
  }
  return { holder, state: st, mintFailed: ctx.mintFailed, bothWriterArmed: armed, agentEnvMarksFleet, warnings: ctx.warnings };
}

/** Spec 4.2.1's act: (a) record recovering, (b) write the sibling's value into mail.token, (c) record it as
 *  current, owe a rotation, record the recovery, then delete mail-previous.token so its slot empties. */
async function recoverFromPrevious(state: BoxTokenState, value: string, paths: TokenPaths, now: number,
  already: WriteRecord | null, warn: (l: string) => void): Promise<BoxTokenState> {
  const prev = state.previous;
  if (prev === null) throw new Error('recoverFromPrevious: no previous recorded');
  const brokenSeq = state.current.seq;
  let s: BoxTokenState = { ...state, recovering: { source: 'previous' } };
  if (already === null) await writeState(paths.state, s);                       // (a)
  const rec = already ?? await writeValueFileAtomic(paths.current, `${value}\n`); // (b)
  s = owe({ ...s, rotationOwed: false, owedWhy: null }, 'recovered');           // (c)
  s = { ...s, current: { id: prev.id, seq: prev.seq, since: now, write: rec }, previous: null, recovering: null,
    lastBootRecovery: { at: now, source: 'previous' }, fleetConfirmed: null };
  await writeState(paths.state, s);
  await fsp.rm(paths.previous, { force: true });
  warn(`${paths.current} carries no usable value, but this server wrote it (generation #${brokenSeq}); recovered from `
    + `${paths.previous}, also written by this server. A forward rotation is owed now; the fleet box's calls may answer 401 until it confirms one.`);
  return s;
}

/** Spec §5 steps (b)-(d) from the record of (a). The pending file is proved server-written and not retired; a
 *  rename already done (pending gone, mail.token carrying its inode) needs only (d). Anything else abandons the
 *  promotion and owes a rotation (the fleet's confirmed value is lost, which only disk corruption produces).
 *  D-4404: a mail.token that is a placeholder, unreadable, or unusable without the server's own write record is
 *  not renamed over (a hand-made file still refuses boot, spec 4.2.1: the promotion is abandoned and the main read
 *  refuses it); and a previous slot is kept only when the old current was copied to it (promotedState's contract). */
async function finishPromotion(state: BoxTokenState, paths: TokenPaths, now: number,
  isRetired: (v: string) => boolean, warn: (l: string) => void): Promise<BoxTokenState> {
  const id = state.promoting?.id ?? '';
  const g = state.pending.find((p) => p.id === id);
  if (g === undefined || !GENERATION_ID_RE.test(id)) {
    warn('a recorded promotion names no pending generation; it was abandoned and a rotation is owed');
    return owe({ ...state, promoting: null }, 'recovered');
  }
  const P = await readValueFile(paths.pending(id));
  const M = await readValueFile(paths.current);
  const prevFile = async (): Promise<WriteRecord | null> => recOf(await readValueFile(paths.previous));
  const like = (r: ValueRead): FileMetaLike => likeOf(r) as FileMetaLike;
  /** Done: drop the files of the pending values this promotion dropped (promotedState keeps later handed-out ones). */
  const done = async (next: BoxTokenState): Promise<BoxTokenState> => {
    for (const p of state.pending) {
      if (p.id !== id && !next.pending.some((q) => q.id === p.id)) await fsp.rm(paths.pending(p.id), { force: true });
    }
    if (next.previous === null) await fsp.rm(paths.previous, { force: true });
    return next;
  };
  const mailTokenFit = M.kind === 'absent' || M.kind === 'value'
    || (M.kind === 'unusable' && state.origin !== 'adopted' && provedWrite(like(M), state.current.write));
  if (P.kind === 'value' && provedWrite(like(P), g.write) && !isRetired(P.value) && mailTokenFit) {
    const oldStill = M.kind === 'value' && (state.current.write === null || provedWrite(like(M), state.current.write));
    const prevWrite = oldStill && M.kind === 'value'
      ? await writeValueFileAtomic(paths.previous, `${M.value}\n`)   // (b), safe to run again
      : null;
    await renameOverAtomic(paths.pending(id), paths.current);         // (c)
    const promoted = promotedState(state, id, now, prevWrite);        // (d)
    if (M.kind !== 'unusable') return done(promoted);
    // mail.token was torn and proved server-written: this promotion was a recovery from the pending sibling
    // (spec 4.2.1 act (c), D-4404 item 5): warn, owe a forward rotation, record the recovery.
    warn(`${paths.current} carries no usable value, but this server wrote it (generation #${state.current.seq}); recovered from `
      + `${paths.pending(id)}, also written by this server. A forward rotation is owed now; the fleet box's calls may answer 401 until it confirms one.`);
    return done({ ...owe(promoted, 'recovered'), lastBootRecovery: { at: now, source: 'pending' } });
  }
  if (P.kind === 'absent' && M.kind === 'value' && M.meta.dev === g.write.dev && M.meta.ino === g.write.ino) {
    return done(promotedState(state, id, now, await prevFile()));     // (c) was already done
  }
  warn(`the recorded promotion of generation #${g.seq} could not be finished from ${paths.pending(id)}; it was abandoned and a rotation is owed`);
  return owe({ ...state, promoting: null }, 'recovered');
}

/** Pending and previous files found with no state file (a plain uninstall of an earlier build, or lost state).
 *  Each is accepted as handed out, so the forward rotation's confirmation discards it. */
async function unverifiable(paths: TokenPaths, now: number, isRetired: (v: string) => boolean): Promise<{
  pending: { gen: BoxTokenState['pending'][number]; value: string }[];
  previous: { prev: NonNullable<BoxTokenState['previous']>; value: string } | null;
}> {
  let names: string[] = [];
  try { names = await fsp.readdir(paths.dir); } catch { names = []; }
  const pending: { gen: BoxTokenState['pending'][number]; value: string }[] = [];
  for (const n of names.sort()) {
    const m = PENDING_FILE_RE.exec(n);
    if (m === null || pending.length >= 2) continue;
    const r = await readValueFile(path.join(paths.dir, n));
    const rec = recOf(r);
    if (r.kind !== 'value' || rec === null || isRetired(r.value)) continue;
    pending.push({ gen: { id: m[1], seq: 0, stagedAt: now, handedOutAt: now, confirmBy: now + CONFIRM_DEADLINE_MS, write: rec }, value: r.value });
  }
  const pr = await readValueFile(paths.previous);
  const prec = recOf(pr);
  const previous = pr.kind === 'value' && prec !== null && !isRetired(pr.value)
    ? { prev: { id: null, seq: 0, graceUntil: now + GRACE_MS, hardUntil: now + GRACE_HARD_MS, currentPresented: false, write: prec }, value: pr.value }
    : null;
  return { pending, previous };
}
