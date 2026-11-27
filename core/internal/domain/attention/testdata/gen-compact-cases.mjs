// Writes compact-cases.jsonl: inputs for the compaction arms' jq programs (ccd/session-hook.sh: the set document, the
// `#@compact-post-norm` overlap and provenance gates, COMPACT_SHAPE_PRED, the two record merges, JOURNAL_RECORD_PRED,
// JOURNAL_STAGE_PRED and COMPACT_TEXT_JQ), one {"k": <kind>, ...} a line, text that need not be UTF-8 as base64.
// gen-compact-golden.sh runs real jq over them; compact_test.go's TestCompactGolden holds attention to what it printed.
import fs from 'node:fs';

const out = [];
const b64 = (s) => Buffer.from(s).toString('base64');
const add = (row) => out.push(JSON.stringify(row));
const J = (v) => JSON.stringify(v);

// ── the set document as PreCompact publishes it, and its variants ─────────────────────────────────────────────────────
const SET = { v: 1, at: 1795600000000, nonce: 'compact-1795600000000-42-1-2', scope: 'main', overlap: false, agent: null,
  transcript: '/t.jsonl', parentLive: null, liveAgents: 0, cwd: '/w', built: 'abc1234', fresh: 'fresh', steered: false,
  files: null, stats: null };
const LEAF = [null, false, true, 0, 1, 2, -1, 1.5, '1', '', 'x', [], {}];
const FIELD_VALUES = {
  scope: [...LEAF, 'main', 'subagent', 'ambiguous'],
  agent: [...LEAF, 'a1', 'a.b', 'a'.repeat(128), 'a'.repeat(129), 'x\nabc', 'abc\n', 'é'],
  transcript: LEAF,
  parentLive: LEAF,
  liveAgents: [...LEAF, 3, 1e400, 1.0],
  cwd: LEAF,
  built: [...LEAF, 'abc1234', 'ABC1234', 'abc12', 'a'.repeat(40), 'a'.repeat(41), 'abc1234\n', 'x\nabc1234'],
  overlap: LEAF,
  files: [...LEAF, [{ path: 'a' }], [{ path: '' }], [{}], ['a'], [{ path: 1 }], [{ path: 'a' }, { path: '' }]],
  trigger: [undefined, 'auto', 'manual', 'x'],
};
const sets = [];
for (const [k, vs] of Object.entries(FIELD_VALUES)) {
  for (const v of vs) sets.push(J({ ...SET, [k]: v }));
}
for (const [scope, agent, transcript, parentLive, liveAgents] of [
  ['subagent', 'a1', '/a.jsonl', false, 1], ['subagent', 'a1', '/a.jsonl', true, 1], ['subagent', null, '/a.jsonl', false, 1],
  ['ambiguous', null, null, true, 1], ['ambiguous', null, null, null, 2], ['ambiguous', null, null, null, 1], ['ambiguous', null, '/t', true, 1],
  ['main', null, '/t', null, null], ['main', null, null, null, 0],
]) sets.push(J({ ...SET, scope, agent, transcript, parentLive, liveAgents }));
const { built: _b, ...noBuilt } = SET;
sets.push(J(noBuilt), J({ ...SET, cwd: null }), J({ ...SET, cwd: null, built: null }));
sets.push('null', '1', '"x"', '[]', '[{}]', '', ' ', `${J(SET)}\n${J(SET)}`, `${J({ ...SET, overlap: true })}\n${J(SET)}`,
  `${J(SET)}\n${J({ ...SET, overlap: true })}`, `${J(SET)} garbage`, `1\n${J(SET)}`, `${J(SET)}\n1`, '{"overlap":nan}',
  '{"liveAgents":nan}', J({ ...SET, liveAgents: 'nan' }).replace('"nan"', 'nan'), J({ ...SET, liveAgents: 0 }).replace('"liveAgents":0', '"liveAgents":-0'));
for (const s of sets) {
  add({ k: 'overlap', snap: b64(s) });
  for (const trig of ['auto', 'manual']) add({ k: 'norm', snap: b64(s), trig });
}

