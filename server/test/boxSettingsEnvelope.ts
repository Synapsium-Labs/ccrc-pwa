// The differential corpus of the box settings view's envelope (D-7909, D-7914; review F5): one list of `{ key, value }` that the
// writer's `_set_fits` (ccd/ccrc, `box-settings-table.test.ts`) and the server's own check (`parseBoxSettings`, Task 4) must
// answer alike. The server's full check is composed here from L0, so a test of either side reads one definition of it.
// Neutral names only: this repository is public.
import {
  BOX_SETTINGS_TEXT_MAX, BOX_SETTING_ORIGIN_SHAPE, BOX_SETTING_SPECS, BOX_SETTING_VALUE_SHAPE, BOX_SETTING_VALUE_WORDS, type BoxSettingName,
} from '../../shared/api.js';

/** A value of the `value` class under test, and the origin's key. */
export const ENVELOPE_VALUE_KEY: BoxSettingName = 'CCRC_GRAPH_BUDGET';
export const ENVELOPE_ORIGIN_KEY: BoxSettingName = 'CCRC_RELEASE_BASE_URL';

/** Value strings the shape admits, and the ones it does not (E1). */
export const VALUE_SHAPE_FITS: readonly string[] = [
  '24G', '50%', '400%', '0', '3s', '10m', '64M', '86400', '9999999999999999E', '1'.repeat(32),
];
export const VALUE_SHAPE_MISSES: readonly string[] = [
  '1'.repeat(33), `1${'9'.repeat(39)}M`, '5Q', '5 G', '-1', '1.5', '/etc/x', 'local',
];
/** Origin strings the shape admits, and the ones it does not (E1; `custom https://` and `custom ` are review L10's). */
export const ORIGIN_SHAPE_FITS: readonly string[] = [
  'default', 'custom', 'custom https://mirror.example.invalid:8443', 'custom HTTPS://mirror.example.invalid', 'custom https://[::1]:8080',
  'custom mirror.example.invalid',
];
export const ORIGIN_SHAPE_MISSES: readonly string[] = [
  'custom h:abc', 'custom h^x', 'custom https://u:p@h', 'custom https://h/r', 'custom https://h?x', 'custom ftp://h', 'custom https://',
  'custom ', 'https://h', 'set',
];

/** The server's check of an `ok` value or origin, composed from L0 alone: under the cut, then the shape, or (for a value) the key's own words. */
export function envelopeFits(key: BoxSettingName, value: string): boolean {
  if (Buffer.byteLength(value, 'latin1') > BOX_SETTINGS_TEXT_MAX) return false;
  const cls = BOX_SETTING_SPECS[key].cls;
  if (cls === 'origin') return new RegExp(BOX_SETTING_ORIGIN_SHAPE).test(value);
  if (cls === 'value') return new RegExp(BOX_SETTING_VALUE_SHAPE).test(value) || (BOX_SETTING_VALUE_WORDS[key] ?? []).includes(value);
  return false;
}

const origin = (host: string): string => `custom https://${host}`;
/** A host that makes the whole origin exactly `bytes` long. */
const originOfLength = (bytes: number): string => origin('h'.repeat(bytes - origin('').length));

export interface EnvelopeCase { key: BoxSettingName; value: string }
export const ENVELOPE_CORPUS: readonly EnvelopeCase[] = [
  ...[...VALUE_SHAPE_FITS, ...VALUE_SHAPE_MISSES].map((value) => ({ key: ENVELOPE_VALUE_KEY, value })),
  ...[...ORIGIN_SHAPE_FITS, ...ORIGIN_SHAPE_MISSES].map((value) => ({ key: ENVELOPE_ORIGIN_KEY, value })),
  // A word is admitted only on its own key.
  { key: 'CCRC_TESTBOX_LOST_RUN', value: 'local' }, { key: 'CCRC_TESTBOX_LOST_RUN', value: 'fail' },
  { key: 'CCRC_TESTBOX_FALLBACK_INSTALL', value: 'install' }, { key: 'CCRC_TESTBOX_FALLBACK_INSTALL', value: 'refuse' },
  { key: 'CCRC_TESTBOX_FALLBACK_INSTALL', value: 'local' }, { key: 'CCRC_TESTBOX_LOST_RUN', value: 'install' },
  { key: 'CCRC_TESTBOX_LOST_RUN', value: 'zz' }, { key: 'CCRC_TESTBOX_LOST_RUN', value: 'maybe' }, { key: 'CCRC_GRAPH_BUDGET', value: 'local' },
  // The cut: 480 bytes fit, 481 do not.
  { key: ENVELOPE_VALUE_KEY, value: '1'.repeat(481) },
  { key: ENVELOPE_ORIGIN_KEY, value: originOfLength(481) }, { key: ENVELOPE_ORIGIN_KEY, value: originOfLength(480) },
];
