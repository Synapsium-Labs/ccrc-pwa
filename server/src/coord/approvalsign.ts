/**
 * The server box's approval signing key (coordinator-first routing spec 2026-10-17 §6.4, plan Task 16, D-5298).
 *
 * An Ed25519 pair, created by the server on its first start in its own state directory (`cfg.ccrcDir`, the server
 * box's `~/.ccrc`), the private half at mode 0600, and never sent anywhere: on a two-box install nothing on the fleet
 * box can read it, so a ruling the child's hook verifies with the pinned public key was produced here. The public half
 * is served at `GET /api/approvals/key`, and the fleet box's install spine pins it once (Task 14, D-5487).
 *
 * On `--role both` that separation is false (spec §6.1): the key sits beside the sessions, which run as the same
 * user. `rulingsAllowedHere` is the gate: such a server mints and signs nothing unless the operator placed
 * `~/.ccrc/approvals-single-box`.
 *
 * L3: it owns two files on this box's disk and the one signing call; it decides nothing about a ruling's content.
 */
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  APPROVAL_SIGNING_KEY_FILE, approvalRulingBytes, type ApprovalRulingRecord,
} from '../../../shared/api.js';
import type { NodeRole } from '../../../shared/node-role.js';

/** The operator's opt-in file on a single box (spec §6.1): without it a `both` server mints no rulings. */
export const APPROVALS_SINGLE_BOX_FILE = 'approvals-single-box';

/** The server box's kill switch (spec §6.8): present, the server mints nothing and signs nothing. The operator's,
 *  placed by hand; nothing in this tree writes it. */
export const APPROVALS_DISABLED_FILE = 'approvals-disabled';

/** The key pair this process signs with, loaded or created once. */
export interface ApprovalSigner {
  /** The base64 Ed25519 signature over the record's canonical bytes, or `null` for a record with no canonical form. */
  signRuling(record: ApprovalRulingRecord): string | null;
  /** The public key, PEM SPKI, as `GET /api/approvals/key` serves it. */
  publicKeyPem(): string;
}

/** The private key's path in the server's state directory. */
export const approvalKeyPath = (ccrcDir: string): string => path.join(ccrcDir, APPROVAL_SIGNING_KEY_FILE);

/**
 * Load the key pair from `ccrcDir`, creating it on first start (mode 0600, the directory 0700 when it is made here).
 * A file that exists but is not an Ed25519 private key THROWS rather than being replaced: replacing it would rotate
 * the key every pinned fleet box refuses (D-5487), silently; the operator decides a rotation.
 */
export function loadOrCreateApprovalSigner(ccrcDir: string): ApprovalSigner {
  const file = approvalKeyPath(ccrcDir);
  let priv: KeyObject;
  if (existsSync(file)) {
    priv = createPrivateKey(readFileSync(file, 'utf8'));
    if (priv.asymmetricKeyType !== 'ed25519') throw new Error(`${file} is not an Ed25519 private key`);
  } else {
    mkdirSync(ccrcDir, { recursive: true, mode: 0o700 });
    const pair = generateKeyPairSync('ed25519');
    priv = pair.privateKey;
    // `wx`: a concurrent first start that won the race keeps its key, and this one reads it back.
    try {
      writeFileSync(file, priv.export({ type: 'pkcs8', format: 'pem' }) as string, { mode: 0o600, flag: 'wx' });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      priv = createPrivateKey(readFileSync(file, 'utf8'));
    }
    chmodSync(file, 0o600);
  }
  const pubPem = createPublicKey(priv as unknown as Parameters<typeof createPublicKey>[0]).export({ type: 'spki', format: 'pem' }) as string;
  return {
    signRuling(record) {
      const bytes = approvalRulingBytes(record);
      return bytes === null ? null : sign(null, Buffer.from(bytes, 'utf8'), priv).toString('base64');
    },
    publicKeyPem: () => pubPem,
  };
}

/**
 * Whether this server may mint and sign rulings at all (spec §6.1, §6.4): a `server` (or `fleet`) role yes; `both`
 * only when the operator placed `<home>/.ccrc/approvals-single-box`, because on one box the signature separates
 * nothing. Reads the role as `config.ts`'s `deriveRole` derived it, never the opt-in file alone.
 */
export function rulingsAllowedHere(role: NodeRole, ccrcDir: string): boolean {
  if (role !== 'both') return true;
  return existsSync(path.join(ccrcDir, APPROVALS_SINGLE_BOX_FILE));
}

/** The server box's kill switch, read at each mint and each signing (spec §6.8). */
export function serverApprovalsDisabled(ccrcDir: string): boolean {
  return existsSync(path.join(ccrcDir, APPROVALS_DISABLED_FILE));
}
