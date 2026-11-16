import type { ReactNode } from 'react';
import type { RosterWire } from '../../../shared/api';
import { COMPROMISE_LEAD, COMPROMISE_TITLE, compromiseSteps } from '../fleet/accountWords';

/** The roster facts the disclosure reads: each lane's provider and kind, absent when the roster does not say. */
export type CompromiseRoster = readonly Pick<RosterWire, 'provider' | 'kind'>[];

/** The steps for this roster, in the spec's order (§3.11): one per provider the roster holds, then the rebuilt box,
 *  which every fleet needs. Anthropic's step names tokens, sign-ins or both, by the kinds the roster holds; a lane whose
 *  kind the roster does not say could be either, so it names both. A lane with no provider (undeclared) names none. */
export function compromiseStepsFor(roster: CompromiseRoster): string[] {
  const anthropic = roster.filter((r) => r.provider === 'anthropic');
  const steps: string[] = [];
  if (anthropic.length > 0) {
    const unknown = anthropic.some((r) => r.kind === undefined);
    steps.push(compromiseSteps.anthropic(
      unknown || anthropic.some((r) => r.kind === 'token'),
      unknown || anthropic.some((r) => r.kind === 'sign-in'),
    ));
  }
  const codex = roster.some((r) => r.provider === 'openai');
  if (codex) steps.push(compromiseSteps.openai);
  if (roster.some((r) => r.provider === 'openrouter')) steps.push(compromiseSteps.openrouter);
  steps.push(compromiseSteps.rebuilt(codex));
  return steps;
}

/**
 * "IF THIS FLEET HOST IS EVER COMPROMISED" (spec §3.11; accounts plan Task A19, D-7742): one disclosure for every
 * provider, because a compromised box (or a leaked or restored snapshot of it) holds every lane's credential. Every
 * step is done from another device. It NAMES ONLY THE PROVIDERS PRESENT IN THE ROSTER, so a fleet with no OpenRouter
 * lane shows no OpenRouter step.
 *
 * It is shown in the token, Codex and OpenRouter sheets' result frames, and exported for Settings › Security to host
 * (the Settings plan's R5). Closed by default: a disclosure, not a warning.
 */
export function CompromiseSteps({ roster }: { roster: CompromiseRoster }): ReactNode {
  return (
    <details className="acct-compromise">
      <summary>{COMPROMISE_TITLE}</summary>
      <p className="acct-field-note">{COMPROMISE_LEAD}</p>
      <ol className="acct-compromise-steps">
        {compromiseStepsFor(roster).map((s) => <li key={s}>{s}</li>)}
      </ol>
    </details>
  );
}
