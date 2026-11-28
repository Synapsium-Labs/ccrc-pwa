// The console's check of the act journal's signed head (Overlord W2, act journal plan Task A3, question 11): L1, pure over the ports
// it is handed (the head read, the device's kept head, and an Ed25519 check), so the hook that binds them (`useActHead.ts`, L4) decides
// nothing. One pass: read the kept head (storage that throws reads as none, and the page still renders); ask the head read for the
// digest at the kept sequence; check the newest head's signature over the one preimage (`shared/actJournalHead.ts#actHeadPreimage`);
// compare by `headExtends`; keep the newest head only when its signature verified and it extends the kept one (or none was kept), so a
// failed check keeps nothing.
import {
  actHeadPreimage, headExtends, isActHead, type ActHeadReadWire, type DigestAtKept, type HeadPosition,
} from '../../../shared/actJournalHead';
import type { ActHeadVerify, ActHeadView } from './actHeadWords';

/** An Ed25519 check: `true`/`false` for a check made, `cannot-verify-here` for a browser with no Ed25519 in WebCrypto. */
export type Ed25519Check = (publicKeyPem: string, preimage: string, signatureB64: string) => Promise<boolean | 'cannot-verify-here'>;

export interface ActHeadPorts {
  /** The head read, with the kept sequence as `at` (or none). A failed read throws or answers null. */
  readonly read: (at: number | null) => Promise<ActHeadReadWire | null>;
  readonly kept: { get(): HeadPosition | null; set(p: HeadPosition): void };
  readonly verify: Ed25519Check;
}

const HEX64 = /^[0-9a-f]{64}$/;
const isPosition = (v: unknown): v is HeadPosition =>
  typeof v === 'object' && v !== null && Number.isSafeInteger((v as HeadPosition).sequence) && (v as HeadPosition).sequence >= 1
  && typeof (v as HeadPosition).digest === 'string' && HEX64.test((v as HeadPosition).digest);

/** One check. Never throws: a failed read is `unmeasured`, a throwing store or verifier is treated as none kept or cannot-verify. */
export async function checkActHead(ports: ActHeadPorts): Promise<ActHeadView> {
  let kept: HeadPosition | null = null;
  try { const k = ports.kept.get(); kept = isPosition(k) ? k : null; } catch { kept = null; }
  let wire: ActHeadReadWire | null;
  try { wire = await ports.read(kept === null ? null : kept.sequence); } catch { wire = null; }
  if (wire === null || wire.v !== 1) return { kind: 'unmeasured' };
  if (wire.head === 'absent') return { kind: 'none' };
  const head = wire.head;
  if (!isActHead(head)) return { kind: 'unmeasured' };
  const offered: HeadPosition = { sequence: head.sequence, digest: head.digest };
  const atKept: DigestAtKept = kept === null ? 'absent' : wire.at !== null && wire.at.sequence === kept.sequence ? wire.at.digest : 'unmeasured';
  const extendsKept = headExtends(kept, offered, atKept);
  let verify: ActHeadVerify = 'not-signed';
  if (head.unsigned === null) {
    const pre = actHeadPreimage(head);
    if (head.signature === null || wire.publicKeyPem === null || pre === null) verify = 'failed';
    else {
      try {
        const v = await ports.verify(wire.publicKeyPem, pre, head.signature);
        verify = v === 'cannot-verify-here' ? 'cannot-verify-here' : v ? 'verified' : 'failed';
      } catch { verify = 'cannot-verify-here'; }
    }
  }
  if (verify === 'verified' && (extendsKept === 'extends' || extendsKept === 'first')) {
    try { ports.kept.set(offered); } catch { /* storage that refuses keeps nothing; the line still renders */ }
  }
  return { kind: 'read', sequence: head.sequence, unsigned: head.unsigned, verify, extendsKept, keptSequence: kept?.sequence ?? null };
}
