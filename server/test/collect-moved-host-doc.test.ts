// THE SERVER READS A RELEASED LEAF'S DOCUMENT UNCHANGED (cleanup un-wedge, Task R4; spec §6.1). `ws-audit --collect`
// says `"witness":"moved-host"` at the top of its document when it took a temp root by path after a box move. The
// collect lane's one reader (`parseCollectAudit`) reads the witness RECORD inside `collect`, never that word, so the
// same document with and without it classifies the same: the server needs no change for the release, and must not.
import { describe, it, expect } from 'vitest';
import { parseCollectAudit } from '../src/collectLane.js';

const ID = 'project-a-quiet-reef';
const TOKEN = 'b'.repeat(64);
/** A collectable document in the order ccd prints it, `witness` key optional. */
const doc = (o: { witness?: string; resume?: string; verdict?: string } = {}): string => JSON.stringify({
  session: ID, mode: 'collect', exists: true,
  collect: {
    leaf: `/fixture-home/.cc-tmp/${ID}`,
    witness: { dev: '1047815', ino: '424242', btime: '1791468463', run: '7', at: '1791470480213' },
    records: [], newestCtimeNs: '1791000000000000000', entries: 3, floorS: 86400, idleAt: 1791086400, unmeasured: null,
  },
  ...(o.resume === undefined ? {} : { resume: o.resume }),
  ...(o.witness === undefined ? {} : { witness: o.witness }),
  verdict: o.verdict ?? 'collectable', detail: '',
  ...((o.verdict ?? 'collectable') === 'collectable' ? { token: TOKEN } : {}),
});

describe('the collect lane reads a released leaf’s document as it reads any other', () => {
  it('a document without the key is read as before (the characterization)', () => {
    expect(parseCollectAudit(ID, true, doc(), '')).toEqual({
      kind: 'collectable', token: TOKEN, resume: null, witnessRun: 7, witnessAt: 1791470480213,
      leaf: `/fixture-home/.cc-tmp/${ID}`, detail: '',
    });
  });

  it('the collect lane classifies a collectable document carrying witness: moved-host as collectable', () => {
    expect(parseCollectAudit(ID, true, doc({ witness: 'moved-host' }), ''))
      .toEqual(parseCollectAudit(ID, true, doc(), ''));
  });

  it('a resumed one, and a refusal carrying it, read the same as without it', () => {
    expect(parseCollectAudit(ID, true, doc({ witness: 'moved-host', resume: 'moved' }), ''))
      .toEqual(parseCollectAudit(ID, true, doc({ resume: 'moved' }), ''));
    expect(parseCollectAudit(ID, true, doc({ witness: 'moved-host', verdict: 'in-use' }), ''))
      .toEqual(parseCollectAudit(ID, true, doc({ verdict: 'in-use' }), ''));
  });
});
