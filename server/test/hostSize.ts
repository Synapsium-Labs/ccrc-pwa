// The one way a test measures the box it runs on (D-8920). `host-size.setup.mjs` makes the box's memory
// unmeasurable in every worker, so no rig derives a run cap from the runner; this puts the real `os.totalmem` back for
// one call and pins it again afterwards, whatever the call does.
import os from 'node:os';

const REAL = Symbol.for('ccrc.test.host-size.real-totalmem');

export async function withRealHostSize<T>(fn: () => T | Promise<T>): Promise<T> {
  const real = (globalThis as Record<symbol, unknown>)[REAL];
  if (typeof real !== 'function') throw new Error('host-size.setup.mjs did not run: the suite is measuring the test box');
  const pinned = os.totalmem;
  os.totalmem = real as typeof os.totalmem;
  try { return await fn(); } finally { os.totalmem = pinned; }
}
