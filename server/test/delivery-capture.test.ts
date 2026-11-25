// The paste delivery recipe's pure half (Desktop polish wave 178; `shared/deliveryCapture.ts`): the cases, the composer's
// normalisations, what counts as a turn the model received, each case's verdict, the recipe's word and the result's one
// reader. The cases are checked against the sizes the browser wave recorded (paste-reliability.md section 3), so a
// generator that drifts from that note is red here.
import { describe, expect, it, vi } from 'vitest';
import { composePrompt } from '../../shared/api.js';
import {
  DELIVERY_CASE_RAW, DELIVERY_MODE_CHARS, DELIVERY_RECIPE_VERSION, composerOutput, deliveryCaptureResult, deliveryCaseResult,
  deliveryCaseText, deliveryCaseVerdict, deliveryExpected, firstDivergence, turnOf, type DeliveryObserved,
} from '../../shared/deliveryCapture.js';
import {
  DELIVERY_CASE_IDS, DELIVERY_CONTEXT, DELIVERY_VERSION_SHAPE, deliveryWord, readDeliveryCaptureResult, type DeliveryCaseId, type DeliveryCaseResult,
} from '../../shared/deliveryResult.js';

const BUILD = '2.1.320';
const cps = (s: string): number => Array.from(s).length;
const bytes = (s: string): number => new TextEncoder().encode(s).length;
const lines = (s: string): number => s.split('\n').length;

describe('the cases: the browser wave\'s synthetic cases, rebuilt by the same rules', () => {
  // [id, code points, lines] of the raw case (paste-reliability.md section 3); c2a counts the typed prefix (31) and the
  // pasted run (5012) together, since they leave the browser as one string.
  const SIZES: readonly (readonly [DeliveryCaseId, number, number])[] = [
    ['c0', 33, 1], ['c1', 6011, 1], ['c1b', 3039, 3], ['c2a', 5043, 1], ['c2b', 5044, 3], ['c3', 199, 11], ['c3b', 62, 9],
    ['c3c', 668, 46], ['c4', 80, 1], ['c4b', 4012, 1], ['c5', 60, 4],
  ];
  it.each(SIZES)('%s has %i code points over %i lines', (id, n, l) => {
    const raw = DELIVERY_CASE_RAW[id]();
    expect(cps(raw)).toBe(n);
    expect(lines(raw)).toBe(l);
    expect(raw).toMatch(new RegExp(`ZQX-END-${id}`));
  });
  it('c4 is 144 bytes and c4b 9132, as recorded', () => {
    expect(bytes(DELIVERY_CASE_RAW.c4())).toBe(144);
    expect(bytes(DELIVERY_CASE_RAW.c4b())).toBe(9132);
  });
  it('the ASCII run marks each block with its offset, and the Unicode run each group with its index', () => {
    const c1 = DELIVERY_CASE_RAW.c1();
    expect(c1.slice(0, 11)).toBe('<c1@00000>a');
    expect(c1.slice(100, 110)).toBe('<c1@00100>');
    expect(c1.slice(5900, 5910)).toBe('<c1@05900>');
    const c4b = Array.from(DELIVERY_CASE_RAW.c4b());
    expect(c4b.slice(0, 11).join('')).toBe('<c4b#0000>Ж');
    expect(c4b.slice(50, 61).join('')).toBe('<c4b#0001>漢');
  });
  it('the order is the control first, then every case once', () => {
    expect(DELIVERY_CASE_IDS).toEqual(['c0', 'c1', 'c1b', 'c2a', 'c2b', 'c3', 'c3b', 'c3c', 'c4', 'c4b', 'c5']);
  });
});

