import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';

/**
 * `_transcript_limit_banner` over one corpus of transcripts, every mode, one shell (#2367).
 *
 * The table was written down from the inline Python reader before `limit_banner` in `ccd/lib/transcript.jq` replaced
 * it, and the jq reader answers every row the same, byte for byte. It pins what the behaviour suite
 * (`ccd-limit-banner.test.ts`) does not reach: the per-line tolerance (a line that does not parse, a blank line, a
 * line that parses to something other than an object, a BOM, a lone surrogate escape, bytes that are not UTF-8), the
 * types each field must have, and the timestamp shapes the `since` gate reads. `DIVERGES` holds the few inputs where
 * the two readers differ, none of which Claude Code writes, with the jq answer.
 */

let h: CcdHarness;
beforeAll(() => { h = makeCcdHarness('ccrc-ccd-limit-corpus-'); });
afterAll(() => { h.cleanup(); });

const TS = '2026-09-10T10:12:21.199Z';
const AT = Math.floor(Date.parse(TS) / 1000);
const QUOTA = { status: 'rejected', resetsAt: 1789430400, rateLimitType: 'seven_day' };
type Row = Record<string, unknown>;
const j = (o: unknown): string => JSON.stringify(o);
const banner = (over: Row = {}): Row => ({
  type: 'assistant', uuid: 'b1', timestamp: TS,
  message: { model: '<synthetic>', role: 'assistant', content: [{ type: 'text', text: "You've hit your weekly limit" }] },
  isApiErrorMessage: true, error: 'rate_limit', apiErrorStatus: 429, quotaLimits: QUOTA, ...over,
});
const auth = (over: Row = {}): Row => banner({ error: 'authentication_failed', apiErrorStatus: 401, quotaLimits: undefined, ...over });
const human = (content: unknown = 'resume'): Row => ({ type: 'user', uuid: 'u1', timestamp: TS, message: { role: 'user', content } });
const B = j(banner());
const HUMAN = j(human());
const CHATTER = [
  j(human('<local-command-caveat>Caveat</local-command-caveat>')),
  j(human('<command-name>/effort</command-name>')),
  j(human('<local-command-stdout>ok</local-command-stdout>')),
  j({ type: 'system', content: 'Remote Control disconnected' }),
];
const at = (ts: unknown): string => j(banner({ timestamp: ts }));
const quota = (q: unknown): string => j(banner({ quotaLimits: q }));
const notUtf8 = (at: number): Buffer => Buffer.concat([Buffer.from(B.slice(0, at)), Buffer.from([0xff, 0xfe]), Buffer.from(B.slice(at))]);

