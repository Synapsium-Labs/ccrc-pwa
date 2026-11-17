// The operator's private-name list doors (Overlord W2, private names B, Task 6; spec §9.4 rule 7, C35; plan questions 7 and
// 8). Ring L4, context C11: registered from `server.ts`, a lane source of its own for the door censuses (`NAME_LIST_DOORS`,
// `box-token-census.test.ts`). Neither consults the box token; both sit behind the session gate when sign-in is armed.
//
// `PUT /api/overlord/private-names` REPLACES the list. A widening of what the egress check refuses, so it takes the account
// gate WITH a step-up before the body is used (`auth-off` while sign-in is dark), on `credentialBodyRoute`: `no-store` on every
// answer, an explicit body cap (`oversize`), and a malformed body answered `bad-request` by the route's own error handler,
// never echoed. Then, on the key slot's own chain (`slotChains`, one upload at a time), in this order (question 7):
//   1. read the key slot: unreadable answers `write-failed` and writes nothing, never minting over it; absent mints a key in
//      memory;
//   2. build every entry under that key, the canary first, in one pass (ruled, fold: so a list mixing keys cannot arise);
//   3. a minted key is written (`writeNameListKey`); a failure answers `write-failed` and the store is untouched. A write
//      that answers stored-but-unrecorded is followed by a fresh read of the slot, and goes on only when the slot holds this
//      key (review 2344 F1);
//   4. `replacePrivateNames`, in one transaction; a failure answers `write-failed`.
// Every failure leaves a state that refuses rather than passes: a minted key with no list reads `list-missing`, and a new key
// over an old list `key-mismatch`, until the next upload, which reuses the slot's key and cures both.
//
// AN EMPTY UPLOAD IS REFUSED unless it is the console's confirmed "Clear the list" (the Settings plan's ruling, carried by the
// brief): `{ rows: [] }` alone is `bad-request`; `{ rows: [], clear: true }` stores the canary alone, so the check runs and
// finds nothing (only a list never uploaded skips it).
//
// THE PLAIN NAMES NEVER LEAVE THIS HANDLER: no log line, no journal record (slug `name-list-not-journalled`), no file, no
// error detail and no answer carries a row's text. A refusal names a row by its index only, with a reason word
// (`NAME_LIST_ROW_REFUSALS`). A row that holds a letter or digit outside a-z and 0-9 after NFKC is refused (`non-ascii`): the
// check folds to ASCII only, so storing the rest would guard part of a name and say nothing (review 2344 F3, slug
// `non-ascii-row-is-refused`); the operator enters the name's ASCII spelling.
//
// `GET /api/overlord/private-names` says whether a list is stored, never what is in it: `none`, `list` with its row count and
// time, or `unreadable` with its reason (question 8), through the one reader `readPrivateNameList`. `no-store` on it too.
import type { FastifyInstance, FastifyReply } from 'fastify';
import { credentialBodyRoute, noStoreRoute, type AccountGate } from '../accounts/gate.js';
import { refuseRoute } from '../refuse.js';
import { CANARY, entriesOf, entryOf, tokens } from '../../../shared/private-names.mjs';
import {
  NAME_LIST_BODY_MAX, NAME_LIST_KEY_SLOT, NAME_LIST_MAX_CHARS, NAME_LIST_MAX_ROWS, isNameListMode,
  type NameListRow, type NameListRowRefusal, type NameListStatus, type NameListUploaded,
} from '../../../shared/privateNames.js';
import { LEDGER_ROUTE_REFUSALS } from '../../../shared/refusal.js';
import { OperatorSecretStoredUnrecorded, SLOT_WAIT_MS, slotChains, type RegisterSecret } from '../coord/ledgersSecrets.js';
import { mintNameListKey, readNameListKey, readPrivateNameList, writeNameListKey } from './nameListRead.js';
import type { TimePorts } from '../time/ports.js';
import type { OperatorModelStore } from './store.js';

