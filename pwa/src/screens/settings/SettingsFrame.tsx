// Settings' frame (settings spec §4.1, §4.2's phone and narrow-pane rows; D-5504): `/settings` is the sections index
// and `/settings/<id>` is that section's page. Refined's phone and a Refined pane under 760 use it, and so, until
// R2c's desktop nav and R3a's master-detail, does every other width in both skins: the same pattern in the pane, the
// column capped at `--page-max`.
//
//   - `/settings`: `PageScaffold` (Back to the fleet, `❯`, "Settings"), the sign-in gate's banner if it shows, then
//     the five index rows.
//   - `/settings/<id>`: the gate's banner, then the section's page, led by its `<h2>`, with Back to the index.
// The banner (`SignInGateBanner`, settings Task R2b2) holds the same place in the tree in both, so moving between the
// index and a section keeps its node, and its `role="alert"` is announced once per mount of the frame.
//   - an unknown id (`settings-section`): the index, with "That section does not exist." above it. Nothing 404s.
//
// The `<h1>` is "Settings" on every route; `document.title` is "<Section> · Settings · ccrc". Opening a section moves
// focus to its `<h2>`; Back returns focus to the row it came from. Every read is the frame's one view
// (`SettingsDataProvider`, mounted in `app.tsx`); this file and the sections import none.
import { useEffect, useId, useLayoutEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { PageScaffold } from '@ccrc/ui';
import { SETTINGS_INDEX_TEXT } from '../../fleet/settingsText';
import { navigate, useLocation } from '../../lib/router';
import { matchRoute, SETTINGS_SECTIONS, type SettingsSectionId } from '../../lib/routes';
import { AppearanceSection } from './AppearanceSection';
import { AutomationSection } from './AutomationSection';
import { NotificationsSection } from './NotificationsSection';
import { SecuritySection } from './SecuritySection';
import { SignInGateBanner } from './SignInGateCard';
import { indexRowOf, SettingsIndex } from './SettingsIndex';
import { useSettingsView, type SettingsPageView } from './SettingsDataProvider';
import { UpdatesSection } from './UpdatesSection';
import './settings.css';

/** Where a path sits in Settings: the index, a section, or an id that names none. */
type At = { kind: 'index' } | { kind: 'section'; id: SettingsSectionId } | { kind: 'unknown' };

function settingsAt(path: string): At {
  const route = matchRoute(path)?.route.id ?? null;
  const section = SETTINGS_SECTIONS.find((s) => route === `settings-${s.id}`);
  if (section !== undefined) return { kind: 'section', id: section.id };
  return route === 'settings-section' ? { kind: 'unknown' } : { kind: 'index' };
}

/** A section's page body: today's cards, moved (R2b1), over the one view. */
function SectionBody({ id, view }: { id: SettingsSectionId; view: SettingsPageView }): ReactNode {
  switch (id) {
    case 'updates': return <UpdatesSection poll={view.updates} />;
    case 'appearance': return <AppearanceSection />;
    case 'notifications':
      return <NotificationsSection view={view.updates.view} reload={view.updates.reload} supported={view.push !== 'unsupported'} />;
    case 'automation': return <AutomationSection view={view} />;
    case 'security':
      return <SecuritySection poll={view.updates} auth={view.auth} passkeys={view.passkeys} refreshAuth={view.refreshAuth}
        linear={view.linear} />;
  }
}

export function SettingsScreen(): ReactNode {
  const { path } = useLocation();
  const at = settingsAt(path);
  const view = useSettingsView();
  const section = at.kind === 'section' ? SETTINGS_SECTIONS.find((s) => s.id === at.id)! : null;
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement | null>(null);
  // The section the page last showed, so Back can hand focus to its row.
  const from = useRef<SettingsSectionId | null>(null);

  useEffect(() => {
    const before = document.title;
    document.title = section === null ? 'Settings · ccrc' : `${section.title} · Settings · ccrc`;
    return () => { document.title = before; };
  }, [section]);

  // A layout effect: focus moves in the commit that drew the page, before the pane reset's paint (app.tsx, D-161).
  const sectionId = section?.id ?? null;
  useLayoutEffect(() => {
    if (sectionId !== null) {
      heading.current?.focus({ preventScroll: true });
    } else if (from.current !== null) {
      indexRowOf(from.current)?.focus({ preventScroll: true });
    }
    from.current = sectionId;
  }, [sectionId]);

  // The first child of the scaffold on every route, so React keeps one banner node across the index and the sections.
  const banner = view === null ? null : <SignInGateBanner auth={view.auth} onSecurity={sectionId === 'security'} />;
  if (section === null) {
    return (
      <PageScaffold
        title="Settings"
        back={{ label: 'Back to fleet', onClick: () => navigate('/'), className: 'settings-back' }}
      >
        {banner}
        {at.kind === 'unknown' && <p className="settings-note" role="status">{SETTINGS_INDEX_TEXT.notFound}</p>}
        <SettingsIndex view={view} />
      </PageScaffold>
    );
  }
  return (
    <PageScaffold
      title="Settings"
      back={{ label: 'Back to Settings', onClick: () => navigate('/settings'), className: 'settings-back settings-section-back' }}
    >
      {banner}
      <section className="settings-section settings-page" aria-labelledby={headingId}>
        <h2 id={headingId} ref={heading} tabIndex={-1} className="settings-page-title">{section.title}</h2>
        {view !== null && <SectionBody id={section.id} view={view} />}
      </section>
    </PageScaffold>
  );
}
