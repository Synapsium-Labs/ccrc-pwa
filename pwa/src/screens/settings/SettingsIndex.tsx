// Settings' index (settings spec §3.2, D-5503): five rows, one per section, each with its icon, its name, its purpose
// line (the phone index) and its measured status line (`sectionStatus.ts`), a link to `/settings/<id>`.
//
// THE ONE INDEX. Refined's phone page and narrow pane render it now (R2b1); Refined's desktop nav (R2c) and
// Instrument's list column (R3a) render this same component, so a section's name, status and order are said once.
// It reads only the frame's view (`SettingsDataProvider`) and this device's own choices; it imports no read.
//
// Each row is the door of its "Go to Settings › …" command (`commandDoor`, D-5469), so the row and the palette can
// never disagree about where a section is. The link keeps a real `href` for a new tab and a screen reader.
import { useEffect } from 'react';
import type { MouseEvent, ReactNode } from 'react';
import { AUTO, Icon, SKINS, SYSTEM, THEMES, Skeleton, cn, useNow, type IconName } from '@ccrc/ui';
import { commandDoor } from '../../command/door';
import { SETTINGS_INDEX_TEXT } from '../../fleet/settingsText';
import { SETTINGS_SECTIONS, type SettingsSectionId } from '../../lib/routes';
import { useSkinChoice } from '../../lib/skin';
import { useThemeChoice } from '../../lib/theme';
import type { SettingsView } from './SettingsDataProvider';
import { sectionStatus, type StatusTone } from './sectionStatus';
import './settings.css';

export const SECTION_ICON: Readonly<Record<SettingsSectionId, IconName>> = {
  updates: 'refresh-cw',
  appearance: 'palette',
  notifications: 'bell',
  automation: 'bot',
  security: 'shield',
};

/** A status line's ink, from the measured token pairs on the page's ground. */
const TONE_CLASS: Readonly<Record<StatusTone, string>> = {
  calm: 'text-ink-secondary',
  attention: 'text-phosphor',
  amber: 'text-status-attention-text',
  red: 'text-status-dead-text',
};

/** The row the page came back from, so Back returns focus to it (`SettingsFrame`). */
export function indexRowOf(id: SettingsSectionId): HTMLElement | null {
  return document.querySelector<HTMLElement>(`.settings-index-row[data-section="${id}"]`);
}

export function SettingsIndex({ view, current = null }: {
  view: SettingsView | null; current?: SettingsSectionId | null;
}): ReactNode {
  // The CHOICE, as the Layout picker shows it (`SkinFieldset`), never the resolved skin: `useSkin` is app.tsx's alone.
  const skinChoice = useSkinChoice();
  const skin = skinChoice === AUTO ? 'Matches this device' : (SKINS.find((s) => s.id === skinChoice)?.label ?? skinChoice);
  const choice = useThemeChoice();
  const theme = choice === SYSTEM ? null : (THEMES.find((t) => t.id === choice)?.label ?? choice);
  const now = useNow(30_000);
  // The push state again whenever the index mounts, so a toggle on the Notifications page shows here after Back.
  const reread = view?.rereadPush;
  useEffect(() => { reread?.(); }, [reread]);

  return (
    <nav aria-label={SETTINGS_INDEX_TEXT.navLabel} className="settings-index">
      {SETTINGS_SECTIONS.map((s) => {
        const door = commandDoor(`go-settings-${s.id}`);
        const status = view === null ? { kind: 'skeleton' as const }
          : sectionStatus(s.id, view, { skin, theme, hostname: location.hostname, now });
        return (
          <a
            key={s.id}
            href={`/settings/${s.id}`}
            data-section={s.id}
            data-command={door['data-command']}
            aria-current={current === s.id ? 'page' : undefined}
            title={SETTINGS_INDEX_TEXT.purpose[s.id]}
            className="settings-index-row text-ink-primary no-underline"
            onClick={(e: MouseEvent<HTMLAnchorElement>) => {
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;   // a new tab or window keeps the href
              e.preventDefault();
              door.onClick();
            }}
          >
            <Icon name={SECTION_ICON[s.id]} size={20} className="settings-index-icon text-ink-secondary" />
            <span className="settings-index-text">
              <span className="settings-index-name font-medium">{s.title}</span>
              <span className="settings-index-purpose text-meta text-ink-secondary">{SETTINGS_INDEX_TEXT.purpose[s.id]}</span>
              {status.kind === 'skeleton' ? (
                <Skeleton lines={1} />
              ) : (
                <span className={cn('settings-index-status text-meta', TONE_CLASS[status.tone])} data-tone={status.tone}>
                  {status.text}
                </span>
              )}
            </span>
            <Icon name="chevron-right" size={16} className="settings-index-chevron text-ink-tertiary" />
          </a>
        );
      })}
    </nav>
  );
}
