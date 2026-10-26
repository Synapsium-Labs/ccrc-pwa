// ARCH-42 (#777): a port double's `bindingsOf`. A site moved onto `CoordStore.bindingsOf` reads through the view; a double
// that answered the readers before keeps answering them, because the view it gets is the store's own (`bindingsOver`) over
// the double's readers.
import { bindingsOver, type BindingReadPort, type SessionBindings } from '../src/coord/bindingReads.js';

type Readers = Pick<BindingReadPort, 'openRunsForSession'> & Partial<Pick<BindingReadPort, 'bindingRunsOf'>>;

/** `fake` with a `bindingsOf` over its own readers. The method reads its RECEIVER's readers at each read, so a copy that
 *  spreads the double and overrides a reader (`{ ...fake, openRunsForSession }`) is read through its override, and a
 *  reader patched later is the one read. A double with no `bindingRunsOf` throws if an answer that reads the series is
 *  asked. */
export function withBindingsOf<T extends Readers>(fake: T): T & { bindingsOf(sessionId: string): SessionBindings } {
  return Object.assign(fake, {
    bindingsOf(this: Readers, sessionId: string): SessionBindings {
      const self = this;
      const port: Pick<BindingReadPort, 'openRunsForSession' | 'bindingRunsOf'> = {
        openRunsForSession: (...a) => self.openRunsForSession(...a),
        bindingRunsOf: (...a) => {
          if (self.bindingRunsOf === undefined) throw new Error('withBindingsOf: this double has no bindingRunsOf');
          return self.bindingRunsOf(...a);
        },
      };
      return bindingsOver(port, sessionId);
    },
  });
}
