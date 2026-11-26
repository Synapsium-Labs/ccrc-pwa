// The readiness and ladder word tables (Overlord W1 home B, Task 4): a table is not a decision, so each gets a TOTALITY test over
// its vocabulary instead of a mutant set (plan Global Constraints, "Mutation floors"). A word with no row is a compile error in the
// `Record`, and these tests hold that the rows are also real: non-empty, distinct where they must be, and keyed by exactly the
// vocabulary the server's wire uses. The pure deciders over them are pinned here too.
import { describe, expect, it } from 'vitest';
import {
  LADDER_CAUSES, CONDITION_READINGS, NARROWING_WHYS, RUNGS, type LadderWire,
} from '../../shared/overlord-ladder';
import { READINESS_WORDS, STRAND_CAUSE_MAP, type ReadinessWire } from '../../shared/overlord-readiness';
import {
  causeWords, conditionReadingWords, effectWords, ladderCauseWords, rungControlOf, rungMovesUp, takingEffectLine, takingEffectWords,
} from '../src/overlord/ladderWords';
import {
  QUESTIONS_GO_YOU, clockOf, questionsGoWords, readinessLines, readinessOneLine, readinessViewOf, readinessWords,
} from '../src/overlord/readinessWords';
import type { ReadState } from '../src/overlord/readState';

const NOW = 1_700_000_000_000;
const wire = (over: Partial<ReadinessWire> = {}): ReadinessWire => ({
  word: 'ready', since: NOW - 60_000, why: null, until: null, questionsGo: 'operator', restartable: false, strandCause: null, ...over,
});

describe('readinessWords is total over the readiness words', () => {
  it('has exactly one row per word, each with a sentence and a tone', () => {
    expect(Object.keys(readinessWords).sort()).toEqual([...READINESS_WORDS].sort());
    for (const w of READINESS_WORDS) {
      expect(readinessWords[w].sentence.length, w).toBeGreaterThan(8);
      expect(['ok', 'quiet', 'attention', 'dead'], w).toContain(readinessWords[w].tone);
    }
  });
  it('two words never share a sentence, so the operator can tell them apart', () => {
    const sentences = READINESS_WORDS.map((w) => readinessWords[w].sentence);
    expect(new Set(sentences).size).toBe(sentences.length);
  });
  it('only ready is ok, and only the two words that cannot run, dead and stranded, are dead', () => {
    expect(READINESS_WORDS.filter((w) => readinessWords[w].tone === 'ok')).toEqual(['ready']);
    expect(READINESS_WORDS.filter((w) => readinessWords[w].tone === 'dead').sort()).toEqual(['dead', 'stranded']);
  });
});

describe('ladderWords is total over the ladder vocabulary', () => {
  it('has a sentence for every cause of the table, and no other key', () => {
    expect(Object.keys(ladderCauseWords).sort()).toEqual([...LADDER_CAUSES].sort());
    for (const c of LADDER_CAUSES) expect(ladderCauseWords[c].length, c).toBeGreaterThan(8);
  });
  it('has a word for every condition reading', () => {
    expect(Object.keys(conditionReadingWords).sort()).toEqual([...CONDITION_READINGS].sort());
  });
  it('has a taking-effect sentence for every narrowing why, in the plan\'s words', () => {
    expect(Object.keys(takingEffectWords).sort()).toEqual([...NARROWING_WHYS].sort());
    expect(takingEffectWords['no-witness-yet']).toBe('Taking effect: no witness has held it yet');
    expect(takingEffectWords['witness-unmeasured']).toBe('Taking effect: the witness could not be measured');
    expect(takingEffectWords['not-journalled']).toBe('Taking effect: not recorded in the journal yet');
  });
  it('draws a cause this build does not know by its key', () => {
    expect(causeWords('invariant-violation')).toEqual({ text: ladderCauseWords['invariant-violation'], known: true });
    expect(causeWords('a-newer-cause')).toEqual({ text: 'a-newer-cause', known: false });
    expect(causeWords('constructor')).toEqual({ text: 'constructor', known: false });
  });
});

