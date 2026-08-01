// The POSITIVE CONTROL. Without it, "nothing in this directory compiles" would
// satisfy every pin next door and the mechanism could be arbitrarily
// over-strict without anything saying so — the same reason `guardRunner` has a
// "the guard is not a blanket refusal" test.
//
// It also pins that the brand does NOT cost the shapes layer 2b had to parse by
// hand: an argv read into a local first (so `verbSupported` can see it) and a
// two-way ternary between two entries both keep flowing, with no cast, because
// the TYPE flows where a text scan had to be taught each shape one at a time.
//
// This file MUST compile clean. `ccdargv-brand.test.ts` asserts exit code 0.
import { CCD_ARGV, verbSupported } from '../../../src/ccdargv.js';
import type { Deps } from '../../../src/server.js';

declare const deps: Deps;

export async function legit(id: string, project: string, enable: boolean): Promise<boolean> {
  // Read once for the verb gate, passed again as a value: the Task 13 shape.
  const argv = CCD_ARGV.prStateSession(id);
  if (!verbSupported(deps.fleetState, argv)) return false;
  const read = await deps.runCcd(argv);

  // Direct call at the call site.
  const added = await deps.runCcd(CCD_ARGV.wsAdd(project));

  // Two-way ternary between two entries: the `enable`/`start` picker.
  const started = await deps.runCcd(
    enable ? CCD_ARGV.enable('claude', project) : CCD_ARGV.start('claude', project),
  );

  return read.ok && added.ok && started.ok;
}