/** [name, transcript lines (a Buffer is written as it is), mode, since, rc, stdout]. */
type Case = readonly [string, readonly (string | Buffer)[], string, string, string, string];
const D = 'dated';
const S = 'stuck';
const CASES: readonly Case[] = [
  ['the banner is the newest row', [HUMAN, B], '', '', '0', '1789430400\tseven_day'],
  ['chatter after the banner', [B, ...CHATTER], '', '', '0', '1789430400\tseven_day'],
  ['a human row after the banner', [B, HUMAN], '', '', '1', ''],
  ['a real turn before the banner', [B, HUMAN, B], '', '', '0', '1789430400\tseven_day'],
  ['an empty file', [], '', '', '1', ''],
  ['an unparseable line after the banner', [B, '{"type":"user",'], '', '', '1', ''],
  ['an unparseable line before the banner', ['{"type":', B], '', '', '0', '1789430400\tseven_day'],
  ['a blank line after the banner', [B, '', j({ type: 'system' })], '', '', '1', ''],
  ['blank lines that end the file', [B, '', ''], '', '', '0', '1789430400\tseven_day'],
  ['a whitespace line after the banner', [B, '   '], '', '', '1', ''],
  ['an array line after the banner', [B, '[1]'], '', '', '1', ''],
  ['a string line after the banner', [B, '"x"'], '', '', '1', ''],
  ['a null line after the banner', [B, 'null'], '', '', '1', ''],
  ['a number line after the banner', [B, '42'], '', '', '1', ''],
  ['two values on one line', [B, `${B} ${B}`], '', '', '1', ''],
  ['a BOM before the banner row', [`﻿${B}`], '', '', '1', ''],
  ['a BOM row, then the banner', [`﻿${HUMAN}`, B], '', '', '0', '1789430400\tseven_day'],
  ['CRLF line ends', [`${HUMAN}\r`, `${B}\r`], '', '', '0', '1789430400\tseven_day'],
  ['a lone surrogate escape in the banner text', [B.replace("You've", '\\ud83dYou')], '', '', '0', '1789430400\tseven_day'],
  ['a lone surrogate escape in a human row after it', [B, HUMAN.replace('resume', '\\udc00resume')], '', '', '1', ''],
  ['a lone surrogate escape in chatter after it', [B, CHATTER[0]!.replace('Caveat<', '\\ud83d<')], '', '', '0', '1789430400\tseven_day'],
  ['bytes that are not UTF-8 in the banner text', [notUtf8(B.indexOf('weekly'))], '', '', '0', '1789430400\tseven_day'],
  ['bytes that are not UTF-8 between two keys', [notUtf8(B.indexOf(':{"model"'))], '', '', '1', ''],
  ['duplicate keys: the last type wins', [B.replace('{"type":"assistant"', '{"type":"user","type":"assistant"')], '', '', '0', '1789430400\tseven_day'],
  ['duplicate keys: the last error wins', [B.replace('"error":"rate_limit"', '"error":"rate_limit","error":"overloaded"')], '', '', '1', ''],
  ['a system row shaped like a banner', [B, j(banner({ type: 'system' }))], '', '', '0', '1789430400\tseven_day'],
  ['a row with no type', [B, j({ message: { content: 'x' } })], '', '', '0', '1789430400\tseven_day'],
  ['a type that is not a string', [B, j({ type: ['user'] })], '', '', '0', '1789430400\tseven_day'],
  ['isApiErrorMessage 1', [j(banner({ isApiErrorMessage: 1 }))], '', '', '1', ''],
  ['isApiErrorMessage "true"', [j(banner({ isApiErrorMessage: 'true' }))], '', '', '1', ''],
  ['a user row with the banner fields', [j({ ...banner(), type: 'user' })], '', '', '1', ''],
  ['the banner fields nested in a tool call', [j({ type: 'assistant', message: { content: [{ type: 'tool_use', input: banner() }] } })], '', '', '1', ''],
  ['chatter as an array of text', [B, j(human([{ type: 'text', text: '<command-name>/x</command-name>' }]))], '', '', '1', ''],
  ['chatter after a leading space', [B, j(human(' <command-name>/x</command-name>'))], '', '', '1', ''],
  ['a user row whose message is a string', [B, j({ type: 'user', message: '<command-name>' })], '', '', '1', ''],
  ['a user row with no message', [B, j({ type: 'user' })], '', '', '1', ''],
  ['an assistant row with chatter text', [B, j({ type: 'assistant', message: { content: '<command-name>/x' } })], '', '', '1', ''],
  ['no quotaLimits', [j(banner({ quotaLimits: undefined }))], '', '', '0', '\t'],
  ['quotaLimits a string', [quota('x')], '', '', '0', '\t'],
  ['quotaLimits an array', [quota([1789430400])], '', '', '0', '\t'],
  ['quotaLimits null', [quota(null)], '', '', '0', '\t'],
  ['resetsAt a string', [quota({ resetsAt: '1789430400', rateLimitType: 'five_hour' })], '', '', '0', '\tfive_hour'],
  ['resetsAt a fraction', [quota({ resetsAt: 1789430400.5, rateLimitType: 'five_hour' })], '', '', '0', '\tfive_hour'],
  ['resetsAt true', [quota({ resetsAt: true })], '', '', '0', '\t'],
  ['resetsAt negative', [quota({ resetsAt: -5 })], '', '', '0', '-5\t'],
  ['resetsAt minus zero', [B.replace('1789430400', '-0')], '', '', '0', '0\tseven_day'],
  ['resetsAt zero', [quota({ resetsAt: 0, rateLimitType: 'x' })], '', '', '0', '0\tx'],
  ['rateLimitType a number', [quota({ resetsAt: 7, rateLimitType: 5 })], '', '', '0', '7\t'],
  ['rateLimitType empty', [quota({ resetsAt: 7, rateLimitType: '' })], '', '', '0', '7\t'],
  ['rateLimitType with a space and UTF-8', [quota({ resetsAt: 7, rateLimitType: 'seven day ✓' })], '', '', '0', '7\tseven day ✓'],
  ['default mode: a 401 is not a banner', [j(auth())], '', String(AT), '1', ''],
  ['an unknown mode is the default mode', [j(auth())], 'bogus', String(AT), '1', ''],
  ['stuck: a 401 in the pane\'s second', [j(auth())], S, String(AT), '0', '\t\tauthentication_failed'],
  ['stuck: a 401 before the pane', [j(auth())], S, String(AT + 1), '1', ''],
  ['stuck: a 401 and no since', [j(auth())], S, '', '1', ''],
  ['stuck: a 401 and a since that is not digits', [j(auth())], S, '12a', '1', ''],
  ['stuck: a 401 and a negative since', [j(auth())], S, '-1', '1', ''],
  ['stuck: a 401 then chatter', [j(auth()), ...CHATTER], S, String(AT), '0', '\t\tauthentication_failed'],
  ['stuck: a 401 written as 401.0', [j(auth()).replace('"apiErrorStatus":401', '"apiErrorStatus":401.0')], S, String(AT), '0', '\t\tauthentication_failed'],
  ['stuck: a 401 as a string', [j(auth({ apiErrorStatus: '401' }))], S, String(AT), '1', ''],
  ['stuck: a 403', [j(auth({ apiErrorStatus: 403 }))], S, String(AT), '1', ''],
  ['stuck: a 401 with no timestamp', [j(auth({ timestamp: undefined }))], S, '1', '1', ''],
  ['stuck: a 401 that carries quotaLimits', [j(auth({ quotaLimits: QUOTA }))], S, String(AT), '0', '\t\tauthentication_failed'],
  ['stuck: a 401 after a banner, before the pane', [B, j(auth())], S, String(AT + 1), '1', ''],
  ['stuck: a banner after a 401', [j(auth()), B], S, String(AT), '0', '1789430400\tseven_day'],
  ['stuck: a banner in the pane\'s second', [B], S, String(AT), '0', '1789430400\tseven_day'],
  ['stuck: a banner a second before the pane', [B], S, String(AT + 1), '3', String(AT)],
  ['stuck: a banner and no since', [B], S, '', '0', '1789430400\tseven_day'],
  ['stuck: a banner with no timestamp', [j(banner({ timestamp: undefined }))], S, '9999999999', '0', '1789430400\tseven_day'],
  ['stuck: a banner whose timestamp is a number', [at(AT)], S, '9999999999', '0', '1789430400\tseven_day'],
  ['stuck: a banner with no quotaLimits, before the pane', [j(banner({ quotaLimits: undefined }))], S, String(AT + 1), '3', String(AT)],
  ['dated: the banner and its epoch', [B], D, '1', '0', `1789430400\tseven_day\t${AT}`],
  ['dated: no since places nothing', [B], D, '', '0', '1789430400\tseven_day\t-'],
  ['dated: a banner before the pane', [B], D, String(AT + 1), '3', String(AT)],
  ['dated: no quotaLimits', [j(banner({ quotaLimits: undefined }))], D, '1', '0', `\t\t${AT}`],
  ['dated: a non-string kind', [quota({ resetsAt: 7, rateLimitType: 5 })], D, '1', '0', `7\t\t${AT}`],
  ['dated: a 401 has no epoch', [j(auth())], D, String(AT), '0', '\t\tauthentication_failed'],
  ['dated: an unreadable timestamp', [at('soon')], D, '1', '0', '1789430400\tseven_day\t-'],
  ['dated: Z', [at('2026-09-10T10:12:21Z')], D, '1', '0', '1789430400\tseven_day\t1789035141'],
  ['dated: no fraction digits', [at('2026-09-10T10:12:21.Z')], D, '1', '0', '1789430400\tseven_day\t1789035141'],
  ['dated: a comma fraction', [at('2026-09-10T10:12:21,9Z')], D, '1', '0', '1789430400\tseven_day\t1789035141'],
  ['dated: seven fraction digits', [at('2026-09-10T10:12:21.9999999Z')], D, '1', '0', '1789430400\tseven_day\t1789035141'],
  ['dated: a space separator', [at('2026-09-10 10:12:21Z')], D, '1', '0', '1789430400\tseven_day\t1789035141'],
  ['dated: +02:00', [at('2026-09-10T10:12:21+02:00')], D, '1', '0', '1789430400\tseven_day\t1789027941'],
  ['dated: -05:30', [at('2026-09-10T10:12:21.5-05:30')], D, '1', '0', '1789430400\tseven_day\t1789054941'],
  ['dated: +0200', [at('2026-09-10T10:12:21+0200')], D, '1', '0', '1789430400\tseven_day\t1789027941'],
  ['dated: +02', [at('2026-09-10T10:12:21+02')], D, '1', '0', '1789430400\tseven_day\t1789027941'],
  ['dated: -00:00', [at('2026-09-10T10:12:21-00:00')], D, '1', '0', '1789430400\tseven_day\t1789035141'],
  ['dated: February 30th', [at('2026-02-30T10:00:00Z')], D, '1', '0', '1789430400\tseven_day\t-'],
  ['dated: second 60', [at('2026-09-10T10:12:60Z')], D, '1', '0', '1789430400\tseven_day\t-'],
  ['dated: hour 24', [at('2026-09-10T24:00:00Z')], D, '1', '0', '1789430400\tseven_day\t-'],
  ['dated: an offset of 24 hours', [at('2026-09-10T10:12:21+24:00')], D, '1', '0', '1789430400\tseven_day\t-'],
  ['dated: a trailing letter', [at('2026-09-10T10:12:21Zx')], D, '1', '0', '1789430400\tseven_day\t-'],
  ['dated: a space before Z', [at('2026-09-10T10:12:21 Z')], D, '1', '0', '1789430400\tseven_day\t1789035141'],
];

