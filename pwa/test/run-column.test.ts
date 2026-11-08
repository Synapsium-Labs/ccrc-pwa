// The runs column's one layout rule (the runs rebuild, Task 9a, D-8072; spec §8.1).
import { describe, expect, it } from 'vitest';
import { RUN_COLUMN, columnName } from '../src/screens/runColumn';

describe('columnName', () => {
  it('names a width by the column it falls in', () => {
    expect(columnName(639)).toBe('narrow');
    expect(columnName(640)).toBe('medium');
    expect(columnName(1239)).toBe('medium');
    expect(columnName(1240)).toBe('broad');
  });
  it('holds the three thresholds', () => {
    expect(RUN_COLUMN).toEqual({ medium: 640, cards: 840, broad: 1240 });
  });
});
