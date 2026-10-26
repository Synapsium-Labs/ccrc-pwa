// ARCH-42 (#777): a port double's `bindingsOf`. A site moved onto `CoordStore.bindingsOf` reads through the view; a double
// that answered the readers before keeps answering them, because the view it gets is the store's own (`bindingsOver`) over
// the double's readers.
import { bindingsOver, type BindingReadPort, type SessionBindings } from '../src/coord/bindingReads.js';

type Readers = Pick<BindingReadPort, 'openRunsForSession'> & Partial<Pick<BindingReadPort, 'bindingRunsOf'>>;

/** `fake` with a `bindingsOf` over its own readers, each looked up at the read, so a reader patched later is the one read.
 *  A double with no `bindingRunsOf` throws if an answer that reads the series is asked. */
export function withBindingsOf<T extends Readers>(fake: T): T & { bindingsOf(sessionId: string): SessionBindings } {
  const port: Pick<BindingReadPort, 'openRunsForSession' | 'bindingRunsOf'> = {
    openRunsForSession: (...a) => fake.openRunsForSession(...a),
    bindingRunsOf: (...a) => {
      if (fake.bindingRunsOf === undefined) throw new Error('withBindingsOf: this double has no bindingRunsOf');
      return fake.bindingRunsOf(...a);
    },
  };
  return Object.assign(fake, { bindingsOf: (sessionId: string): SessionBindings => bindingsOver(port, sessionId) });
}
