// rss-peak.mjs — TEST-ONLY, never shipped. The pure reader behind preload-rss.mjs (D-6964), kept apart from the preload so a
// unit case can inject the status reader and the fallback and need no environment seam (spec §10.1). It imports NOTHING:
// history-lib.test.ts's FIXTURE_RING forbids every import here (D-6965), so the only code that touches the process is the
// preload that calls it.
//
// Why not `process.resourceUsage().maxRSS`: on Linux a forked-then-exec'd child inherits the resident size of the parent that
// spawned it (the kernel carries the high-water mark across the exec), so a sweep spawned by a fat test runner could report the
// runner's size when the runner was the larger, not its own. `VmHWM` in /proc/self/status is the process's own peak, in kB as the kernel prints it. Where that
// file is absent (macOS), unreadable, or has no parseable positive `VmHWM` line, the answer is maxRSS (KiB on Linux, and the
// only figure the platform offers elsewhere), truncated to an integer of at least 1, and 1 when it is not finite.
export function ownPeakKiB(readStatus, fallbackKiB) {
  try {
    const m = /^VmHWM:\s+(\d+)\s+kB$/m.exec(readStatus());
    if (m) {
      const n = Number(m[1]);
      if (Number.isSafeInteger(n) && n > 0) return { kib: n, source: 'vmhwm' };
    }
  } catch {
    // an unreadable status file is the fallback's case, never a throw out of the exit hook
  }
  const f = Math.trunc(Number(fallbackKiB()));
  return { kib: Number.isFinite(f) ? Math.max(1, f) : 1, source: 'maxrss' };
}
