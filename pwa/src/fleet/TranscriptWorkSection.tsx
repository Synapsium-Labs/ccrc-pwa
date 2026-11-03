// Settings › Automation › Work in transcript folders (D-7898): one quiet line, "3 entries kept in transcript folders ·
// 41 MiB", and the largest entries the server names. It reads `disk.transcriptWork` from the shell's one health poll
// (`FleetChrome`), never an endpoint of its own, and offers no control: the count is a warning about where work sits,
// and nothing in ccrc deletes it. Long names wrap inside the card (`.transcript-work-top`), never push it sideways.
import type { ReactNode } from 'react';
import { Section } from '@ccrc/ui';
import { useChromeHealthIfMounted } from './FleetChrome';
import { transcriptWorkAlarm, transcriptWorkLine, transcriptWorkOf, transcriptWorkTop } from './transcriptWorkWords';
import { SETTINGS_AMBER_NOTE, SETTINGS_CARDS, SETTINGS_NOW_CLASS } from './settingsText';

export function TranscriptWorkSection(): ReactNode {
  const health = useChromeHealthIfMounted();
  const card = SETTINGS_CARDS.automation.transcripts;
  const tw = transcriptWorkOf(health);
  const top = transcriptWorkTop(tw);
  return (
    <Section level={3} scope={card.scope} title={card.title} purpose={card.purpose}>
      <p className={transcriptWorkAlarm(tw) ? SETTINGS_AMBER_NOTE : SETTINGS_NOW_CLASS.note} data-transcript-work-line="">
        {transcriptWorkLine(tw)}
      </p>
      {top.length > 0 && (
        <ul className="transcript-work-top" aria-label="Largest entries" data-transcript-work-top="">
          {top.map((t) => <li key={t} className={SETTINGS_NOW_CLASS.note}>{t}</li>)}
        </ul>
      )}
    </Section>
  );
}