describe('the composer\'s documented normalisations', () => {
  it('CRLF reads as LF (c5)', () => {
    expect(deliveryCaseText('c5')).toBe('crlf line one c5\ncrlf line two\n\ncrlf line four ZQX-END-c5');
  });
  it('the trim removes the edges only: c3 loses its first indent, its interior is untouched', () => {
    const t = deliveryCaseText('c3');
    expect(t.startsWith('def first_line_indented():\n        return 1\n\n\tTabbed')).toBe(true);
    expect(t).toContain('line with trailing spaces   \n');
    expect(t).toContain('\n   \nZQX-END-c3');
  });
  it('c3b loses its leading blank lines, its first indent and its trailing newlines', () => {
    expect(deliveryCaseText('c3b')).toBe('leading blank lines then indent c3b\n\nmiddle\n\nZQX-END-c3b');
  });
  it('a lone CR reads as LF too', () => {
    expect(composerOutput('a\rb')).toBe('a\nb');
  });
  it('the expected text is the send path\'s own compose step over the sent text', () => {
    for (const id of DELIVERY_CASE_IDS) expect(deliveryExpected(id)).toBe(composePrompt(deliveryCaseText(id), []));
  });
  it('no case can start a mode switch in the pane: none starts with a slash, a shell line, a memory note or a mention', () => {
    expect(DELIVERY_MODE_CHARS).toEqual(['/', '!', '#', '@']);
    for (const id of DELIVERY_CASE_IDS) {
      for (const text of [deliveryCaseText(id), deliveryExpected(id)]) expect(DELIVERY_MODE_CHARS.includes(text[0]!)).toBe(false);
    }
  });
});

describe('turnOf: what the model was asked for', () => {
  const req = (content: unknown, over: Record<string, unknown> = {}): Record<string, unknown> =>
    ({ model: 'm', tools: [{ name: 'Bash' }], messages: [{ role: 'user', content }], ...over });
  it('a string prompt is one block', () => {
    expect(turnOf(req('hello'))).toEqual({ prompt: 'hello', blocks: 1 });
  });
  it('blocks that are wholly a system reminder are left out', () => {
    const r = turnOf(req([{ type: 'text', text: '<system-reminder>\nx\n</system-reminder>' }, { type: 'text', text: 'the prompt' }]));
    expect(r).toEqual({ prompt: 'the prompt', blocks: 1 });
  });
  it('two prompt blocks are kept, joined, and counted', () => {
    expect(turnOf(req([{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }]))).toEqual({ prompt: 'a\nb', blocks: 2 });
  });
  it('a side request (no tools) is not a turn', () => {
    expect(turnOf(req('hello', { tools: [] }))).toBeNull();
    expect(turnOf({ model: 'm', messages: [{ role: 'user', content: 'hello' }] })).toBeNull();
  });
  it('a tool result is not a turn', () => {
    expect(turnOf(req([{ type: 'tool_result', tool_use_id: 't', content: 'x' }]))).toBeNull();
  });
  it('a request whose last message is the assistant\'s is not a turn', () => {
    expect(turnOf({ tools: [{ name: 'Bash' }], messages: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }] })).toBeNull();
  });
  it('a reminder alone, or no text, is not a turn', () => {
    expect(turnOf(req([{ type: 'text', text: '<system-reminder>x</system-reminder>' }]))).toBeNull();
    expect(turnOf(req([{ type: 'image', source: {} }]))).toBeNull();
    expect(turnOf(null)).toBeNull();
  });
  it('only the last message counts: an earlier user turn in the history is not this request\'s prompt', () => {
    const body = { tools: [{ name: 'Bash' }], messages: [{ role: 'user', content: 'old' }, { role: 'assistant', content: 'ok' }, { role: 'user', content: 'new' }] };
    expect(turnOf(body)?.prompt).toBe('new');
  });
});