describe('readinessLines', () => {
  it('a known word carries its row\'s sentence and tone', () => {
    const l = readinessLines(wire({ word: 'degraded' }), NOW);
    expect(l.known).toBe(true);
    expect(l.word).toBe('degraded');
    expect(l.sentence).toBe(readinessWords.degraded.sentence);
    expect(l.tone).toBe(readinessWords.degraded.tone);
  });
  it('a word the console does not know is drawn raw, with "unknown word"', () => {
    const l = readinessLines(wire({ word: 'hovering' as never }), NOW);
    expect(l.known).toBe(false);
    expect(l.word).toBe('hovering');
    expect(l.sentence).toBe('unknown word');
  });
  it('questionsGo is drawn from the field, never decided from the word', () => {
    expect(readinessLines(wire({ word: 'ready' }), NOW).questions).toBe(QUESTIONS_GO_YOU);
    expect(readinessLines(wire({ word: 'off' }), NOW).questions).toBe(QUESTIONS_GO_YOU);
    // W3's value, on a word that W1 never pairs with it: the field wins over the word.
    expect(readinessLines(wire({ word: 'off', questionsGo: 'overlord' as never }), NOW).questions).toBe('Questions go to: overlord');
    expect(questionsGoWords('operator')).toBe(QUESTIONS_GO_YOU);
  });
  it('until is the time left for renewing and restarting, and nothing for the other words', () => {
    expect(readinessLines(wire({ word: 'renewing', until: NOW + 5 * 60_000 }), NOW).timeLeft).toBe('5 min left');
    expect(readinessLines(wire({ word: 'restarting', until: NOW + 20_000 }), NOW).timeLeft).toBe('under a minute left');
    expect(readinessLines(wire({ word: 'restarting', until: NOW - 1 }), NOW).timeLeft).toBe('due now');
    expect(readinessLines(wire({ word: 'ready', until: NOW + 5 * 60_000 }), NOW).timeLeft).toBeNull();
    expect(readinessLines(wire({ word: 'renewing', until: null }), NOW).timeLeft).toBeNull();
  });
  it('why is for unmeasured and dead only', () => {
    expect(readinessLines(wire({ word: 'unmeasured', why: 'registry' }), NOW).why).toBe('registry');
    expect(readinessLines(wire({ word: 'dead', why: 'third restart in the hour' }), NOW).why).toBe('third restart in the hour');
    expect(readinessLines(wire({ word: 'ready', why: 'registry' }), NOW).why).toBeNull();
    expect(readinessLines(wire({ word: 'unmeasured', why: null }), NOW).why).toBeNull();
  });
  it('a stranded word names its cause in the cause\'s sentence, and a cause this build lacks is drawn raw', () => {
    expect(readinessLines(wire({ word: 'stranded', strandCause: 'limited' }), NOW).strand).toBe(STRAND_CAUSE_MAP.limited);
    expect(readinessLines(wire({ word: 'stranded', strandCause: 'brand-new' as never }), NOW).strand).toBe('brand-new');
    expect(readinessLines(wire({ word: 'stranded', strandCause: null }), NOW).strand).toBeNull();
    expect(readinessLines(wire({ word: 'ready', strandCause: 'limited' }), NOW).strand).toBeNull();
  });
  it('since is a clock the viewer reads, and an instant Date cannot place reads as a dash', () => {
    expect(clockOf(NOW)).toMatch(/^\d\d:\d\d$/);
    expect(clockOf(1e20)).toBe('—');
    expect(readinessLines(wire({ since: NOW }), NOW).since).toBe(clockOf(NOW));
  });
});

describe('readinessViewOf and the one-line form', () => {
  const answered = (w: ReadinessWire): ReadState<ReadinessWire> => ({ state: 'answered', value: w, at: NOW });
  it('loading says nothing yet; unmeasured says unmeasured with its error; absent is its own view', () => {
    expect(readinessViewOf({ state: 'loading' }, NOW)).toEqual({ kind: 'loading' });
    expect(readinessViewOf({ state: 'unmeasured', error: 'HTTP 503' }, NOW)).toEqual({ kind: 'unmeasured', error: 'HTTP 503' });
    expect(readinessViewOf({ state: 'absent' }, NOW)).toEqual({ kind: 'absent' });
  });
  it('a stale read keeps its last answer and says when it was read', () => {
    const v = readinessViewOf({ state: 'stale', value: wire(), at: NOW, error: 'timeout' }, NOW + 1);
    expect(v.kind).toBe('answered');
    expect(v.kind === 'answered' && v.lastRead).toBe(`last read ${clockOf(NOW)}`);
    const fresh = readinessViewOf(answered(wire()), NOW);
    expect(fresh.kind === 'answered' && fresh.lastRead).toBeNull();
  });
  it('the line is null while loading, absent, or the word is absent; and says unmeasured when the read failed', () => {
    expect(readinessOneLine(readinessViewOf({ state: 'loading' }, NOW))).toBeNull();
    expect(readinessOneLine(readinessViewOf({ state: 'absent' }, NOW))).toBeNull();
    expect(readinessOneLine(readinessViewOf(answered(wire({ word: 'absent', since: 0 })), NOW))).toBeNull();
    expect(readinessOneLine(readinessViewOf({ state: 'unmeasured', error: 'HTTP 503' }, NOW))).toMatch(/unmeasured/);
    const line = readinessOneLine(readinessViewOf(answered(wire({ word: 'ready' })), NOW));
    expect(line).toContain(readinessWords.ready.sentence);
    expect(line).toContain(QUESTIONS_GO_YOU);
    expect(readinessOneLine(readinessViewOf(answered(wire({ word: 'hovering' as never })), NOW))).toMatch(/^hovering \(unknown word\) · since /);
  });
});

