// The Windows port, B10: NTFS reports 0o666 for every entry whatever its ACL, so a mode check there is always
// "wrong". The history sweep's `fixModes` chmodded every store file and counted mode_drift on every pass, and the
// approval key's load chmodded and warned "readable beyond its owner" on every boot. On win32 both skip the mode part,
// as cli.mjs's `modesWrong` already did. (The ledger secrets' `isPrivateDir` is the same skip; ledgers-secrets.test.ts
// is its suite, red on Windows before it.)
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fixModes } from '../../ccd/history/sweep.mjs';
import { loadOrCreateApprovalSigner } from '../src/coord/approvalsign.js';
import { mkTmp } from './tmpHelpers.js';

const roots: string[] = [];
afterEach(() => { for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true }); vi.restoreAllMocks(); });
function dir(): string { const d = mkTmp('win-modes-'); roots.push(d); return d; }

describe.skipIf(process.platform !== 'win32')('mode checks on NTFS (B10)', () => {
  it('fixModes chmods nothing and counts no mode_drift', () => {
    const d = dir();
    const dbFile = path.join(d, 'history.db');
    writeFileSync(dbFile, 'x');
    mkdirSync(path.join(d, 'backups'));
    writeFileSync(path.join(d, 'backups', 'b1'), 'x');
    const counted: unknown[][] = [];
    const db = { prepare: () => ({ run: (...a: unknown[]) => { counted.push(a); } }) };
    const P = { dbFile, wal: `${dbFile}-wal`, shm: `${dbFile}-shm`, backups: path.join(d, 'backups'), journalDir: path.join(d, 'journal') };
    expect(fixModes(db, P)).toBe(0);
    expect(counted).toEqual([]);
  });

  it('the approval key loads on a second boot with no "readable beyond its owner" warning', () => {
    const d = dir();
    loadOrCreateApprovalSigner(d);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    loadOrCreateApprovalSigner(d);
    expect(warn.mock.calls.filter((c) => String(c[0]).includes('readable beyond its owner'))).toEqual([]);
  });
});