describe('the verdict of one case', () => {
  const E = deliveryExpected('c1');
  it('one equal turn is intact', () => {
    expect(deliveryCaseVerdict(E, { send: 'ok', turns: [E] })).toBe('intact');
  });
  it('a prompt received twice is a fault, never a pass', () => {
    expect(deliveryCaseVerdict(E, { send: 'ok', turns: [E, E] })).toBe('duplicate');
    expect(deliveryWord(['intact', 'duplicate'])).toBe('fault');
  });
  it('a truncated prompt is altered, with its first divergence', () => {
    const cut = E.slice(0, 5000);
    expect(deliveryCaseVerdict(E, { send: 'ok', turns: [cut] })).toBe('altered');
    const r = deliveryCaseResult('c1', { send: 'ok', turns: [cut], sideRequests: 0, hookPrompts: [cut] });
    expect(r.divergence).toMatchObject({ turn: 0, index: 5000 });
    expect(r.hook).toBe('unequal');
  });
  it('a prompt split in two turns is a split, its divergence the first turn\'s', () => {
    const lines2 = deliveryExpected('c1b').split('\n');
    const turns = [lines2[0]!, lines2.slice(1).join('\n')];
    expect(deliveryCaseVerdict(deliveryExpected('c1b'), { send: 'ok', turns })).toBe('split');
    const r = deliveryCaseResult('c1b', { send: 'ok', turns, sideRequests: 0, hookPrompts: [] });
    expect(r.divergence).toMatchObject({ turn: 0, index: 3000 });
    expect(r.receivedChars).toEqual([3000, 38]);
  });
  it('a reordered prompt is a fault: in one turn altered, over two turns split', () => {
    const [a, b] = [E.slice(0, 3000), E.slice(3000)];
    expect(deliveryCaseVerdict(E, { send: 'ok', turns: [b + a] })).toBe('altered');
    expect(deliveryCaseVerdict(E, { send: 'ok', turns: [b, a] })).toBe('split');
    // `<c1@03000>` against `<c1@00000>`: the first five characters agree.
    expect(firstDivergence(E, b + a)?.index).toBe(5);
  });
  it('an ok with nothing received is a false confirmation', () => {
    expect(deliveryCaseVerdict(E, { send: 'ok', turns: [] })).toBe('false-confirmation');
  });
  it('a refusal with nothing received is refused; with something received, partial', () => {
    expect(deliveryCaseVerdict(E, { send: 'verify-failed', turns: [] })).toBe('refused');
    expect(deliveryCaseVerdict(E, { send: 'verify-failed', turns: [E.slice(0, 10)] })).toBe('partial');
    expect(deliveryCaseVerdict(E, { send: 'verify-failed', turns: [E] })).toBe('partial');
  });
  it('the divergence keeps its context each side, in code points', () => {
    const exp = 'x'.repeat(100) + '🙂' + 'y'.repeat(100);
    const got = 'x'.repeat(100) + 'é' + 'y'.repeat(100);
    const d = firstDivergence(exp, got)!;
    expect(d.index).toBe(100);
    expect(cps(d.expected)).toBe(2 * DELIVERY_CONTEXT);
    expect(d.expected.startsWith('x'.repeat(DELIVERY_CONTEXT) + '🙂')).toBe(true);
    expect(d.received.startsWith('x'.repeat(DELIVERY_CONTEXT) + 'é')).toBe(true);
    expect(firstDivergence(exp, exp)).toBeNull();
  });
  it('the hook\'s witness is reported, never the verdict', () => {
    const r = deliveryCaseResult('c0', { send: 'ok', turns: [deliveryExpected('c0')], sideRequests: 2, hookPrompts: ['other'] });
    expect(r).toMatchObject({ verdict: 'intact', hook: 'unequal', sideRequests: 2 });
    expect(deliveryCaseResult('c0', { send: 'ok', turns: [deliveryExpected('c0')], sideRequests: 0, hookPrompts: [] }).hook).toBe('absent');
  });
});

describe('the recipe\'s word', () => {
  it('fault wins over refused, refused over intact', () => {
    expect(deliveryWord(['intact', 'intact'])).toBe('intact');
    expect(deliveryWord(['intact', 'refused'])).toBe('refused');
    expect(deliveryWord(['refused', 'split'])).toBe('fault');
    for (const v of ['duplicate', 'split', 'altered', 'false-confirmation', 'partial'] as const) expect(deliveryWord(['intact', v])).toBe('fault');
  });
});

