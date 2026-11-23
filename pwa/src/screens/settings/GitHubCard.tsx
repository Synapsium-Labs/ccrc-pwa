// Settings › Integrations › GitHub (D-8932): a read-only card. It says what ccrc uses for GitHub
// today (the fleet box's own GitHub CLI sign-in; ccrc holds no key), what the readings the console already has say of
// that sign-in, and that a key stored here is coming. It has no control and makes no read: the section hands it the
// project list it reads for Project linking, whose visibility readings are GitHub calls the fleet box made. Every word,
// and the decision behind the status line, is `githubWords.ts`'s.
import type { ReactNode } from 'react';
import { Section, Skeleton, elapsedWords, useNow } from '@ccrc/ui';
import { GITHUB_TEXT, githubStatus } from '../../fleet/githubWords';
import { linkingRowsOf } from '../../fleet/linkingWords';
import { SETTINGS_AMBER_NOTE, SETTINGS_CARDS } from '../../fleet/settingsText';
import type { ProjectListRead } from './useProjectList';

export function GitHubCard({ list }: { list: ProjectListRead }): ReactNode {
  const card = SETTINGS_CARDS.integrations.github;
  const now = useNow(30_000);
  const status = githubStatus(
    list.kind === 'read' ? linkingRowsOf(list.rows).map((r) => r.linking.measured) : list.kind,
    (at) => elapsedWords(Math.max(0, now - at)),
  );
  return (
    <Section level={3} scope={card.scope} title={card.title} purpose={card.purpose} data-github="section">
      <p className="settings-note">{GITHUB_TEXT.uses}</p>
      {status.words === null
        ? <Skeleton lines={1} />
        : <p className={status.amber ? SETTINGS_AMBER_NOTE : 'settings-note'} data-github-state={status.state}>{status.words}</p>}
      <p className="settings-note">{GITHUB_TEXT.coming}</p>
    </Section>
  );
}
