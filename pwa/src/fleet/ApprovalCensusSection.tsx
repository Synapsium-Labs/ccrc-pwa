// Approvals plan 2026-11-18 §3.1 (M38): Settings › Security › Permission prompts (M38), after Approvals. Read only: the
// census read's counter (prompts that reached the operator, per programme-day) and the paths they took. Its words are
// `lib/approvalCensusWords`. A failed read says "unmeasured" and never a 0; a window with nothing reaching the operator
// says so in a sentence of its own.
import { useState, type ReactNode } from 'react';
import { Section, Skeleton } from '@ccrc/ui';
import type { ApprovalCensusWire } from '../../../shared/approval-census';
import { api } from '../lib/api';
import { usePoll } from '../lib/usePoll';
import {
  APPROVAL_CENSUS_TEXT, asApprovalCensus, m38Figure, m38NoneSentence, m38Sentence, operatorPathLines, readPromptsLine,
} from '../lib/approvalCensusWords';
import { SETTINGS_AMBER_NOTE, SETTINGS_CARDS, SETTINGS_NOW_CLASS } from './settingsText';

/** The read's cadence: 5 minutes; the counter moves by the day. */
const CENSUS_POLL_MS = 300_000;

type Read = { census: ApprovalCensusWire | null; failed: boolean };

export function ApprovalCensusSection({ pollMs = CENSUS_POLL_MS }: { pollMs?: number }): ReactNode {
  const [read, setRead] = useState<Read | null>(null);
  usePoll({
    pollMs,
    request: (signal) => api.getApprovalCensus(undefined, { signal }),
    onOutcome: (outcome) => {
      const census = outcome.ok ? asApprovalCensus(outcome.raw) : null;
      // A failed poll keeps the last good answer beside the failure.
      setRead((prev) => (census !== null ? { census, failed: false } : { census: prev?.census ?? null, failed: true }));
    },
  });
  const card = SETTINGS_CARDS.security.approvalCensus;
  return (
    <Section level={3} scope={card.scope} title={card.title} purpose={card.purpose}>
      {read === null ? <Skeleton lines={2} /> : read.census === null ? (
        <>
          <p className={SETTINGS_NOW_CLASS.warn}>{APPROVAL_CENSUS_TEXT.unmeasured}</p>
          <p className={SETTINGS_NOW_CLASS.note}>{APPROVAL_CENSUS_TEXT.unmeasuredNote}</p>
        </>
      ) : (
        <CensusBody census={read.census} stale={read.failed} />
      )}
    </Section>
  );
}

function CensusBody({ census, stale }: { census: ApprovalCensusWire; stale: boolean }): ReactNode {
  const figure = m38Figure(census);
  const lines = operatorPathLines(census);
  return (
    <>
      {stale && <p className={SETTINGS_AMBER_NOTE}>{APPROVAL_CENSUS_TEXT.staleNote}</p>}
      {figure !== null ? (
        <>
          <p className={SETTINGS_NOW_CLASS.head}>{figure}</p>
          <p className={SETTINGS_NOW_CLASS.note}>{m38Sentence(census.days)}</p>
        </>
      ) : (
        <p className={SETTINGS_NOW_CLASS.note}>{m38NoneSentence(census.days)}</p>
      )}
      {lines.length > 0 && (
        <ul data-census-paths="" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--sp-1)' }}>
          {lines.map((l) => (
            <li key={l.path} data-census-path={l.path} className={SETTINGS_NOW_CLASS.note}>{`${l.label}: ${l.count}`}</li>
          ))}
        </ul>
      )}
      <p className={SETTINGS_NOW_CLASS.note}>{readPromptsLine(census.readPrompts)}</p>
      <p className={SETTINGS_NOW_CLASS.note}>{APPROVAL_CENSUS_TEXT.baseline}</p>
    </>
  );
}