// ── the helper's measurement and the shape gate ──────────────────────────────────────────────────────────────────────
const MEAS = { chars: 100, fences: 2, at: 1795600000500, trigger: 'auto', steered: false, served: false, filesChars: 40,
  cited: 1, setSize: 3, scope: 'main' };
const MEAS_VALUES = {
  chars: LEAF, fences: LEAF, at: LEAF, trigger: [...LEAF, 'auto', 'manual'], steered: LEAF, served: LEAF,
  filesChars: LEAF, cited: LEAF, setSize: LEAF, scope: [...LEAF, 'main', 'subagent', 'ambiguous'],
};
const meases = [J(MEAS)];
for (const [k, vs] of Object.entries(MEAS_VALUES)) for (const v of vs) meases.push(J({ ...MEAS, [k]: v }));
meases.push('', 'null', '[]', `${J(MEAS)}\n${J(MEAS)}`, `${J(MEAS)} x`, `${J(MEAS)}\n`, J(MEAS).replace('100', '1.0'),
  J(MEAS).replace('100', '1e2'), J(MEAS).replace('"cited":1', '"cited":100000000000000000000'), J(MEAS).replace('2,', '-0,'));
for (const m of meases) add({ k: 'shape', meas: b64(m) });

// ── the two record merges ─────────────────────────────────────────────────────────────────────────────────────────────
const shapeful = [J(MEAS), J({ ...MEAS, cited: null, setSize: null, filesChars: null, scope: null }),
  J(MEAS).replace('100', '1.0'), J(MEAS).replace('"cited":1', '"cited":100000000000000000000'), J({ ...MEAS, extra: 'x' }),
  J({ served: true, ...MEAS }), J({ ...MEAS, chars: 1.5 }), J(MEAS).replace('"cited":1', '"cited":1e2')];
for (const m of shapeful) {
  for (const s of [J(SET), J({ ...SET, agent: 'a1', scope: 'subagent' }), '', 'null', `${J(SET)}\n${J(SET)}`, `${J(SET)} x`, '1', '[]',
    J({ cwd: 'é', built: 'x' })]) {
    for (const served of [false, true]) add({ k: 'rec1', meas: m, snap: b64(s), served });
  }
  for (const norm of ['null', 'ambiguous']) for (const served of [false, true]) add({ k: 'rec2', meas: m, served, norm });
}

// ── the record predicate ──────────────────────────────────────────────────────────────────────────────────────────────
const REC = { chars: 100, fences: 2, at: 1795600000500, trigger: 'auto', steered: false, served: false, filesChars: 40,
  cited: 1, setSize: 3, scope: 'main', cwd: '/w', built: 'abc1234', agent: null, transcript: '/t.jsonl', parentLive: null,
  liveAgents: 0 };
const NULLS = { cwd: null, built: null, agent: null, transcript: null, parentLive: null, liveAgents: null };
const RECV = {
  chars: [...LEAF, 1e400], fences: LEAF, at: LEAF, trigger: [...LEAF, 'auto', 'manual'], steered: LEAF, served: LEAF,
  filesChars: [...LEAF, 100, 101], cited: [...LEAF, 3, 4], setSize: [...LEAF, 0], scope: [...LEAF, 'main', 'subagent', 'ambiguous'],
  cwd: LEAF, built: [...LEAF, 'ABC1234', 'abc1234\n'], agent: [...LEAF, 'a1', 'x\nabc'], transcript: LEAF,
  parentLive: LEAF, liveAgents: [...LEAF, 3],
};
const recs = [J(REC), J({ ...REC, ...NULLS, scope: null, cited: null, setSize: null }), J({ ...REC, ...NULLS, scope: 'ambiguous', cited: null, setSize: null }),
  J({ ...REC, ...NULLS, scope: 'main', cited: null, setSize: null }), J({ ...REC, ...NULLS, scope: null }),
  J({ ...REC, scope: 'subagent', agent: 'a1', parentLive: false, liveAgents: 1 }), J({ ...REC, trigger: 'manual', liveAgents: null }),
  J({ ...REC, extra: 1 }), J((({ at, ...r }) => r)(REC)), 'null', '[]', `${J(REC)}\n${J(REC)}`, `${J(REC)}\n1`, `1\n${J(REC)}`, `${J(REC)} x`, ''];
