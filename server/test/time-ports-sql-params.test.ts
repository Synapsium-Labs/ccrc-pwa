import { describe, it, expect } from 'vitest';
import { SQL_CLOCK } from './scan/ambient.js';

// The bound-parameter arms of `SQL_CLOCK`'s modifier (`server/test/scan/ambient.ts#SQL_MODIFIER`): after `'subsec'`,
// a named parameter in each of SQLite's three spellings (`:name`, `@name`, `$name`) and a numbered one (`?NNN`) still
// leave the time value as now. Each row goes red without its own arm. They sit in a file of their own, beside the SQL
// rows of `single-definition/time-ports.test.ts`, by the coordinator's ruling on a claim overlap there.
describe('SQL_CLOCK reads a bound parameter after subsec (spec §11.5)', () => {
  it.each(["SELECT unixepoch('subsec', :m) FROM t", "SELECT unixepoch('subsec', @m) FROM t",
    "SELECT unixepoch('subsec', $m) FROM t", "SELECT unixepoch('subsec', ?1) FROM t"])(
    'CONTROL: %s reads one', (sql) => expect(SQL_CLOCK.test(sql)).toBe(true));
});
