// AppBadge — mounts `useAppBadge` inside `FleetChromeProvider` (a hook call in `App`'s own body runs outside it, and
// `useNavBadges` throws there). Renders nothing.
import type { ReactNode } from 'react';
import { useAppBadge } from './useAppBadge';

export function AppBadge(): ReactNode {
  useAppBadge();
  return null;
}
