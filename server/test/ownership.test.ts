import { describe, it, expect } from 'vitest';
import { markGenerated, verifyMarker } from '../../shared/mark.mjs';

describe('provenance marker', () => {
  const body = '#!/usr/bin/env bash\necho hi\n';

  it('keeps the shebang first — the file must stay executable', () => {
    const text = markGenerated(body);
    expect(text.split('\n')[0]).toBe('#!/usr/bin/env bash');
    expect(text.split('\n')[1]).toMatch(/^# ccrc:generated 1 sha256=[0-9a-f]{64}$/);
  });

  it('round-trips its own output as unmodified', () => {
    expect(verifyMarker(markGenerated(body))).toBe('ccrc-unmodified');
  });

  it('detects a hand edit', () => {
    expect(verifyMarker(markGenerated(body) + 'echo tampered\n')).toBe('ccrc-edited');
  });

  it('calls an unmarked file foreign', () => {
    expect(verifyMarker(body)).toBe('foreign');
  });

  it('marks a body with no shebang on line 1', () => {
    expect(markGenerated('CCRC_ACCOUNTS=(a)\n').split('\n')[0])
      .toMatch(/^# ccrc:generated 1 sha256=/);
  });
});
