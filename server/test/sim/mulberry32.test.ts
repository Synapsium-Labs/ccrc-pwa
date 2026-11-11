import { describe, it, expect } from 'vitest';
import { mulberry32 } from '../fakeTime.js';

describe('the one mulberry32 (D-8225)', () => {
  it('draws the sequence the nine suites drew (pinned on the old copies)', () => {
    const a = mulberry32(0x5eed);
    expect([a(), a(), a(), a()]).toEqual([0.7100320369936526, 0.286336648510769, 0.9519026265479624, 0.10175976227037609]);
    const b = mulberry32(1);
    expect([b(), b(), b(), b()]).toEqual([0.6270739405881613, 0.002735721180215478, 0.5274470399599522, 0.9810509674716741]);
    const c = mulberry32(0x6268);
    expect([c(), c(), c(), c()]).toEqual([0.6481923549436033, 0.6919607364106923, 0.76711018034257, 0.8820702126249671]);
  });
});
