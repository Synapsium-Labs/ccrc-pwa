// DiskBanner (D-6617; spec 2026-10-23 fleet-disk-retention §2.5; plan Task DR-5): the fleet's disk alarm as one line,
// "Fleet disk 93% full · 41 GiB free · sweeps in pressure mode". It renders the server's `disk` block (health
// poll, `FleetChrome`'s one) and nothing else: no poll of its own, no figure the server did not send. Renders nothing at
// ok and unmeasured, exactly when `diskBannerShows` says so.
//
// `critical` wears the dead tone, `warn` the attention amber, both on @ccrc/ui's `Banner` (a status line, no
// action: there is no health-detail surface yet to open, so the sentence is the whole banner). It carries no width
// of its own, so it wraps inside the fleet column at 360 and sits on one line from a desk up; the browser leg
// (`browser/disk-banner.browser.test.ts`) measures that in both skins and both themes.
import type { ReactNode } from 'react';
import type { FleetHealth } from '../../../shared/api';
import { readDiskHealth } from '../../../shared/disk';
import { Banner } from '@ccrc/ui';
import { diskBannerShows, diskLine } from './diskWords';

export function DiskBanner({ health }: { health: FleetHealth | null | undefined }): ReactNode {
  const disk = readDiskHealth(health ?? null);
  if (disk === null || !diskBannerShows(health)) return null;
  return <Banner tone={disk.level === 'critical' ? 'dead' : 'attention'}>{diskLine(disk)}</Banner>;
}
