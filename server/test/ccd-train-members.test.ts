// The train record's second form (D-9111): the merge train tool writes a ```train-members``` block, never the
// documented `ccrc-train v1` one, so the one parser (`_pr_train_py`'s `train-check`, ccd/lib/train-proof.sh) reads both.
// Every case asserts the WHOLE line `train-check` prints, so a refusal with the wrong sentence reds, and a malformed
// member always sits beside a valid #42 at its head, so a mutant that stops refusing it proves #42 and reds. Cases
// P1 to P38 and P9b are the wave 5l plan's section 9.1 (docs/superpowers/plans/2026-11-26-landing-order-wave5l-train-landings.md).
// P39 and P40 are fix round 1's (docs/superpowers/programs/landing-order/wave5l-fix-round-1.md).
// Every ccd call runs in a fixture HOME (`makePrHarness`); no case reads GitHub.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  GH_STUB, makePrHarness, rawTrainMembers, toolTrainRow, trainBlock, trainMembers, trainRow, type PrHarness,
} from './ccdPrHelpers.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-ccd-train-members-'); });
afterEach(() => { h.cleanup(); });

const H = 'a'.repeat(40); const M = 'e'.repeat(40); const S = 'b'.repeat(40);
const PROVED = `50\t${M}`;
/** `!W` of the plan: the train's number, then the sentence. */
const W = (s: string): string => `!train #50 ${s}`;
const ABSENT = W('carries no train record: no ccrc-train v1 block and no train-members block');
const MEMBER_BAD = W('has a train-members block with a member that is not a pr and a full head sha');
const NOT_ARRAY = W('has a train-members block that is not one JSON array of members');
const NEVER_CLOSES = W('has a train-members block that never closes');
const DIFFER = W('has a ccrc-train v1 block and a train-members block that list different members or heads');
const BOTH = 'ccrc-train v1 block, like its train-members block,';

/** One member as the tool writes it, its `pr` given as raw JSON text. */
const mem = (pr: string, sha: string): string => `{"pr": ${pr}, "headSha": "${sha}", "blast": 1}`;
const VALID42 = mem('42', H);
/** A tool block whose array holds a valid #42 at its head and `other`. */
const beside = (other: string): string => rawTrainMembers(`[${VALID42}, ${other}]`);

/** The one line `train-check` prints for member #42 at `H`, base `main`, with `train` as gh's answer. */
function check(train: unknown): string {
  const f = path.join(h.home, 'train.json');
  fs.writeFileSync(f, JSON.stringify(train));
  return h.sh(`_pr_py train-check 42 ${H} main < '${f}'`);
}
/** A tool-written train whose body is `toolTrainRow`'s with `body` rewritten by `edit`. */
const editBody = (block: string, edit: (body: string) => string): Record<string, unknown> => {
  const row = toolTrainRow(50, M, block);
  return { ...row, body: edit(row.body as string) };
};

