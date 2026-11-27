// Writes approval-cases.jsonl, the cases gen-approval-golden.sh runs through the bash's own approval code (Go core wave 2,
// Task 7): `canon` (APPROVAL_DIGEST_JQ over a payload's text), `granted`/`refused`/`ruled` (the wait's reads of a client
// answer), `scan` (`_apr_scan` over a transcript, step by step), `patch` (`_hook_approval_route_patch`) and `drop`
// (`_hook_approvals_drop`). File contents travel as base64 so NUL bytes and broken UTF-8 reach the bash as bytes.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const b64 = (s) => Buffer.from(s, typeof s === 'string' ? 'utf8' : undefined).toString('base64');
const raw = (bytes) => Buffer.from(bytes).toString('base64');
const rows = [];
const add = (c) => rows.push(JSON.stringify(c));

// ---- canon: the digest corpus's inputs, and the number and string edges
const corpus = JSON.parse(fs.readFileSync(path.join(here, '../../../../../server/test/fixtures/approvals/digest-corpus.json'), 'utf8'));
for (const r of corpus.rows) add({ fn: 'canon', text: r.inputText });
const base = (n) => `{"session_id":"s","agent_id":"a1","tool_name":"Bash","cwd":"/w","tool_input":{"command":"x","n":${n}}}`;
for (const n of ['0', '-0', '-0.0', '0.0', '1.0', '1e2', '1E2', '1.5', '-7', '9007199254740991', '9007199254740992', '-9007199254740991',
  '-9007199254740992', '1e400', '-1e400', '1e-400', '1.0e15', '100000000000000000000', '[1,2.0,[3e0]]', '{"z":1,"a":-0}', '0.1e1', '12.000']) {
  add({ fn: 'canon', text: base(n) });
}
for (const s of ['"é"', '"😀"', '"\\u0000\\u007f\\u001f"', '"a\\/b"', '"\\ud83d\\ude00"', '"line\\nbreak\\ttab"']) {
  add({ fn: 'canon', text: `{"session_id":${s},"tool_name":"Bash","cwd":"/w","tool_input":{${s}:${s}}}` });
}
// review F3: an astral key beside U+E000..U+FFFF keys (code-point order, not UTF-16's), lone surrogates (jq makes them
// U+FFFD or refuses them), duplicate keys (the last value, at the first place) and a U+007F key
for (const ti of ['{"\\uffff":1,"\\ud83d\\ude00":2,"\\ue000":3,"z":4,"\\u00e9":5}', '{"\\ud800":"\\ud800x"}', '{"k":"\\udc00"}',
  '{"k":"\\ud800\\ud800\\udc00"}', '{"a":1,"b":2,"a":3}', '{"b":{"x":1,"x":-0}}', '{"\\u007f":"\\u007f","\\u0080":1}']) {
  add({ fn: 'canon', text: `{"session_id":"s","tool_name":"Bash","cwd":"/w","tool_input":${ti}}` });
}
add({ fn: 'canon', text: '{"session_id":"s","session_id":"t","tool_name":"Bash","cwd":"/w","tool_input":{}}' });
for (const a of ['false', 'null', '0', '""', '"x"', '[]']) add({ fn: 'canon', text: `{"session_id":"s","agent_id":${a},"tool_name":"T","cwd":"/w","tool_input":null}` });
for (const t of ['null', '[1]', '"s"', '{}', '{"tool_input":{"b":1,"a":{"d":2,"c":3}},"cwd":1,"tool_name":true,"session_id":null}']) add({ fn: 'canon', text: t });

