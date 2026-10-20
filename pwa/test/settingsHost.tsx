// Mount Settings the way `app.tsx` does since settings Task R2b1 (D-5504): the frame under the one
// `SettingsDataProvider`, on the route of the page a case is about. `null` is the index (`/settings`); a section id
// is `/settings/<id>`. `toasts` mounts a `ToastHost` beside it, as the suites did before the move.
import { render, type RenderResult } from '@testing-library/react';
import { ToastHost } from '@ccrc/ui';
import { navigate } from '../src/lib/router';
import type { SettingsSectionId } from '../src/lib/routes';
import { SettingsDataProvider } from '../src/screens/settings/SettingsDataProvider';
import { SettingsScreen } from '../src/screens/settings/SettingsFrame';

export function renderSettings(section: SettingsSectionId | null, { toasts = false }: { toasts?: boolean } = {}): RenderResult {
  navigate(section === null ? '/settings' : `/settings/${section}`);
  return render(
    <>
      {toasts && <ToastHost />}
      <SettingsDataProvider active><SettingsScreen /></SettingsDataProvider>
    </>,
  );
}