/** Every case in one shell: a record per case, fields and records split by control bytes no answer holds. */
function run(cases: readonly Case[]): Map<string, [string, string]> {
  const dir = path.join(h.home, 'corpus');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir);
  const manifest = cases.map(([name, lines, mode, since], i) => {
    const file = path.join(dir, `${i}.jsonl`);
    fs.writeFileSync(file, Buffer.concat(lines.map((l) => Buffer.concat([Buffer.from(l), Buffer.from('\n')]))));
    return [String(i), file, mode, since, name].join('\t');
  });
  fs.writeFileSync(path.join(dir, 'manifest'), manifest.join('\n') + '\n');
  const raw = h.sh(`while IFS=$'\\t' read -r i f mode since _; do
      out=$(_transcript_limit_banner "$f" "$mode" "$since"); rc=$?
      printf '%s\\x1f%s\\x1f%s\\x1e' "$i" "$rc" "$out"
    done < ${JSON.stringify(path.join(dir, 'manifest'))}; printf 'end'`);
  const out = new Map<string, [string, string]>();
  for (const rec of raw.split('\x1e').slice(0, -1)) {
    const [i, rc, text] = rec.split('\x1f');
    out.set(cases[Number(i)]![0], [rc!, text!]);
  }
  return out;
}

describe('_transcript_limit_banner over the corpus (#2367)', () => {
  it('names each case once', () => {
    expect(new Set(CASES.map((c) => c[0])).size).toBe(CASES.length);
  });

  it('answers every case with the rc and output the Python reader gave', () => {
    const got = run(CASES);
    const want = new Map(CASES.map(([name, , , , rc, out]) => [name, [rc, out]]));
    expect(Object.fromEntries(got)).toEqual(Object.fromEntries(want));
  });
});
