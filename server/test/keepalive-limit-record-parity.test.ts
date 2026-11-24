/**
 * The limit watchdog's records are read in two files (D-8958). `ccd/ccd` writes `$REG/<id>.limitsign` and
 * `$REG/<id>.limitwait` and reads them back through `_wd_record_read` and `_limitwait_choose`;
 * `ccd/ccd-telemetry-keepalive` is a sibling executable that sources nothing from ccd, so it reads them with copies of
 * those two patterns, and the hook's turn marker with a copy of the reader ccd's hibernate uses. The copies cannot be
 * shared structurally (the keepalive-freshness-parity reason), so they are held equal here, text for text: a field the
 * watchdog adds, or a sign it renames, reds this suite instead of quietly turning the keepalive's exception off.
 *
 * Text-only, so it runs on every platform (the keepalive's own suite is Linux-only).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ccdSource } from './ccdWsHelpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const KEEPALIVE = readFileSync(path.join(here, '..', '..', 'ccd', 'ccd-telemetry-keepalive'), 'utf8');
const CCD = ccdSource();

/** The body of a bash function, from its `name() {` line to the first `}` at column 0. */
function body(src: string, name: string): string {
  const start = src.indexOf(`\n${name}() {`);
  if (start < 0) throw new Error(`no ${name}() in the source`);
  const end = src.indexOf('\n}\n', start);
  return src.slice(start, end);
}
/** The one `re='…'` literal a ccd function assigns. */
function ccdRe(name: string): string {
  const all = [...body(CCD, name).matchAll(/\bre='([^']+)'/g)].map((m) => m[1]);
  expect(all, `${name} assigns one re='…'`).toHaveLength(1);
  return all[0];
}
/** The keepalive's one top-level assignment of `name='…'`, counted broadly first so a shadowing copy is seen. */
function kaRe(name: string): string {
  const broad = KEEPALIVE.split('\n').filter((l) => new RegExp(`^\\s*(readonly\\s+|declare\\s+|local\\s+)?${name}=`).test(l));
  expect(broad, `${name} is assigned once in the keepalive`).toHaveLength(1);
  const m = new RegExp(`^${name}='([^']+)'$`).exec(broad[0]);
  expect(m, `${name} is a plain single-quoted assignment`).not.toBeNull();
  return m![1];
}

describe('the keepalive reads the watchdog\'s records in the watchdog\'s grammar (D-8958)', () => {
  it('.limitsign: the same pattern as _wd_record_read', () => {
    expect(kaRe('KA_LIMITSIGN_RE')).toBe(ccdRe('_wd_record_read'));
  });

  it('.limitwait: the same open-record pattern as _limitwait_choose', () => {
    expect(kaRe('KA_LIMITWAIT_RE')).toBe(ccdRe('_limitwait_choose'));
  });

  it('the turn marker\'s state: the same pattern ccd\'s hibernate reads it with', () => {
    const ka = kaRe('KA_TURN_STATE_RE');
    expect(CCD).toContain(`re='${ka}'`);
  });

  it('each pattern is read where the exception is decided, and nowhere else', () => {
    const waits = body(KEEPALIVE, '_ka_waits_at_limit');
    for (const name of ['KA_LIMITSIGN_RE', 'KA_LIMITWAIT_RE', 'KA_TURN_STATE_RE']) {
      expect(waits).toContain(`$${name}`);
      const uses = KEEPALIVE.split('\n').filter((l) => l.includes(`$${name}`));
      expect(uses.every((l) => waits.includes(l)), `${name} is read only in _ka_waits_at_limit`).toBe(true);
    }
  });
});