export interface NameListRouteDeps {
  /** The private store, read at request time (`deps.operatorModel`); absent on a server without one. */
  store: () => OperatorModelStore | undefined;
  ccrcDir: string;
  /** The account gate: the upload asks it for a step-up (`{ cap: null, stepUp: true }`). */
  gate: AccountGate;
  /** The clock (`uploadedAt`, the key's `setAt`) and the entropy a new key is minted from. */
  time: TimePorts;
  /** The egress masker's registration of a server-held secret (`SecretMasker.ingestSecret`): the minted key is told to it. */
  registerSecret: RegisterSecret;
  /** How long an upload waits for the one before it (`SLOT_WAIT_MS`; a test passes its own). */
  slotWaitMs?: number;
}

type Parsed = { ok: true; rows: NameListRow[] } | { ok: false; detail: string; row?: { at: number; reason: NameListRowRefusal } };
const ROW_KEYS = new Set(['text', 'mode']);
/** A letter or digit outside ASCII. Tested on the row's NFKC form, so a fullwidth or compatibility letter that folds to a-z
 *  passes, and a letter with a combining accent (which NFKC composes) does not. */
const NON_ASCII_LETTER_OR_DIGIT = /(?![\x00-\x7f])[\p{L}\p{N}]/u;
const rowRefused = (at: number, reason: NameListRowRefusal, what: string): Parsed => ({ ok: false, detail: `row ${at}: ${what}`, row: { at, reason } });

/** The upload's body, checked against the caps and the matcher's tokenizer. A detail names a row by index, never its text. */
function parseUpload(body: unknown): Parsed {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return { ok: false, detail: 'the body is { rows: [{ text, mode }] }' };
  const b = body as Record<string, unknown>;
  if (Object.keys(b).some((k) => k !== 'rows' && k !== 'clear')) return { ok: false, detail: 'the body takes rows and clear only' };
  if (!Array.isArray(b['rows'])) return { ok: false, detail: 'rows is an array' };
  const rows = b['rows'] as unknown[];
  if (b['clear'] !== undefined && b['clear'] !== true) return { ok: false, detail: 'clear is true or absent' };
  if (b['clear'] === true && rows.length > 0) return { ok: false, detail: 'clear empties the list: send it with no rows' };
  if (rows.length === 0 && b['clear'] !== true) {
    return { ok: false, detail: 'an upload with no rows would empty the list: send clear: true to clear it' };
  }
  if (rows.length > NAME_LIST_MAX_ROWS) return { ok: false, detail: `at most ${NAME_LIST_MAX_ROWS} rows` };
  const out: NameListRow[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (typeof r !== 'object' || r === null || Array.isArray(r)) return rowRefused(i, 'shape', 'not { text, mode }');
    const row = r as Record<string, unknown>;
    if (Object.keys(row).some((k) => !ROW_KEYS.has(k))) return rowRefused(i, 'keys', 'text and mode only');
    const { text, mode } = row;
    if (typeof text !== 'string' || text.length === 0 || text.length > NAME_LIST_MAX_CHARS) {
      return rowRefused(i, 'length', `text is 1 to ${NAME_LIST_MAX_CHARS} characters`);
    }
    if (!isNameListMode(mode)) return rowRefused(i, 'mode', 'mode is part, exact, run or words');
    // The check folds to a-z and 0-9 only, so any other letter or digit would be dropped from the row's entries and that part
    // of the name left unguarded, with nothing in the answer to say so (review 2344 F3, slug `non-ascii-row-is-refused`).
    if (NON_ASCII_LETTER_OR_DIGIT.test(text.normalize('NFKC'))) {
      return rowRefused(i, 'non-ascii', 'a letter or digit outside a-z and 0-9, which the check cannot match: enter the name\'s ASCII spelling');
    }
    if (tokens(text).length === 0) return rowRefused(i, 'no-token', 'no letter or digit the check can match (a-z, 0-9)');
    out.push({ text, mode });
  }
  return { ok: true, rows: out };
}

