// Settings › Automation › When soft renewals happen (Overlord W1a hand-offs; Table 11.1d, R19): "When I'm away" (the default)
// or "On schedule", each with its note. The card reads its own door (`GET /api/coord/renewal-mode`) and writes it (`POST`);
// the answer is the line under the group (`useResultLine`), as every Settings write's is. The words are `RENEWAL_MODE_TEXT`.
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Section } from '@ccrc/ui';
import { RENEWAL_MODES, isRenewalMode, type RenewalMode, type RenewalModeView } from '../../../shared/continuity';
import { api } from '../lib/api';
import { COLLECT_SECTION_TEXT } from './collectLaneWords';
import {
  NotedRadioSet, RENEWAL_MODE_TEXT as T, ResultLine, SETTINGS_AMBER_NOTE, SETTINGS_CARDS, UNCONFIRMED_TEXT, useResultLine,
} from './settingsText';

type Read = { kind: 'loading' } | { kind: 'view'; view: RenewalModeView } | { kind: 'unavailable' };

export function RenewalModeSection(): ReactNode {
  const [read, setRead] = useState<Read>({ kind: 'loading' });
  const [saving, setSaving] = useState(false);
  const result = useResultLine();
  const card = SETTINGS_CARDS.automation.renewalMode;

  useEffect(() => {
    let live = true;
    // A field the answer does not carry is absent, never a crash: a mode this build cannot read is the unread note.
    api.renewalMode().then((view) => {
      if (live) setRead({ kind: 'view', view: { ...view, mode: isRenewalMode(view.mode) ? view.mode : null } });
    }, () => { if (live) setRead({ kind: 'unavailable' }); });
    return () => { live = false; };
  }, []);

  const choose = async (mode: RenewalMode): Promise<void> => {
    if (saving) return;
    result.clear();
    setSaving(true);
    try {
      const answer = await api.setRenewalMode(mode);
      if (answer === 'unreadable' || !isRenewalMode(answer.mode)) result.say(UNCONFIRMED_TEXT);
      else setRead({ kind: 'view', view: answer });
    } catch (err) {
      result.say(err instanceof Error ? err.message : String(err), 'refusal');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Section level={3} scope={card.scope} title={card.title} purpose={card.purpose}>
      {read.kind === 'unavailable' ? <p className="settings-note">{COLLECT_SECTION_TEXT.notAvailable}</p> : (
        <>
          {read.kind === 'view' && read.view.mode === null && <p className={SETTINGS_AMBER_NOTE}>{T.unread}</p>}
          <NotedRadioSet
            legend={T.legend}
            name="settings-renewal-mode"
            options={RENEWAL_MODES.map((m) => ({ value: m, label: T.choices[m], note: T.notes[m] }))}
            value={read.kind === 'view' ? read.view.mode : null}
            onPick={(m) => void choose(m)}
            disabled={saving || read.kind === 'loading'}
          />
        </>
      )}
      <ResultLine line={result.line} />
    </Section>
  );
}
