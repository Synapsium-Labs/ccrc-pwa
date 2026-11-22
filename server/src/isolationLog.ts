// The one holder of the last logged isolation reading (Overlord W1, plan `w1-isolation.md` question 20, ruled F12). Ring L4,
// context C1: it is asked at boot and after each change of the fleet link's state, reads the reader, and logs only a
// change, by word and cause or by reason. It decides no word, and no line names an address, a digest, an id or a uid.
import type { IsolationReader } from './isolationFacts.js';

export class IsolationWordLog {
  private last: string | null = null;
  constructor(private readonly reader: Pick<IsolationReader, 'read'>, private readonly warn: (line: string) => void) {}

  note(): void {
    const r = this.reader.read();
    const line = r.kind === 'measured'
      ? `ccrc-server: isolation: ${r.word} (${r.cause})`
      : `ccrc-server: isolation: unmeasured (${r.why})`;
    if (line === this.last) return;
    this.last = line;
    this.warn(line);
  }
}