// ---- the client's answers
for (const body of ['{"id":41,"waitS":1}', '{"id":41.0,"waitS":1}', '{"id":1e2,"waitS":1}', '{"id":41,"waitS":1,"park":"live"}',
  '{"id":41,"waitS":1,"park":"live\\nx"}', '{"id":41,"waitS":1,"park":" live"}', '{"id":41,"waitS":1,"park":1}', '{"id":"41","waitS":1}',
  '[1]', '[1]\n{"id":41,"waitS":2}', '{"id":41,"waitS":2} garbage', '{"id":41,"waitS":2}{"id":42,"waitS":3}', '""', '', 'null',
  '{"id":1234567890123456,"waitS":1}', '{"id":123456789012345,"waitS":999999}', '{"id":41,"waitS":1000000}', '{"id":-1,"waitS":1}',
  '{"id":0,"waitS":1}', '{"id":41,"waitS":0.5}', '{"id":41,"waitS":1,"park":"li\\u0000ve"}', '{"id":41}', '{"waitS":1}']) {
  add({ fn: 'granted', body });
}
for (const body of ['{"ok":false,"error":"deny-not-engaged"}', '{"error":"Not Found"}', '{"error":"abc\\n"}', '{"error":5}', '{"error":null}',
  '[1]', 'x', '{"error":"a"}{"error":"b"}', '{"error":"a\\u0000b"}', '{"error":"A-b"}', '', '{"error":"a"} trailing', '{"error":false}',
  `{"error":"${'a'.repeat(48)}"}`, `{"error":"${'a'.repeat(49)}"}`, '{"error":"-x"}', '{"error":{"w":1}}']) {
  add({ fn: 'refused', body, code: '409' });
}
for (const body of ['{"state":"declined"}', '{"state":"released"}', '{"state":"operator"}', '{"state":"stale"}', '{"state":"parked"}',
  '{"state":"allowed","ruling":{"record":{"v":1,"n":1.50},"sig":"x"}}', '{"state":"allowed","ruling":false}', '{"state":"allowed"}',
  '{"state":["declined"]}', '{"state":"declined"}{"x":1}', '{"state":"held","ruling":{"a":1}}{"ruling":{"b":2}}', '[1]',
  '{"state":"held","ruling":{"a":1}} x', '{"state":"declined\\n"}', '{"state":"Parked"}', '{"ruling":"s"}', '{"state":null,"ruling":[1,{"k":"é"}]}']) {
  add({ fn: 'ruled', body });
}

// ---- the transcript watch
const asst = (id, input) => `${JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id, name: 'Bash', input }] } })}\n`;
const res = (id) => `${JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] } })}\n`;
const CMD = { command: 'npm test', description: 'run' };
const T = 'toolu_01';
const scan = (ti, steps) => add({ fn: 'scan', ti: JSON.stringify(ti), steps: steps.map((s) => (s === null ? null : typeof s === 'string' ? b64(s) : raw(s))) });
scan(CMD, ['', asst(T, CMD), asst(T, CMD) + res(T)]);
scan(CMD, [asst(T, CMD), asst(T, CMD), asst(T, CMD) + 'noise\n', asst(T, CMD) + 'noise\n' + res(T)]);
scan(CMD, [asst(T, CMD) + asst('toolu_02', CMD), asst(T, CMD) + asst('toolu_02', CMD) + res(T)]);
scan(CMD, [asst('toolu_00', CMD) + res('toolu_00') + asst(T, CMD), asst('toolu_00', CMD) + res('toolu_00') + asst(T, CMD) + res(T)]);
scan(CMD, [asst(T, CMD).slice(0, -1), asst(T, CMD), asst(T, CMD) + res(T)]);
scan({ file_path: '/x', limit: 2 }, [asst(T, { limit: 2, file_path: '/x' }), asst(T, { limit: 2, file_path: '/x' }) + res(T)]);
scan({ file_path: '/x' }, [asst(T, { file_path: '/x', more: 1 }) + asst('toolu_03', { file_path: '/x' }), asst(T, { file_path: '/x', more: 1 }) + asst('toolu_03', { file_path: '/x' }) + res('toolu_03')]);
scan(CMD, [asst('toolu a', CMD), asst('toolu_ab', CMD).replace('"toolu_ab"', '5'), asst('a\nb', CMD)]);
// an id with a tab is two words to `for u in $uids`, each looked up among the results on its own
scan(CMD, [asst('a\tb', CMD) + res('a') + res('b'), asst('a\tb', CMD) + res('a')]);
scan(CMD, [asst('a\nb', CMD) + 'x\n', asst('a\nb', CMD) + 'x\n' + res('a')]);
scan(CMD, [asst(T, { command: 5 }), asst(T, 'npm test'), asst(T, CMD) + 'null\n[]\n"s"\n{"message":"str"}\n{"message":{"content":"x"}}\n{"message":{"content":[1,"a",null]}}\n']);
scan(CMD, [asst(T, CMD), Buffer.concat([Buffer.from(asst(T, CMD)), Buffer.from([0, 0, 0x0a]), Buffer.from(res(T))])]);
scan(CMD, [asst(T, CMD), asst(T, CMD) + res(T).slice(0, 20), asst(T, CMD) + res(T)]);
scan(CMD, [asst(T, CMD), asst(T, CMD) + `{"note":"${T}"}\n`, asst(T, CMD) + `{"note":"${T}"}\n` + res(T)]);
scan(CMD, [asst(T, CMD), asst(T, CMD) + JSON.stringify({ message: { content: [{ type: 'tool_result', tool_use_id: 1 }] } }) + `\n${T}\n`]);
scan(CMD, [asst(T, CMD) + 'x\n', 'short\n', asst(T, CMD) + 'x\n' + res(T)]);
scan(CMD, [null, asst(T, CMD), null, asst(T, CMD) + res(T)]);
scan(CMD, [Buffer.concat([Buffer.from([0xff, 0xfe, 0x0a]), Buffer.from(asst(T, CMD))]), Buffer.concat([Buffer.from([0xff, 0xfe, 0x0a]), Buffer.from(asst(T, CMD) + res(T))])]);
scan(CMD, [asst(T, CMD).replace('\n', '\r\n'), asst(T, CMD).replace('\n', '\r\n') + res(T).replace('\n', '\r\n')]);
scan(CMD, [asst(`toolu_${'x'.repeat(129)}`, CMD)]);
scan(null, [asst(T, null), asst(T, null) + res(T)]);
scan('npm test', [asst(T, 'npm test') + asst('toolu_09', CMD), asst(T, 'npm test') + asst('toolu_09', CMD) + res(T)]);