describe('the ladder deciders', () => {
  it('rungMovesUp: a rung above the current one is a raise, and an equal or lower one is not', () => {
    expect(rungMovesUp('off', 'chat')).toBe(true);
    expect(rungMovesUp('chat', 'advise')).toBe(true);
    expect(rungMovesUp('chat', 'off')).toBe(false);
    expect(rungMovesUp('full', 'chat')).toBe(false);
    expect(rungMovesUp('chat', 'chat')).toBe(false);
    for (const r of RUNGS) expect(rungMovesUp(r, r)).toBe(false);
  });
  it('a rung or a current rung this build does not know is treated as a raise: it is sent through the step-up', () => {
    expect(rungMovesUp('chat', 'superfull')).toBe(true);
    expect(rungMovesUp('superfull', 'chat')).toBe(true);
  });
  it('rungControlOf: disabled while not available or already the rung, and says what it needs', () => {
    expect(rungControlOf({ rung: 'off', available: true, needs: null }, 'chat'))
      .toMatchObject({ rung: 'off', label: 'Off', disabled: false, current: false, needs: null });
    expect(rungControlOf({ rung: 'chat', available: true, needs: null }, 'chat')).toMatchObject({ disabled: true, current: true });
    expect(rungControlOf({ rung: 'advise', available: false, needs: 'overlord-route-v1' }, 'chat'))
      .toMatchObject({ disabled: true, current: false, needs: 'Needs overlord-route-v1' });
    expect(rungControlOf({ rung: 'advise', available: true, needs: 'overlord-route-v1' }, 'chat'))
      .toMatchObject({ disabled: false, needs: null });
  });
  it('effectWords names each effect kind', () => {
    expect(effectWords({ kind: 'cap', cap: 'chat' })).toBe('caps the rung at chat');
    expect(effectWords({ kind: 'one-under-operator', floor: 'chat' })).toBe('holds the rung one under yours, never below chat');
    expect(effectWords({ kind: 'read-by', reader: 'launch-profile-unmet' })).toContain('launch-profile-unmet');
    expect(effectWords({ kind: 'server-words' })).toBe('limits the rung to what the server advertises');
    expect(effectWords({ kind: 'newer-kind' } as never)).toBe('newer-kind');
  });
});

describe('takingEffectLine', () => {
  const ladder = (narrowing: unknown): ReadState<LadderWire> => ({
    state: 'answered', at: NOW,
    value: { ok: true, operatorRung: 'off', lastChange: narrowing === undefined ? null : { at: NOW, actor: 'operator', narrowing } } as unknown as LadderWire,
  });
  const TAKING = { state: 'taking-effect', why: 'no-witness-yet' } as const;
  it('is null unless a narrowing door answered a narrowing', () => {
    expect(takingEffectLine(null, ladder(TAKING))).toBeNull();
    expect(takingEffectLine(undefined, ladder(TAKING))).toBeNull();
  });
  it('reads the ladder\'s lastChange.narrowing while it says taking-effect, one sentence per why', () => {
    for (const why of NARROWING_WHYS) {
      expect(takingEffectLine(TAKING, ladder({ state: 'taking-effect', why }))).toBe(takingEffectWords[why]);
    }
  });
  it('is null once the ladder reads done', () => {
    expect(takingEffectLine(TAKING, ladder({ state: 'done' }))).toBeNull();
  });
  it('falls back to the door\'s own narrowing before the ladder has a reading of the change', () => {
    expect(takingEffectLine(TAKING, { state: 'loading' })).toBe(takingEffectWords['no-witness-yet']);
    expect(takingEffectLine(TAKING, ladder(null))).toBe(takingEffectWords['no-witness-yet']);
    expect(takingEffectLine({ state: 'done' }, { state: 'loading' })).toBeNull();
  });
  it('a stale ladder read still carries its last change', () => {
    const stale: ReadState<LadderWire> = { ...(ladder({ state: 'done' }) as { value: LadderWire; at: number }), state: 'stale', error: 'timeout' };
    expect(takingEffectLine(TAKING, stale)).toBeNull();
  });
});