describe('the train tool\'s train-members block proves a member, by the one parser (D-9111)', () => {
  it('P1: the tool block alone, #42 at its head, proves', () => {
    expect(check(toolTrainRow(50, M, trainMembers([[42, H]])))).toBe(PROVED);
  });
  it('P2: a short sha beside a valid #42 proves nothing', () => {
    expect(check(toolTrainRow(50, M, beside(mem('43', S.slice(0, 12)))))).toBe(MEMBER_BAD);
  });
  it('P3: an uppercase sha beside a valid #42 proves nothing', () => {
    expect(check(toolTrainRow(50, M, beside(mem('43', 'B'.repeat(40)))))).toBe(MEMBER_BAD);
  });
  it.each([['"43"'], ['true'], ['43.0'], ['12345678901']])('P4: a pr of %s beside a valid #42 proves nothing', (pr) => {
    expect(check(toolTrainRow(50, M, beside(mem(pr, S))))).toBe(MEMBER_BAD);
  });
  it('P5: two tool blocks, both listing #42 at its head, prove nothing', () => {
    const one = trainMembers([[42, H]]);
    expect(check(toolTrainRow(50, M, `${one}\n${one}`))).toBe(W('carries 2 train-members blocks, not one'));
  });
  it('P6: a tool block that never closes proves nothing', () => {
    expect(check(toolTrainRow(50, M, trainMembers([[42, H]]).replace(/```\n$/, '')))).toBe(NEVER_CLOSES);
  });
  it.each([
    ['an empty array', '[]'],
    ['an object, not an array', `{"pr": 42, "headSha": "${H}"}`],
    ['NaN in the never-read key', `[{"pr": 42, "headSha": "${H}", "blast": NaN}]`],
    ['a key given twice', `[{"pr": 42, "pr": 42, "headSha": "${H}"}]`],
  ])('P7: content that is %s proves nothing', (_n, content) => {
    expect(check(toolTrainRow(50, M, rawTrainMembers(content)))).toBe(NOT_ARRAY);
  });
  it('P8: #42 listed twice proves nothing', () => {
    expect(check(toolTrainRow(50, M, trainMembers([[42, H], [42, H]])))).toBe(W('has a train-members block listing #42 twice'));
  });
  it('P9: the tool block lists #42 at another sha, and the sentence names the tool block', () => {
    expect(check(toolTrainRow(50, M, trainMembers([[42, S]]))))
      .toBe(`!train #50's train-members block lists #42 at ${S}, not its head ${H}`);
  });
  it('P9b: the v1 block alone at another sha keeps today\'s sentence, byte for byte', () => {
    expect(check(trainRow(50, M, [[42, S]]))).toBe(`!train #50's ccrc-train v1 block lists #42 at ${S}, not its head ${H}`);
  });
  it('P10: the tool block does not list #42', () => {
    expect(check(toolTrainRow(50, M, trainMembers([[43, H]])))).toBe('!train #50\'s train-members block does not list #42');
  });
  it('P11: both blocks with equal maps prove', () => {
    expect(check(toolTrainRow(50, M, `${trainMembers([[42, H]])}\n${trainBlock([[42, H]])}`))).toBe(PROVED);
  });
  it('P12: both blocks, the tool\'s listing #42 at another sha, prove nothing', () => {
    expect(check(toolTrainRow(50, M, `${trainMembers([[42, S]])}\n${trainBlock([[42, H]])}`))).toBe(DIFFER);
  });
  it('P13: both blocks, the v1 block listing a member the tool\'s does not, prove nothing', () => {
    expect(check(toolTrainRow(50, M, `${trainMembers([[42, H]])}\n${trainBlock([[42, H], [43, S]])}`))).toBe(DIFFER);
  });
  it('P14: a v1 block that proves beside a tool block that never closes proves nothing', () => {
    const open = trainMembers([[42, H]]).replace(/```\n$/, '');
    expect(check(toolTrainRow(50, M, `${trainBlock([[42, H]])}\n${open}`))).toBe(NEVER_CLOSES);
  });
  it('P15: a hand-added v1 block alone still proves', () => {
    expect(check(toolTrainRow(50, M, trainBlock([[42, H]])))).toBe(PROVED);
  });
  it('P16: an OPEN train with a valid tool block and merge facts is not read as proof', () => {
    expect(check(toolTrainRow(50, M, trainMembers([[42, H]]), { state: 'OPEN' }))).toBe('?train #50 is still open');
  });
  it('P17: a CLOSED unmerged train with a valid tool block fails', () => {
    expect(check(toolTrainRow(50, M, trainMembers([[42, H]]), { state: 'CLOSED' }))).toBe('!train #50 is closed, not merged');
  });
  it('P18: the tool\'s table and trailer alone, with no block, prove nothing', () => {
    expect(check(toolTrainRow(50, M, ''))).toBe(ABSENT);
  });
  it('P21: fence lines indented by two spaces prove', () => {
    expect(check(toolTrainRow(50, M, trainMembers([[42, H]]).replace(/^```/gm, '  ```')))).toBe(PROVED);
  });
  it('P22: CRLF line ends throughout the body prove', () => {
    expect(check(editBody(trainMembers([[42, H]]), (b) => b.replace(/\n/g, '\r\n')))).toBe(PROVED);
  });
  it('P23: a JSON array spread over three lines proves', () => {
    expect(check(toolTrainRow(50, M, rawTrainMembers(`[\n${VALID42}\n]`)))).toBe(PROVED);
  });
  it('P24: a stray fence line later in the body is outside the block, and the block proves', () => {
    expect(check(toolTrainRow(50, M, `${trainMembers([[42, H]])}\nMore words.\n\`\`\`\n`))).toBe(PROVED);
  });
  it('P25: a block quoted with a leading "> " on every line is no block', () => {
    const quoted = trainMembers([[42, H]]).split('\n').map((l) => (l ? `> ${l}` : l)).join('\n');
    expect(check(toolTrainRow(50, M, quoted))).toBe(ABSENT);
  });
  it('P26: a 41-character sha beside a valid #42 proves nothing', () => {
    expect(check(toolTrainRow(50, M, beside(mem('43', 'a'.repeat(41)))))).toBe(MEMBER_BAD);
  });
  it('P27: a pr of 0 beside a valid #42 proves nothing', () => {
    expect(check(toolTrainRow(50, M, beside(mem('0', S))))).toBe(MEMBER_BAD);
  });
  it('P28: a pr with a leading zero is not JSON, and proves nothing', () => {
    expect(check(toolTrainRow(50, M, rawTrainMembers(`[${mem('042', H)}]`)))).toBe(NOT_ARRAY);
  });
  it('P29: text after the array proves nothing', () => {
    expect(check(toolTrainRow(50, M, rawTrainMembers(`[${VALID42}] x`)))).toBe(NOT_ARRAY);
  });
  it('P30: a v1 block with no member at all keeps today\'s sentence', () => {
    expect(check(toolTrainRow(50, M, '<!-- ccrc-train v1\n-->\n'))).toBe('!train #50\'s ccrc-train v1 block does not list #42');
  });
  it('P31: 100 000 nested brackets are caught by the parse, and the prover prints its line', () => {
    expect(check(toolTrainRow(50, M, rawTrainMembers('['.repeat(100_000))))).toBe(NOT_ARRAY);
  });
  it('P32: a member with no blast proves', () => {
    expect(check(toolTrainRow(50, M, rawTrainMembers(`[{"pr": 42, "headSha": "${H}"}]`)))).toBe(PROVED);
  });
  it('P33: a member with a key the grammar does not know proves', () => {
    expect(check(toolTrainRow(50, M, rawTrainMembers(`[{"pr": 42, "headSha": "${H}", "blast": 1, "note": "x"}]`)))).toBe(PROVED);
  });
  it.each([['"x"'], ['1.5']])('P34: a blast of %s proves', (blast) => {
    expect(check(toolTrainRow(50, M, rawTrainMembers(`[{"pr": 42, "headSha": "${H}", "blast": ${blast}}]`)))).toBe(PROVED);
  });
  it('P35: compact separators and reordered keys prove', () => {
    expect(check(toolTrainRow(50, M, rawTrainMembers(`[{"headSha":"${H}","pr":42}]`)))).toBe(PROVED);
  });
  it('P36: fence lines indented by one tab prove', () => {
    expect(check(toolTrainRow(50, M, trainMembers([[42, H]]).replace(/^```/gm, '\t```')))).toBe(PROVED);
  });
  it('P37: both blocks, equal maps, not listing #42: the sentence names both', () => {
    expect(check(toolTrainRow(50, M, `${trainMembers([[43, H]])}\n${trainBlock([[43, H]])}`)))
      .toBe(`!train #50's ${BOTH} does not list #42`);
  });
  it('P38: both blocks, equal maps, listing #42 at another sha: the sentence names both', () => {
    expect(check(toolTrainRow(50, M, `${trainMembers([[42, S]])}\n${trainBlock([[42, S]])}`)))
      .toBe(`!train #50's ${BOTH} lists #42 at ${S}, not its head ${H}`);
  });
  // Fix round 1 (review 3963, F1): the v1 half of `train_members`'s first row, a bad v1 block refusing with its own
  // sentence whatever the tool block says.
  it('P39: a doubled v1 block beside a proving tool block proves nothing, with the v1 sentence', () => {
    const v1 = trainBlock([[42, H]]);
    expect(check(toolTrainRow(50, M, `${trainMembers([[42, H]])}\n${v1}${v1}`))).toBe(W('carries 2 ccrc-train v1 blocks, not one'));
  });
  it('P40: a v1 block with a line that is not a member line, and no tool block, proves nothing, with the v1 sentence', () => {
    expect(check(toolTrainRow(50, M, `<!-- ccrc-train v1\nmember #42 ${H}\nnot a member line\n-->\n`)))
      .toBe(W('has a ccrc-train v1 block with a line that is not a member line'));
  });
});

describe('the one-PR form proves a tool-written train end to end (D-9111)', () => {
  const member = (comments: unknown[]): Record<string, unknown> => ({
    number: 42, state: 'CLOSED', headRefOid: H, baseRefName: 'main', isCrossRepository: false,
    mergedAt: null, mergeCommit: null, labels: [{ name: 'landed-in-train' }], comments,
  });
  const lineOf = (stdout: string): Record<string, unknown> => {
    const lines = stdout.split('\n').filter(Boolean);
    expect(lines, 'exactly one JSON line').toHaveLength(1);
    return JSON.parse(lines[0]!) as Record<string, unknown>;
  };
  const proofs = (): string => {
    const f = path.join(h.home, '.cc-sessions', '.train-proofs');
    return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
  };
  const expectProved = (stdout: string): void => {
    expect(lineOf(stdout)).toMatchObject({ number: 42, state: 'merged', landedInTrain: true, train: 50, trainMergeCommit: M });
    expect(proofs().split('\n').filter(Boolean)).toEqual([expect.stringMatching(new RegExp(` main 42 ${H} 50 ${M}$`))]);
  };

  it('P19: the member\'s comment names the train, and its tool block proves it', () => {
    h.makeGhRepo('demo');
    h.ghView(42, member([{ body: 'Landed in train #50 (head `aaaaaaaaaaaa`).' }]));
    h.ghView(50, toolTrainRow(50, M, trainMembers([[42, H]])));
    expectProved(h.run(`${GH_STUB} cmd_pr_state --project demo --pr 42`).stdout);
  });
  it('P20: no comment names it, and the search fallback finds the tool-written train', () => {
    h.makeGhRepo('demo');
    h.ghView(42, member([]));
    h.ghSearch([toolTrainRow(50, M, trainMembers([[42, H]]))]);
    expectProved(h.run(`${GH_STUB} cmd_pr_state --project demo --pr 42`).stdout);
  });
});
