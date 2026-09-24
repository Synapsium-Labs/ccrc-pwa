// Settings screen (route `/settings`, centralised update management W3 —
// design 2026-09-20 §13). Two sections and no more — Updates (the channel,
// auto-install, *Check now*, the catalogue line, the release list, the node
// inventory) and Notifications (the bell, release notifications, the
// unarmed-exposure banner) — which Tasks 7–10 of the W3 plan add below the
// header. This task lands the shell alone, because the route's pin
// (app.test.tsx) needs the screen's own heading.
//
// The AccountsScreen skeleton, class for class (`.settings-screen/-head/-back/
// -title`, fleet.css): a back chevron that returns to the fleet, then the <h1>.
// It adds no scroll logic of its own — the D-161 pane reset in app.tsx puts
// `.shell-detail` back at the top on every route change, this one included.
import type { ReactNode } from 'react';
import { navigate } from '../lib/router';
import '../fleet/fleet.css';

export function SettingsScreen(): ReactNode {
  return (
    <div className="settings-screen">
      <header className="settings-head">
        <button type="button" className="settings-back" aria-label="Back to fleet" onClick={() => navigate('/')}>
          ‹
        </button>
        <h1 className="settings-title">Settings</h1>
      </header>
    </div>
  );
}