// ---- the route patch and the drop
const AT = 1786000000000;
const state = (o) => JSON.stringify(o);
const env = { v: 1, state: 'waiting', event: 'PermissionRequest', sessionId: 'u', pid: 4242, updatedAt: AT,
  ask: { approval: { tool: 'Bash', summary: 'ls', route: 'sent' } }, subagents: [], graphQueries: 0, graphGateDenials: 0, ccrcPeerReads: 0, ccrcClaims: 0 };
const entry = (agentId, at = AT) => ({ agentId, tool: 'Bash', summary: 'ls', at, route: 'sent' });
const patch = (out, cur, word, aid, at = AT) => add({ fn: 'patch', out, cur: typeof cur === 'string' ? b64(cur) : raw(cur), word, aid, at: String(at) });
const full = state({ ...env, approvals: [entry('a1'), entry('a2'), entry('a1', AT - 1)] });
patch(full, `${full}\n`, 'request-failed', 'a1');
patch(full, `${full}\n`, 'request-refused:x', '');
patch(full, `${full}\nmore`, 'request-failed', 'a1');
patch(full, full, 'request-failed', 'a1');
patch(full, Buffer.concat([Buffer.from(`${full}\n`), Buffer.from([0]), Buffer.from('tail')]), 'request-failed', 'a1');
patch(state({ ...env, ask: null }), `${state({ ...env, ask: null })}\n`, 'request-failed', 'a1');
const odd = (o) => patch(state(o), `${state(o)}\n`, 'request-failed', 'a1');
odd({ ...env, ask: { approval: 'x' } });
odd({ ...env, ask: { approval: null } });
odd({ ...env, ask: { questions: [] } });
odd({ ...env, approvals: [entry('a1'), 5] });
odd({ ...env, approvals: [null, entry('a1')] });
odd({ ...env, approvals: { a: 1 } });
odd({ ...env, ask: { approval: { tool: 'Bash', summary: 'ls' } }, approvals: [{ agentId: 'a1', at: AT }] });
patch('{"v":1,"n":1.50,"ask":{"approval":{"route":"sent"}},"approvals":[{"agentId":"a1","at":1786000000000.0}]}',
  '{"v":1,"n":1.50,"ask":{"approval":{"route":"sent"}},"approvals":[{"agentId":"a1","at":1786000000000.0}]}\n', 'request-failed', 'a1');
const drop = (file, aid, at = AT) => add({ fn: 'drop', file: typeof file === 'string' ? b64(file) : raw(file), aid, at: String(at) });
drop(`${full}\n`, 'a1');
drop(`${full}\n`, 'a2');
drop(`${full}\n`, 'a3');
drop(`${state({ ...env, approvals: [entry('a1')] })}\n`, 'a1');
drop(`${full}\n${full}\n`, 'a2');
drop(`${full}\n${state(env)}\n`, 'a2');
drop(`${full}\n garbage`, 'a2');
drop(`${state({ ...env, approvals: [5, entry('a1')] })}\n`, 'a1');
drop(`${state({ ...env, approvals: [entry('a1'), 5] })}\n`, 'a1');
drop(`${state({ ...env, approvals: [entry('a2'), 5] })}\n`, 'a1');
drop(`${state({ ...env, approvals: [null, entry('a1')] })}\n`, 'a1');
drop('[1]\n', 'a1');
drop('null\n', 'a1');
drop('', 'a1');
drop(`${state({ ...env, approvals: 'x' })}\n`, 'a1');
drop('{"n":1.50,"approvals":[{"agentId":"a1","at":1786000000000.0},{"agentId":"a1","at":2}]}\n', 'a1');

fs.writeFileSync(path.join(here, 'approval-cases.jsonl'), `${rows.join('\n')}\n`);
