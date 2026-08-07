// The dormant handshake's one visible act (shared/api.ts's FLEET_PROTO_MIN).
// Mounted in app.tsx OUTSIDE `.app-shell` — a sibling before it, not a
// descendant — so it sits above every pane, sheet and toast rather than
// living inside one; there is no partial-functionality story for a wire
// protocol this build cannot speak. The fleet store already triggered the SW
// update check the moment it set `blocked` (stores/fleet.ts); Reload is the
// manual fallback for whenever that path is a no-op (dev, a registration
// that never resolved, or a check already in flight that just hasn't landed).
//
// Styles live in styles/shell.css (`.block-screen`), not a stylesheet of its
// own — the design gate's stylesheet list is discovered from disk and pinned
// exactly (pwa/test/contrast.test.ts), so a new file here is a test to update
// for no reason when app.tsx already owns shell.css and mounts this beside
// it. `.btn-primary` (primitives.css) is already in the bundle via ToastHost.
import type { ReactNode } from 'react';

export function BlockScreen(): ReactNode {
  return (
    <div className="block-screen" role="alert">
      <p className="block-screen-copy">This app build is too old for the fleet server. Updating…</p>
      <button type="button" className="btn-primary" onClick={() => location.reload()}>
        Reload
      </button>
    </div>
  );
}
