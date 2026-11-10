// ccrc's command names are the library's (the take-up plan, refinement (j)): `./frame` exports no list of them, so the
// type DocFrame.command takes is the reference, held equal both ways.
import type { DocFrame } from '@synapsium-labs/docserver/host';
import { expectTypeOf, test } from 'vitest';
import type { ReaderCommand } from '../src/docs/reader/policy';

test('ReaderCommand is the name type DocFrame.command takes', () => {
  expectTypeOf<ReaderCommand>().toEqualTypeOf<Parameters<DocFrame['command']>[0]>();
});
