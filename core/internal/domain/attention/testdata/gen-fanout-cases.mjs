// Writes the fan-out scanner's cases (one JSON object a line: the payload `p`, and `file`, the text of the script a
// scriptPath names). Deterministic: a fixed seed, so a regeneration changes nothing unless this file does. Run by
// gen-fanout-golden.sh.
const out = [];
const add = (tool, input, file = '') => out.push({ p: { hook_event_name: 'PreToolUse', tool_name: tool, tool_input: input }, file });
// the suite's own scripts (server/test/session-hook-fan-out-routing.test.ts), then the shapes around them
const hand = [
  "const r = await agent({ prompt: 'x', model: 'sonnet' })", "await agent({ prompt: 'x', effort: 'high' })",
  "await agent({ prompt: 'a', model: 'opus', effort: 'high' });\nawait agent({ prompt: 'b', effort: 'low' });",
  "await agent({ prompt: 'b', model: 'haiku' });", "await agent({ prompt: 'b', model: 'claude-haiku-4-5' });",
  "await agent({ prompt: 'use haiku' });", "await agent({ prompt: 'x' })", 'return 1 + 1',
  'const W = { model: "sonnet", effort: "low" }; await agent("x", W)',
  'const W = { model: "sonnet", effort: "low" }; await pipeline(items, i => agent(i, W))',
  'await agent("x", { ...W, effort: "low" })', "await agent(`call agent( later`, { model: 'opus', effort: 'high' })",
  "const p = 'then agent(x) the rest'; return p", "await agent('review the data model', { effort: 'low' })",
  "await agent('review the model: effort: x', { model: 'opus' })", "await agent('x', { model: 'opus', effort: 'high' })",
  "await agent('x', { model, effort })", "await agent('x', { model: 'opus' })", "await agent('x')",
  "const re = /'/; await agent('p', {model:'opus', effort:'low'}); const s = 'agent(foo)'", "const re = /'/; await agent('p', {model:'opus'})",
  "await agent('p", "agent('x')\nfoo", "await agent(f(a, b) + 'x, y', { model: 'opus', effort: 'high' })",
  "await agent(f(a, b) + 'x, y', { model: 'opus' })", "await agent('x', {\n  model: 'opus',\n  effort: 'high',\n})",
  "await agent('x', { 'model': 'opus', \"effort\": 'low' })", "// agent('x')\nawait agent('y', {model:'opus', effort:'low'})",
  "/* agent('x') */ await agent('y', {model:'opus'})", "/* agent('x') never closes", "x = a / b; agent('q', { model: 'opus', effort: 'low' })",
  "x = a / b / c; agent('q')", "agent(\n 'q',\n {model: 'opus', effort: 'low'}\n)", "agent('q',)", 'agent()', 'agent(...args)', "agent( ...args, {model:'opus'})",
  "myagent('x')", "obj.agent('x')", "$agent('x')", "agent_('x')", "agent ('x')", "await agent ('x')", "agent('x', { model: 'opus', effort: 'low' }) ; agent('z')",
  "agent('a', { model: 'a(', effort: \"}\" })", "agent('a', { model: 'opus', effort: 'x' }", "agent({model:'opus'})", "agent({model:'opus', effort:'high'}, 2)",
  "if (x) /re[/]x/.test(y); agent('z')", "a = b ? /[/]'/ : 1; agent('t')", "`agent(` + agent('x', {model:'m', effort:'e'})",
];
for (const s of hand) { add('Workflow', { script: s }); add('Workflow', { scriptPath: '/x/y.js' }, s); add('Workflow', { script: 'return 1', scriptPath: '/x/y.js' }, s); }
// the tool and input shapes
for (const t of ['Agent', 'Task']) {
  for (const i of [{ prompt: 'p' }, { prompt: 'p', model: '' }, { model: 'opus' }, { model: 5 }, { model: null }, { model: ['a'] }, { model: 'FABLE' }, 'str', 5, null, ['x'], true, {}]) add(t, i);
}
for (const i of [{ script: 42 }, { script: null }, { script: '' }, { script: '', scriptPath: 'p' }, { name: 'saved' }, 'str', null, 5, [], { scriptPath: 5 }]) { add('Workflow', i); add('Workflow', i, "agent('x')"); }
add('Bash', { command: 'echo agent( x' });
add('Workflow', undefined);
// a seeded walk over the tokens the scanner reads
let a = 0x9e3779b9;
const rnd = () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const toks = ['agent(', 'agent (', 'agent', '(', ')', '{', '}', '[', ']', ',', ',', ':', "model: 'opus'", "effort: 'low'", 'model', 'effort', "model: 'haiku'", "'claude-haiku-4-5'",
  '...W', "'", '"', '`', '/', '//', '/*', '*/', '\n', '\\', '=', ';', ' ', ' ', ' ', 'x', 'a', 'foo.', '$', '_', ' ', '　', ' ', '\t', "'x'", '{model, effort}', '{ model: "o", effort: "h" }', '..', '/[/]/', '!', '?', '|'];
for (let n = 0; n < 6000; n++) {
  const len = 1 + Math.floor(rnd() * 40);
  let s = '';
  for (let i = 0; i < len; i++) s += toks[Math.floor(rnd() * toks.length)];
  add('Workflow', { script: s });
}
// statements built from calls: arguments, options and noise around them, so most cases hold a call to judge
const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
const args = ["'x'", '"y, z"', '`t ${a}`', 'f(a, b)', 'f(a, b) + "q"', '[1, 2]', 'W', '', '...W', "'a' + 'b'", '/re,/', 'x ? 1 : 2', "{ nested: { a: 1 } }", "'it\\'s'"];
const opts = ["{ model: 'opus', effort: 'high' }", "{ model: 'opus' }", "{ effort: 'low' }", "{ model: 'haiku' }", "{ 'model': 'claude-haiku-4-5' }", '{ model, effort }',
  '{ model }', '{ effort, model: "o" }', '{ ...W }', '{ ...W, effort: "low" }', "{ prompt: 'the model: x', effort: 'low' }", "{ prompt: '{ model: 1, effort: 2 }' }", '{}',
  'W', 'opts()', "{ model: 'o', effort: 'e' } /* } */", "{ // }\n model: 'o', effort: 'e' }", '{ a: { model: 1, effort: 2 } }', '{ model : "o" , effort : "e" }', '{ amodel: 1, effort: 1 }', '{ "model": 1, "effort": 2 }',
  "{ model: `o`, effort: 'e' }", '{ model\n: "o", effort\n: "e" }'];
const noise = ["// agent('n')\n", "/* agent( */", "const s = 'agent(';", 'const r = /agent(/;', 'x = a / b;', "if (a) /'/.test(b);", 'foo.agent(1);', 'myagent(2);', '', '`${agent(1)}`;', 'const t = "a\\"gent(";'];
for (let n = 0; n < 4000; n++) {
  const calls = 1 + Math.floor(rnd() * 3);
  let s = '';
  for (let i = 0; i < calls; i++) {
    s += pick(noise);
    const a1 = pick(args), o1 = pick(opts);
    s += pick(['await ', '', 'return ', 'x = ']) + 'agent' + pick(['', ' ', '\n']) + '(' + a1 + (rnd() < 0.15 ? '' : pick([', ', ',\n  ', ' ,']) + o1) + pick(['', ',']) + ')' + pick([';', '\n', ' ']);
  }
  if (rnd() < 0.1) s = s.slice(0, Math.floor(rnd() * s.length));
  add('Workflow', { script: s });
}
process.stdout.write(out.map((c) => JSON.stringify(c)).join('\n') + '\n');