/** The status read's answer, from the reader's verdict: counts and a time, never an entry, a hash or the key. */
export function nameListStatusOf(v: ReturnType<typeof readPrivateNameList>): NameListStatus {
  if (v.state === 'list') return { state: 'list', rows: v.rows, uploadedAt: v.uploadedAt };
  if (v.state === 'unreadable') return { state: 'unreadable', reason: v.reason };
  return { state: 'none' };
}

export function registerNameListRoutes(app: FastifyInstance, deps: NameListRouteDeps): void {
  const underSlot = slotChains(deps.slotWaitMs ?? SLOT_WAIT_MS);
  const writeFailed = (reply: FastifyReply, detail: string) => refuseRoute(reply, 'write-failed', { detail });

  app.put('/api/overlord/private-names', credentialBodyRoute(NAME_LIST_BODY_MAX), async (req, reply) => {
    if (!deps.gate(req, reply, { cap: null, stepUp: true }).pass) return reply;
    const store = deps.store();
    if (store === undefined) return refuseRoute(reply, 'not-configured', { detail: 'this server has no private store' });
    const parsed = parseUpload(req.body);
    if (!parsed.ok) {
      return refuseRoute(reply, 'bad-request', { detail: parsed.detail, ...(parsed.row === undefined ? {} : { row: parsed.row.at, reason: parsed.row.reason }) });
    }
    const rows = parsed.rows;
    return underSlot(NAME_LIST_KEY_SLOT, async () => {
      const slot = (() => { try { return readNameListKey(deps.ccrcDir); } catch { return { state: 'unreadable' } as const; } })();
      if (slot.state === 'unreadable') return writeFailed(reply, 'the list\'s key cannot be read; nothing was written');
      const minted = slot.state === 'absent';
      const key = slot.state === 'value' ? slot.value : mintNameListKey(deps.time.entropy);
      let entries: ReturnType<typeof entryOf>[];
      try {
        entries = [entryOf(CANARY, 'part', key), ...rows.flatMap((r) => entriesOf(r.text, r.mode, key))];
      } catch {
        return refuseRoute(reply, 'bad-request', { detail: 'a row could not be hashed; nothing was written' });
      }
      const at = deps.time.clock.wall();
      if (minted) {
        try {
          await writeNameListKey(deps.ccrcDir, key, at, deps.registerSecret);
        } catch (e) {
          if (!(e instanceof OperatorSecretStoredUnrecorded)) return writeFailed(reply, 'the list\'s key could not be stored; nothing was written');
          // Stored but unrecorded has two causes: the value reached its slot and its record or the directory sync failed, or the
          // value's write failed and the read-back could not read the slot (review 2344 F1). So the slot is read again: the list
          // is stored only under a key the slot holds.
          const again = (() => { try { return readNameListKey(deps.ccrcDir); } catch { return { state: 'unreadable' } as const; } })();
          if (again.state !== 'value' || again.value !== key) return writeFailed(reply, 'the list\'s key could not be stored; nothing was written');
        }
      }
      const w = store.replacePrivateNames(entries, rows.length, at);
      if (!w.ok) return writeFailed(reply, 'the list could not be stored; upload it again');
      const answer: NameListUploaded = { ok: true, rows: rows.length, entries: entries.length, uploadedAt: at };
      return reply.code(200).send(answer);
    }, () => refuseRoute(reply, LEDGER_ROUTE_REFUSALS.slotBusy, { detail: 'an earlier upload has not finished; nothing was done, try again' }));
  });

  app.get('/api/overlord/private-names', { onRequest: noStoreRoute.onRequest }, (_req, reply) =>
    reply.code(200).send(nameListStatusOf(readPrivateNameList(deps.store(), deps.ccrcDir))));
}
