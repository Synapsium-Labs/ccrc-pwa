// The Windows port, C4: the replay driver needs `process.getuid` (absent on Windows, so --out's owner check threw a
// TypeError) and POSIX process groups. On win32 main refuses first, in one sentence, before reading anything.
import { describe, expect, it, vi } from 'vitest';
import { EXIT } from '../../ccd/history/lib.mjs';
import { main } from '../../deploy/history-replay.mjs';

describe.skipIf(process.platform !== 'win32')('history-replay on Windows (C4)', () => {
  it('refuses with one sentence naming Windows, whatever the arguments', async () => {
    const lines: string[] = [];
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation((s: string | Uint8Array) => { lines.push(String(s)); return true; });
    let code: number;
    try { code = await main(['step0a', '--out', 'C:/nowhere'], { HOME: 'C:/nowhere-home' }); } finally { spy.mockRestore(); }
    expect(code).toBe(EXIT.REFUSED);
    expect(lines).toEqual([expect.stringMatching(/^ccrc history-replay: not supported on Windows: .+\n$/)]);
  });
});
