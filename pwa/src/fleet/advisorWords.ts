// L1, context C3: the coordinator advisor's readout in words (plan 2026-11-23-coordinator-advisor PR D, spec §6). The ONE
// reader of `FleetSession.advisor`: the session header's fact and the Settings row's summary both ask it, so the two never
// say different things about one coordinator. Every word is L0's (`COORDINATOR_ADVISOR_TEXT`). Pure. Also the Settings
// row's one reader of its door's answer (`asCoordinatorAdvisorView`).
import {
  COORDINATOR_ADVISOR_TEXT as T, advisorScopeOf, isAdvisorCap, isAdvisorChoice,
  type CoordinatorAdvisorSetting, type CoordinatorAdvisorView, type FleetAdvisor,
} from '../../../shared/coordinatorAdvisor';

/** A setting off the wire, or null when it is not of the setting's shape. */
function settingOf(v: unknown): CoordinatorAdvisorSetting | null {
  const o = (v !== null && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const scope = advisorScopeOf(o['scope']);
  return isAdvisorChoice(o['choice']) && isAdvisorCap(o['cap']) && scope !== null ? { choice: o['choice'], cap: o['cap'], scope } : null;
}

/** `GET`/`POST /api/coord/coordinator-advisor`'s answer as the Settings row reads it: null when it has no readable
 *  `default` (an older server's answer, or a stub), so the row says it is not available and reads no field that is not
 *  there. A stored setting this build cannot read is `setting: null`, the row's unread line, as the server's own null is. */
export function asCoordinatorAdvisorView(v: unknown): CoordinatorAdvisorView | null {
  const o = (v !== null && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const def = settingOf(o['default']);
  if (def === null) return null;
  const n = (x: unknown, d: number): number => (typeof x === 'number' && Number.isFinite(x) ? x : d);
  const choices = Array.isArray(o['choices']) ? o['choices'].filter(isAdvisorChoice) : [];
  return { setting: settingOf(o['setting']), default: def, choices, capMin: n(o['capMin'], def.cap), capMax: n(o['capMax'], def.cap) };
}

const MODEL_WORD = { fable: 'Fable', opus: 'Opus' } as const;

/** Thousands as `12.3k`, the rest as is: the tokens line stays short. */
function tokensWord(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

export interface AdvisorLine {
  /** The fact's short text: `advisor Fable: live · 3/12 today`. */
  readonly text: string;
  /** Its title: the state's sentence, the overrun, the tokens and which act applies a change. */
  readonly title: string;
}

/** The readout of one session, or null when it has none (the advisor never touched it, or an older server). */
export function advisorLineOf(a: FleetAdvisor | undefined): AdvisorLine | null {
  if (a === undefined) return null;
  const model = a.model === null ? '' : ` ${MODEL_WORD[a.model]}`;
  const count = a.today === null ? 'calls unread' : `${a.today}/${a.cap} today`;
  const parts = [T.states[a.state]];
  if (a.overrun > 0) parts.push(`${a.overrun} over the cap before its restart`);
  if (a.tokens !== null) {
    parts.push(`advisor tokens today: ${tokensWord(a.tokens.input)} in, ${tokensWord(a.tokens.output)} out, `
      + `${tokensWord(a.tokens.cacheRead)} cache read, ${tokensWord(a.tokens.cacheWrite)} cache write`);
  }
  parts.push(T.applies[a.applies]);
  return { text: `advisor${model}: ${T.states[a.state].toLowerCase()} · ${count}`, title: parts.join('; ') };
}