for (const [k, vs] of Object.entries(RECV)) for (const v of vs) recs.push(J({ ...REC, [k]: v }));
for (const r of recs) add({ k: 'pred', rec: r });

// ── the stage predicate ───────────────────────────────────────────────────────────────────────────────────────────────
const R1 = J(REC);
const R2 = J({ ...REC, at: 1795600000600 });
const BAD = J({ ...REC, extra: 1 });
for (const [stage, old, rec] of [
  [`${R1}\n`, '', R1], [`${R2}\n${R1}\n`, `${R2}\n`, R1], [`${R1}`, '', R1], [`${R1}\n\n`, '', R1], [`${R1}\n${R1}\n`, '', R1],
  [`${BAD}\n${R1}\n`, `${BAD}\n`, R1], [`${R2}\n${R1}\n`, '', R1], [`${R2}\n${R1}\n`, `${R2}`, R1], [`\n${R1}\n`, '\n', R1],
  [`${BAD}\n`, '', BAD], [`${R1}\n`, '', R2], [`x${R2}\n${R1}\n`, `x${R2}\n`, R1], [`${R2}\n${R1}\n`, `${R2}\n`, `${R1}`],
  [`${R1.replace('/t.jsonl', '/té.jsonl')}\n`, '', R1.replace('/t.jsonl', '/té.jsonl')], ['\n', '', ''],
  [` ${R1}\n`, '', ` ${R1}`], [`${R1} \n`, '', `${R1} `], [`null\n${R1}\n`, 'null\n', R1], [`[]\n${R1}\n`, '[]\n', R1],
]) add({ k: 'stage', stage: b64(stage), old, rec });
add({ k: 'stage', stage: Buffer.concat([Buffer.from(`${R2.slice(0, 20)}`), Buffer.from([0xff]), Buffer.from(`${R2.slice(20)}\n${R1}\n`)]).toString('base64'),
  old: `${R2.slice(0, 20)}�${R2.slice(20)}\n`, rec: R1 });

// ── COMPACT_TEXT_JQ ───────────────────────────────────────────────────────────────────────────────────────────────────
const texts = ['keep the run ids.', 'x'.repeat(600), 'x'.repeat(601), 'keep;', 'a`b', 'a"b', "a'b", 'a$b', 'a\\b', 'é', '', 'a\nb',
  'a\tb', '~', ' '];
for (const t of texts) add({ k: 'text', file: b64(J({ coordinator: { compactText: t } })), r: 'coordinator' });
for (const f of [J({ coordinator: { compactText: 5 } }), J({ coordinator: {} }), J({}), J([]), 'null', '', 'garbage', J({ coordinator: 'x' }),
  `${J({ coordinator: { compactText: 'a' } })}\n${J({ coordinator: { compactText: 'b' } })}`,
  `${J({ coordinator: { compactText: 'a' } })}\n${J({})}`, `${J({ coordinator: { compactText: 'a' } })} x`,
  J({ coordinator: { compactText: 'a' }, worker: { compactText: 'w' } })]) add({ k: 'text', file: b64(f), r: 'coordinator' });
add({ k: 'text', file: b64(J({ coordinator: { compactText: 'a' } })), r: 'nosuch' });

// ── the set document ──────────────────────────────────────────────────────────────────────────────────────────────────
for (const [scope, agent, t, pl, ln, ovl, cwd, built, fresh] of [
  ['main', '', '/t.jsonl', '', '0', 'false', '/w', 'abc1234', 'fresh'], ['subagent', 'a1', '/a.jsonl', 'false', '1', 'false', '', '', ''],
  ['ambiguous', '', '', 'true', '1', 'true', '/w é', 'abc', 'stale'], ['ambiguous', '', '', '', '2', 'false', '/w', '', ''],
  ['main', '', '/té.jsonl', '', '', 'false', '/w', '', ''],
]) add({ k: 'setdoc', scope, agent, t, pl, ln, nonce: 'compact-1-2-3-4', ovl, cwd, built, fresh, at: '1795600000000' });

fs.writeFileSync(new URL('compact-cases.jsonl', import.meta.url), `${out.join('\n')}\n`);
console.log(`${out.length} cases`);
