// D-7406 (plan docs/superpowers/plans/2026-10-29-test-box.md, Task TB4; spec §2.3 "Static units, one narrow polkit
// rule"). L3: the service's only reach into the system manager. It starts, stops and reads the state of the box's
// STATIC units by name and nothing else: every name is checked against the polkit rule's own regex before any call,
// it never builds a unit's properties, and `systemctl` is run through an exec seam with a fixed argv per verb. The
// fleet agent's entry point imports nothing that reaches this file (`agent/test/testbox-imports.test.ts`).
import type { Exec } from './exec.js';

/** The polkit rule's regex (TB7's `deploy/testbox/polkit/50-ccrc-testbox.rules` spells the same one). */
export const UNIT_NAME = /^ccrc-testbox-((prepare|run)@[0-9]+|clean@([0-9]+|install)|install|tools)\.service$/;

export class UnitRefusal extends Error {}

/** A unit name, checked. */
export function checkUnit(name: string): string {
  if (!UNIT_NAME.test(name)) throw new UnitRefusal(`not a test box unit: ${JSON.stringify(name)}`);
  return name;
}

const slot = (k: number): string => {
  if (!Number.isInteger(k) || k < 1) throw new UnitRefusal(`not a run number: ${String(k)}`);
  return String(k);
};

export const units = {
  prepare: (k: number): string => checkUnit(`ccrc-testbox-prepare@${slot(k)}.service`),
  run: (k: number): string => checkUnit(`ccrc-testbox-run@${slot(k)}.service`),
  clean: (k: number | 'install'): string => checkUnit(`ccrc-testbox-clean@${k === 'install' ? k : slot(k)}.service`),
  install: (): string => checkUnit('ccrc-testbox-install.service'),
  tools: (): string => checkUnit('ccrc-testbox-tools.service'),
};

/** How a unit's main process ended: its exit, a signal as 128 plus its number, the shell's reading. */
export interface UnitEnd { readonly exit: number; readonly result: string }

/** The port the run manager drives. `run` starts a unit and resolves when it has stopped again. */
export interface SystemManager {
  run(unit: string): Promise<UnitEnd>;
  stop(unit: string): Promise<void>;
  active(unit: string): Promise<boolean>;
}

/** `show`'s `Key=Value` lines to a map. */
export function parseShow(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split('\n')) {
    const i = line.indexOf('=');
    if (i > 0) out.set(line.slice(0, i), line.slice(i + 1));
  }
  return out;
}

/** The shell's base for a signal-ended process. */
const SIGNAL_EXIT_BASE = 128;
/** A status `show` could not give: read as a failure, never as a pass. */
const UNKNOWN_EXIT = 255;

/** `ExecMainCode` (`exited`, `killed`, `dumped`, or their numbers 1, 2, 3) and `ExecMainStatus` to one exit word. */
export function unitExit(show: ReadonlyMap<string, string>): number {
  const code = show.get('ExecMainCode') ?? '';
  const status = Number(show.get('ExecMainStatus') ?? 'NaN');
  if (!Number.isInteger(status) || status < 0) return UNKNOWN_EXIT;
  if (code === 'killed' || code === 'dumped' || code === '2' || code === '3') return SIGNAL_EXIT_BASE + status;
  return status;
}

/** The main process's `ExecMainCode`s: `exited`, `killed`, `dumped`, or their numbers. Anything else (`0`, or the
 *  field absent) means the main process never ran. */
const MAIN_RAN = new Set(['exited', 'killed', 'dumped', '1', '2', '3']);

/** A unit's end from `start --wait`'s own status and `show`. `ExecMain*` describe the main process only, and after a
 *  start that failed before it (an `ExecStartPre=` that refused, a unit not found, masked or denied) they are the
 *  defaults or the last run's: so 0 is a pass only when `start` exited 0, `Result=` is `success` and the main process
 *  ran. Every other 0 reads as `UNKNOWN_EXIT`; a non-zero exit of the main is kept as it is. */
export function unitEnd(started: { readonly status: number; readonly killed: boolean }, show: ReadonlyMap<string, string>): UnitEnd {
  const result = show.get('Result') ?? 'unknown';
  if (!MAIN_RAN.has(show.get('ExecMainCode') ?? '')) return { exit: UNKNOWN_EXIT, result };
  const exit = unitExit(show);
  if (exit === 0 && (started.status !== 0 || started.killed || result !== 'success')) return { exit: UNKNOWN_EXIT, result };
  return { exit, result };
}

/** The real manager: `systemctl start --wait`, `stop` and `show` of a checked name, nothing else. `start --wait` runs
 *  under the long bound (`CCRC_TESTBOX_UNIT_MAX`, which the units' own `RuntimeMaxSec=` also is, TB7); a client the
 *  bound ended stops the unit before the end is read, so nothing runs on after the service has moved on. */
export function systemctlManager(short: Exec, long: Exec, systemctl = 'systemctl'): SystemManager {
  const exec = short;
  return {
    async run(unit) {
      const name = checkUnit(unit);
      const started = await long(systemctl, ['start', '--wait', name]);
      if (started.killed) await exec(systemctl, ['stop', name]);
      const r = await exec(systemctl, ['show', '-p', 'ExecMainCode', '-p', 'ExecMainStatus', '-p', 'Result', name]);
      return unitEnd(started, parseShow(r.stdout));
    },
    async stop(unit) {
      await exec(systemctl, ['stop', checkUnit(unit)]);
    },
    async active(unit) {
      const r = await exec(systemctl, ['show', '-p', 'ActiveState', checkUnit(unit)]);
      const s = parseShow(r.stdout).get('ActiveState');
      return s === 'active' || s === 'activating' || s === 'deactivating' || s === 'reloading';
    },
  };
}
