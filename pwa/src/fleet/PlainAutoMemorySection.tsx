// Settings › Automation › Auto memory for plain sessions (Overlord W1a launch profiles PR B; spec §3.3.7 H14, Table 11.1d):
// one choice, Off (the default on a fleet host) or On, each with its note. The card reads its own door
// (`GET /api/coord/plain-auto-memory`) and writes it (`POST`); the answer is the line under the group (`useResultLine`), as
// every Settings write's is. Under the group, the sentence that it moves no session until the Launch profiles lane is live.
// Every word is L0's (`PLAIN_AUTO_MEMORY_TEXT`), but the not-available line, the Settings sections' one sentence.
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Section } from '@ccrc/ui';
import {
  PLAIN_AUTO_MEMORY_CHOICES, PLAIN_AUTO_MEMORY_TEXT as T, isPlainAutoMemoryChoice, type PlainAutoMemoryChoice,
  type PlainAutoMemoryView,
} from '../../../shared/plainAutoMemory';
import { api } from '../lib/api';
import { COLLECT_SECTION_TEXT } from './collectLaneWords';
import {
  NotedRadioSet, ResultLine, SETTINGS_AMBER_NOTE, SETTINGS_CARDS, SETTINGS_WHEN, UNCONFIRMED_TEXT, useResultLine,
} from './settingsText';

type Read = { kind: 'loading' } | { kind: 'view'; view: PlainAutoMemoryView } | { kind: 'unavailable' };

export function PlainAutoMemorySection(): ReactNode {
  const [read, setRead] = useState<Read>({ kind: 'loading' });
  const [saving, setSaving] = useState(false);
  const result = useResultLine();
  const card = SETTINGS_CARDS.automation.plainMemory;

  useEffect(() => {
    let live = true;
    api.plainAutoMemory().then((view) => { if (live) setRead({ kind: 'view', view }); }, () => { if (live) setRead({ kind: 'unavailable' }); });
    return () => { live = false; };
  }, []);

  const choose = async (choice: PlainAutoMemoryChoice): Promise<void> => {
    if (saving) return;
    result.clear();
    setSaving(true);
    try {
      const answer = await api.setPlainAutoMemory(choice);
      if (answer === 'unreadable' || !isPlainAutoMemoryChoice(answer.choice)) result.say(UNCONFIRMED_TEXT);
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
          {read.kind === 'view' && read.view.choice === null && <p className={SETTINGS_AMBER_NOTE}>{T.unread}</p>}
          <NotedRadioSet
            legend={T.legend}
            name="settings-plain-auto-memory"
            options={PLAIN_AUTO_MEMORY_CHOICES.map((c) => ({ value: c, label: T.choices[c], note: T.notes[c] }))}
            value={read.kind === 'view' ? read.view.choice : null}
            onPick={(c) => void choose(c)}
            disabled={saving || read.kind === 'loading'}
          />
        </>
      )}
      <ResultLine line={result.line} />
      <p className={SETTINGS_WHEN}>{T.shadow}</p>
    </Section>
  );
}
