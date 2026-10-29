// D-7406 (plan docs/superpowers/plans/2026-10-29-test-box.md, Task TB4; spec §2.2 "XFS, settled"). L3: the start-up
// reflink probe. A probe file is written under the run root and cloned with `cp --reflink=always`; a failure makes the
// box `down` (`status.ts`), so a filesystem without reflink never silently turns every run into a full copy. Both
// files are removed whatever the answer.
import { rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Exec } from './exec.js';
import type { ProbeResult } from './status.js';

export async function reflinkProbe(root: string, exec: Exec, cp = 'cp'): Promise<ProbeResult> {
  const src = path.join(root, '.reflink-probe');
  const dst = path.join(root, '.reflink-probe.clone');
  try {
    writeFileSync(src, 'ccrc test box reflink probe\n', { mode: 0o600 });
    const r = await exec(cp, ['--reflink=always', '--', src, dst]);
    if (r.status === 0) return { ok: true };
    const why = r.stderr.split('\n').map((l) => l.trim()).find((l) => l !== '');
    return { ok: false, detail: why ?? `cp exit ${String(r.status)}` };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  } finally {
    rmSync(src, { force: true });
    rmSync(dst, { force: true });
  }
}
