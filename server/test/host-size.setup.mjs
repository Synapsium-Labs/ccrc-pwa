// `setupFiles` entry: THE TEST BOX IS NOT THE FLEET HOST (D-8920).
//
// The run cap is derived from the machine the fleet runs on, and in local mode the server measures its own box
// (`src/io.ts#localIO.pressureMeasured`, through `agent/src/pressure.ts#measureMachine`). Well over a hundred files
// here build a real `FleetWatcher` over that adapter, and its pressure beat would measure whatever machine runs the
// suite. Two things would then depend on the runner and not on the code:
//   - the cap in force in every rig that leaves the cap automatic: one number on a laptop, another on a CI runner;
//   - the automatic cap's feed record (`PressureLane.noteAutomaticCap`), one more `coord` row in every rig that
//     archives, on every box whose derived cap is not the seeded number.
//
// So every worker starts with the box's memory UNMEASURABLE: `os.totalmem` throws, `measureMachine` answers `null`,
// the local adapter says `read-failed`, and an automatic cap is the stored number, exactly as it was before the cap was
// derived. Nothing in `src/` changes for it, and `os.totalmem` has one caller in the tree, that seam. A test that wants
// the real measurement asks for it by name: `withRealHostSize` (`test/hostSize.ts`). Pinned by `host-pressure.test.ts`.
import os from 'node:os';

const REAL = Symbol.for('ccrc.test.host-size.real-totalmem');
if (globalThis[REAL] === undefined) {
  globalThis[REAL] = os.totalmem;
  os.totalmem = () => { throw new Error('the test box is not the fleet host: this suite does not measure its size'); };
}
