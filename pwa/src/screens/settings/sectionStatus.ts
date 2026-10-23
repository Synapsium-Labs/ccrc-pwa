// Each Settings section's status line and tone (settings spec §3.2, D-5503), from the one `SettingsView`. Pure.
//
// MEASURED, NEVER OPTIMISTIC. A read that has not landed is a skeleton and a failed one says "could not be read";
// neither is folded into a status. Updates leads with "vX available · fleet runs vY" exactly when `bannerRelease`
// names a tag, the predicate (fleet/releaseWaiting.ts) the fleet's update line and BuildLine use, so the three never
// disagree. Automation's pause part is a skeleton until the first coord frame, never "runs normally". Notifications
// says "not available" where push is unsupported, never "off". Security is red only when `unarmedExposure`.
import type { NodeWire, NotifyMode, UpdatesView } from '../../../../shared/api';
import { AUTO_MODES, FLEET_SCOPE, STALL_FOLLOW_LABEL, STALL_LEVEL_TEXT } from '../../../../shared/api';
import { COLLECT_STATE_TEXT } from '../../fleet/collectLaneWords';
import { releaseWaitingWords } from '../../fleet/releaseWaiting';
import { haltingNodes } from '../../fleet/updateHalt';
import { readBoxTokenView } from '../../lib/api';
import type { SettingsSectionId } from '../../lib/routes';
import type { PushState, SettingsView } from './SettingsDataProvider';
import { boxTokenSummary } from './SecuritySection';
import { unarmedExposure } from './signInGate';
import { AUTO_LABELS, CHANNEL_SENTENCES } from './UpdatesSection';

/** `attention` is a release waiting (the word and `↑`); amber and red are the page's own warn tones. */
export type StatusTone = 'calm' | 'attention' | 'amber' | 'red';
export type SectionStatus = { kind: 'skeleton' } | { kind: 'line'; text: string; tone: StatusTone };

/** What the Appearance line reads: this device's choices, which are not network reads. */
export interface AppearanceFacts { skin: string; theme: string | null }

export const UNREAD_STATUS = 'could not be read';

const line = (text: string, tone: StatusTone = 'calm'): SectionStatus => ({ kind: 'line', text, tone });
const SKELETON: SectionStatus = { kind: 'skeleton' };

/** A node's running version: its stamp's release tag, else its short sha. */
function versionOf(n: NodeWire): string | null {
  const c = n.current;
  if (c === null || typeof c !== 'object') return null;
  if (typeof c.version === 'string' && c.version !== '') return c.version;
  return typeof c.sha === 'string' && c.sha !== '' ? c.sha.slice(0, 7) : null;
}

/** "v0.4.21", or "Nodes run v0.4.20 to v0.4.21" when they differ; null when no node reports one. */
function fleetRuns(nodes: readonly NodeWire[]): { one: string } | { range: string } | null {
  const versions = [...new Set(nodes.map(versionOf).filter((v): v is string => v !== null))]
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (versions.length === 0) return null;
  if (versions.length === 1) return { one: versions[0]! };
  return { range: `${versions[0]} to ${versions[versions.length - 1]}` };
}

function updatesStatus(view: UpdatesView): SectionStatus {
  const nodes = Array.isArray(view.nodes) ? view.nodes : [];
  const runs = fleetRuns(nodes);
  const waiting = releaseWaitingWords(view);
  if (waiting !== null) {
    const fleet = runs === null ? '' : 'one' in runs ? ` · fleet runs ${runs.one}` : ` · nodes run ${runs.range}`;
    return line(`${waiting}${fleet}`, 'attention');
  }
  const amber = haltingNodes(nodes).length > 0 || view.catalogue.lastError !== null || nodes.some((n) => n.reachable === false);
  if (runs !== null && 'range' in runs) return line(`Nodes run ${runs.range}`, amber ? 'amber' : 'calm');
  const intent = view.intent.find((i) => i.scope === FLEET_SCOPE) ?? null;
  const parts = [runs === null ? 'No node reports a version' : runs.one];
  if (intent !== null) {
    if (intent.channel !== null) parts.push(CHANNEL_SENTENCES[intent.channel]);
    if ((AUTO_MODES as readonly string[]).includes(intent.auto)) parts.push(`Auto-install ${AUTO_LABELS[intent.auto].toLowerCase()}`);
  }
  return line(parts.join(' · '), amber ? 'amber' : 'calm');
}

