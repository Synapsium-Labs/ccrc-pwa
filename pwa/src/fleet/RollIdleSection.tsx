// Settings › Automation › Roll idle sessions (D-7453, the operator's rulings of 2026-10-29): one choice, Coordinators
// (the default, ON) or Off. There is no "all": a session that is not a coordinator is never rolled automatically and
// picks up a new release when it next starts. The card reads its own door (`GET /api/coord/roll-idle`) and writes it
// (`POST`); the answer is the line under the group (`useResultLine`), as every Settings write's is.
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { RadioFieldset, Section } from '@ccrc/ui';
import { CLAUDE_ROLL_TARGETS, isClaudeRollTargets, type ClaudeRollTargets } from '../../../shared/claudeVersion';
import { api, type RollIdleView } from '../lib/api';
import { ResultLine, SETTINGS_AMBER_NOTE, SETTINGS_CARDS, SETTINGS_WHEN, UNCONFIRMED_TEXT, useResultLine } from './settingsText';

/** The two choices in words; the wire's values do not change. */
export const ROLL_IDLE_LABELS: Record<ClaudeRollTargets, string> = {
  coordinators: 'Coordinators',
  off: 'Off',
};

export const ROLL_IDLE_TEXT = {
  legend: 'Roll idle sessions',
  when: 'Turn it off while you want every coordinator to keep its running process, for example during a long review. '
    + 'A coordinator you have opted out by hand (a no-roll marker on the fleet box) is never rolled.',
  unreadable: 'The server could not read this setting, so nothing is rolled until it can.',
  unavailable: 'This server does not offer the setting.',
} as const;

type Read = { kind: 'loading' } | { kind: 'view'; view: RollIdleView } | { kind: 'unavailable' };

export function RollIdleSection(): ReactNode {
  const [read, setRead] = useState<Read>({ kind: 'loading' });
  const [saving, setSaving] = useState(false);
  const result = useResultLine();
  const card = SETTINGS_CARDS.automation.roll;

  useEffect(() => {
    let live = true;
    api.rollIdle().then((view) => { if (live) setRead({ kind: 'view', view }); }, () => { if (live) setRead({ kind: 'unavailable' }); });
    return () => { live = false; };
  }, []);

  const choose = async (targets: ClaudeRollTargets): Promise<void> => {
    if (saving) return;
    result.clear();
    setSaving(true);
    try {
      const answer = await api.setRollIdle(targets);
      if (answer === 'unreadable' || !isClaudeRollTargets(answer.targets)) result.say(UNCONFIRMED_TEXT);
      else setRead({ kind: 'view', view: answer });
    } catch (err) {
      result.say(err instanceof Error ? err.message : String(err), 'refusal');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Section level={3} scope={card.scope} title={card.title} purpose={card.purpose}>
      {read.kind === 'unavailable' && <p className="settings-note">{ROLL_IDLE_TEXT.unavailable}</p>}
      {read.kind === 'view' && read.view.targets === null && <p className={SETTINGS_AMBER_NOTE}>{ROLL_IDLE_TEXT.unreadable}</p>}
      {read.kind !== 'unavailable' && (
        <RadioFieldset
          legend={ROLL_IDLE_TEXT.legend}
          name="settings-roll-idle"
          options={CLAUDE_ROLL_TARGETS.map((t) => ({ value: t, label: ROLL_IDLE_LABELS[t] }))}
          value={read.kind === 'view' ? read.view.targets : null}
          onPick={(t) => void choose(t)}
          disabled={saving || read.kind === 'loading'}
        />
      )}
      <ResultLine line={result.line} />
      <p className={SETTINGS_WHEN}>{ROLL_IDLE_TEXT.when}</p>
    </Section>
  );
}
