// PressureBanner (#1170): the fleet host's pressure as one line, "Fleet host thrashing · memory stalled 64% · io 8%".
// It renders the server's `psi` block (health poll, `FleetChrome`'s one) and nothing else: no poll of its own, no
// figure the server did not send. Renders nothing exactly when `pressureBannerShows` says so.
//
// Critical (and a stalled link the server read as host pressure) wears the dead tone, warn the attention amber, both
// on @ccrc/ui's `Banner`, the disk banner's shape: a status line with no action and no width of its own.
import type { ReactNode } from 'react';
import type { FleetHealth } from '../../../shared/api';
import { readHostPressure } from '../../../shared/pressure';
import { Banner } from '@ccrc/ui';
import { pressureBannerShows, pressureLine, pressureTone } from './pressureWords';

export function PressureBanner({ health }: { health: FleetHealth | null | undefined }): ReactNode {
  const p = readHostPressure(health ?? null);
  if (p === null || !pressureBannerShows(health)) return null;
  return <Banner tone={pressureTone(p) === 'critical' ? 'dead' : 'attention'}>{pressureLine(p)}</Banner>;
}