const NOTIFY_SHORT: Record<NotifyMode, string> = { channel: "the fleet's channel", stable: 'stable only', off: 'none' };

const PUSH_WORDS: Record<Exclude<PushState, 'pending'>, string> = {
  on: 'Pushes on in this browser',
  off: 'Pushes off in this browser',
  blocked: 'Pushes blocked in this browser',
  unsupported: 'Pushes not available in this browser',
  failed: `Pushes ${UNREAD_STATUS}`,
};

function notificationsStatus(view: SettingsView): SectionStatus {
  if (view.push === 'pending') return SKELETON;
  const parts = [PUSH_WORDS[view.push]];
  const fleet = view.updates.view?.intent.find((i) => i.scope === FLEET_SCOPE) ?? null;
  if (fleet !== null && fleet.notify in NOTIFY_SHORT) parts.push(`Releases: ${NOTIFY_SHORT[fleet.notify]}`);
  return line(parts.join(' · '));
}

function automationStatus(view: SettingsView): SectionStatus {
  if (view.pause.kind === 'pending') return SKELETON;
  if (view.pause.marker === 'set') return line('Cleanup paused', 'amber');
  const { stall, collect } = view;
  if (stall.view === null && stall.failure === null) return SKELETON;
  if (collect.view === null && collect.failure === null) return SKELETON;
  const level = stall.view === null ? UNREAD_STATUS
    : stall.view.chosen.level === 'follow' ? STALL_FOLLOW_LABEL
      : stall.view.chosen.level === 'unreadable' ? UNREAD_STATUS
        : STALL_LEVEL_TEXT[stall.view.chosen.level].label;
  const state = collect.view?.effective.state ?? null;
  const collector = state === null ? UNREAD_STATUS : COLLECT_STATE_TEXT[state].label;
  return line(`Stall watch: ${level} · Collector: ${collector}`, state === 'safety-stopped' ? 'amber' : 'calm');
}

function securityStatus(view: SettingsView, hostname: string, now: number): SectionStatus {
  if (view.auth.kind === 'pending') return SKELETON;
  if (view.auth.kind === 'failed') return line(`Sign-in ${UNREAD_STATUS}`, 'amber');
  const status = view.auth.status;
  let tone: StatusTone = 'calm';
  let gate: string;
  if (unarmedExposure(status, hostname)) {
    gate = 'Sign-in off: reachable from other machines';
    tone = 'red';
  } else if (status.mode === 'off') {
    gate = 'Sign-in off: reachable from this machine only';
  } else if (status.mode === 'locked-out') {
    gate = 'Sign-in locked: too many failed attempts, try again shortly';
    tone = 'amber';
  } else if (status.mode === 'passphrase') {
    const n = typeof status.passkeysEnrolled === 'number' ? status.passkeysEnrolled : null;
    gate = n === null ? 'Sign-in on' : `Sign-in on · ${n} passkey${n === 1 ? '' : 's'}`;
  } else {
    gate = `Sign-in ${UNREAD_STATUS}`;
    tone = 'amber';
  }
  const parts = [gate];
  const raw = view.updates.view?.boxToken;
  if (view.updates.view !== null && raw !== undefined) {
    const token = readBoxTokenView(raw);
    if (token === null) {
      parts.push(`Box token ${UNREAD_STATUS}`);
      if (tone === 'calm') tone = 'amber';
    } else {
      const summary = boxTokenSummary(token, now);
      parts.push(`Box token: ${summary.text}`);
      if (summary.tone !== 'calm' && tone === 'calm') tone = 'amber';
    }
  }
  return line(parts.join(' · '), tone);
}

/** The status of section `id`, from the one view. */
export function sectionStatus(
  id: SettingsSectionId, view: SettingsView, facts: AppearanceFacts & { hostname: string; now: number },
): SectionStatus {
  switch (id) {
    case 'updates': {
      const u = view.updates;
      if (u.view !== null) return updatesStatus(u.view);
      if (u.failure === 'not-configured') return line('Not set up on this server');
      return u.failure === null ? SKELETON : line(UNREAD_STATUS, 'amber');
    }
    case 'appearance':
      return line(`${facts.skin} · ${facts.theme ?? 'Follows the system'}`);
    case 'notifications':
      return notificationsStatus(view);
    case 'automation':
      return automationStatus(view);
    case 'security':
      return securityStatus(view, facts.hostname, facts.now);
  }
}