describe('readDeliveryCaptureResult: the one reader', () => {
  const allIntact = (): DeliveryCaseResult[] => DELIVERY_CASE_IDS.map((id) => deliveryCaseResult(id, { send: 'ok', turns: [deliveryExpected(id)], sideRequests: 0, hookPrompts: [deliveryExpected(id)] }));
  const wire = (r: unknown): unknown => JSON.parse(JSON.stringify(r));
  it('reads back a result over the wire', () => {
    const r = deliveryCaptureResult(BUILD, allIntact());
    expect(r.word).toBe('intact');
    expect(readDeliveryCaptureResult(wire(r), BUILD)).toEqual(r);
  });
  it('reads back a faulty result, divergence and all', () => {
    const cases = allIntact();
    const obs: DeliveryObserved = { send: 'ok', turns: [deliveryExpected('c3').replace('\t', '  ')], sideRequests: 1, hookPrompts: [] };
    cases[5] = deliveryCaseResult('c3', obs);
    const r = deliveryCaptureResult(BUILD, cases);
    expect(r.word).toBe('fault');
    expect(readDeliveryCaptureResult(wire(r), BUILD)).toEqual(r);
  });
  const good = (): Record<string, unknown> => wire(deliveryCaptureResult(BUILD, allIntact())) as Record<string, unknown>;
  const casesOf = (o: Record<string, unknown>): Record<string, unknown>[] => o['cases'] as Record<string, unknown>[];
  it.each<[string, (o: Record<string, unknown>) => void]>([
    ['another build', (o) => { o['build'] = '2.1.321'; }],
    ['a recipe that is not delivery', (o) => { o['recipe'] = 'build-trust'; }],
    ['a version off its shape', (o) => { o['version'] = 'v1'; }],
    ['no version', (o) => { delete o['version']; }],
    ['a field it does not name', (o) => { o['pass'] = true; }],
    ['a word the cases do not give', (o) => { o['word'] = 'fault'; }],
    ['a case missing', (o) => { casesOf(o).pop(); }],
    ['cases out of order', (o) => { const c = casesOf(o); [c[0], c[1]] = [c[1]!, c[0]!]; }],
    ['a case repeated', (o) => { const c = casesOf(o); c[1] = c[0]!; }],
    ['a verdict the counts cannot give', (o) => { casesOf(o)[0]!['verdict'] = 'duplicate'; }],
    ['a divergence on an intact case', (o) => { casesOf(o)[0]!['divergence'] = { turn: 0, index: 1, expected: 'a', received: 'b' }; }],
    ['a send word off its shape', (o) => { casesOf(o)[0]!['send'] = 'OK!'; }],
    ['a context longer than its bound', (o) => {
      const c = casesOf(o)[0]!;
      Object.assign(c, { verdict: 'altered', divergence: { turn: 0, index: 0, expected: 'x'.repeat(81), received: 'y' } });
    }],
    ['an altered case with no divergence', (o) => { casesOf(o)[0]!['verdict'] = 'altered'; }],
    ['a divergence naming a turn that never came', (o) => {
      Object.assign(casesOf(o)[0]!, { verdict: 'altered', divergence: { turn: 1, index: 0, expected: 'a', received: 'b' } });
    }],
    ['a count that is not a count', (o) => { casesOf(o)[0]!['sentChars'] = -1; }],
  ])('refuses %s', (_why, mutate) => {
    const o = good();
    expect(readDeliveryCaptureResult(o, BUILD)).not.toBeNull();
    mutate(o);
    expect(readDeliveryCaptureResult(o, BUILD)).toBeNull();
  });
  it('refuses a build that is not a Claude Code version, and anything that is not an object', () => {
    const r = deliveryCaptureResult('nope', allIntact());
    expect(readDeliveryCaptureResult(wire(r), 'nope')).toBeNull();
    expect(readDeliveryCaptureResult(null, BUILD)).toBeNull();
    expect(readDeliveryCaptureResult([], BUILD)).toBeNull();
  });
});

describe('the recipe\'s version: computed from the cases and the rule, never kept by hand', () => {
  it('is 16 hex characters, and the result carries it', () => {
    expect(DELIVERY_RECIPE_VERSION).toMatch(DELIVERY_VERSION_SHAPE);
    expect(deliveryCaptureResult(BUILD, []).version).toBe(DELIVERY_RECIPE_VERSION);
  });
  it('is the same every time it is computed (a fresh module graph computes it again)', async () => {
    vi.resetModules();
    const again = await import('../../shared/deliveryCapture.js');
    expect(again.DELIVERY_RECIPE_VERSION).toBe(DELIVERY_RECIPE_VERSION);
  });
});

describe('the result travels without the cases', () => {
  it('the result file names no case text and no generator: only ids', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../../shared/deliveryResult.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/ZQX-END|asciiRun|unicodeRun|DELIVERY_CASE_RAW|from '\.\/deliveryCapture\.js'/);
  });
});
