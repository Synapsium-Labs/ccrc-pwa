// Which platform this run is measuring, and the two vocabularies that follow
// from it.
//
// ccd and ccrc drive a service manager, and the two managers do not share a
// vocabulary: systemd has `enable --now`, `reset-failed`, `daemon-reload` and
// a unit file per name; launchd has `bootstrap`, `bootout`, `kickstart` and a
// plist per label. A test that asserts one manager's argv is asserting a
// PLATFORM PROPERTY, and the honest thing is to run it on that platform
// rather than to weaken it into something both can satisfy.
//
// SO THE RULE HERE: a describe whose subject is one manager's own behaviour
// is marked with `describeLinux` or `describeDarwin`, and the OTHER platform
// gets its own describe asserting the same OUTCOME in its own words. What is
// never done is deleting the assertion or loosening it to a regex that
// matches both — that would leave both platforms less covered than either was
// before macOS arrived.
import { describe, it } from 'vitest';

export const IS_DARWIN = process.platform === 'darwin';
export const IS_LINUX = process.platform === 'linux';

/** A describe whose subject is systemd's own behaviour. */
export const describeLinux = describe.skipIf(IS_DARWIN);
/** A describe whose subject is launchd's own behaviour. */
export const describeDarwin = describe.skipIf(!IS_DARWIN);

export const itLinux = it.skipIf(IS_DARWIN);
export const itDarwin = it.skipIf(!IS_DARWIN);

/** The service manager binary a fixture must stub on this platform. */
export const MANAGER_BIN = IS_DARWIN ? 'launchctl' : 'systemctl';

/** The directory this platform's manager reads job files from, relative to a
 *  fixture `$HOME`. Spelled here so a fixture that plants one does not have
 *  to know which platform it is on. */
export const UNIT_DIR_REL = IS_DARWIN ? 'Library/LaunchAgents' : '.config/systemd/user';

/** The on-disk file name for a unit, in this platform's spelling.
 *  `ccrc.service` -> `ccrc.service` on Linux, `app.ccrc.ccrc.plist` on macOS.
 *  Mirrors `_dr_unit_file` in ccd/ccrc-doctor-checks; `macos-platform.test.ts`
 *  pins the two against each other. */
export function unitFileName(unit: string): string {
  if (!IS_DARWIN) return unit;
  const base = unit.replace(/\.service$/, '');
  const label = base.startsWith('claude-session@')
    ? `app.ccrc.session.${base.slice('claude-session@'.length)}`
    : `app.ccrc.${base}`;
  return `${label}.plist`;
}

/** One manager call, in systemd's vocabulary, whatever this platform issued.
 *
 *  ONLY THE UNAMBIGUOUS VERBS ARE TRANSLATED, and that limit is the point.
 *  `disable --now` is `bootout` + `disable`, `enable --now` is `enable` +
 *  `bootstrap` + `kickstart`, and both map cleanly. `reset-failed` does NOT:
 *  on launchd it removes a stamp and issues no call at all, so a sequence
 *  containing it cannot be reconstructed from an argv log. A test asserting
 *  THAT sequence is asserting a systemd property and belongs behind
 *  `itLinux`, with a Darwin sibling of its own — normalising it here would
 *  have to invent an event that does not happen.
 *
 *  Lines that are not manager calls pass through untouched, so a harness that
 *  records tmux and stamps alongside them keeps them. */
export function asManagerCalls(lines: string[]): string[] {
  if (!IS_DARWIN) return lines;

  /** `<verb, label>` for a launchctl line, or null when it is not one. */
  const parse = (l: string): { verb: string; label: string } | null => {
    const m = /^launchctl (\S+)\s+(.*)$/.exec(l);
    if (!m) return null;
    const verb = m[1] ?? '';
    // `bootstrap` takes `<domain> <plist-path>`; every other verb takes
    // `<domain>/<label>`. The label is the last word either way, once its
    // directory and `.plist` are stripped.
    const target = (m[2] ?? '').trim().split(/\s+/).pop() ?? '';
    return { verb, label: target.replace(/\.plist$/, '').replace(/^.*\//, '') };
  };

  const unitOf = (label: string): string => (label.startsWith('app.ccrc.session.')
    ? `claude-session@${label.slice('app.ccrc.session.'.length)}`
    : `${label.replace(/^app\.ccrc\./, '')}.service`);

  const out: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const cur = parse(lines[i] ?? '');
    if (cur === null) { out.push(lines[i] ?? ''); continue; }
    const next = parse(lines[i + 1] ?? '');
    const sameLabel = next !== null && next.label === cur.label;
    const unit = unitOf(cur.label);

    // ONE INTENT PER LINE, and which intent a launchctl verb carries depends
    // on the verb BESIDE it — `_svc_stop` boots a job out and stops there,
    // while `_svc_disable_now` boots it out and then disables it. Reading each
    // line alone cannot tell `stop` from `disable --now`, which is why this
    // looks at its neighbour.
    if (cur.verb === 'bootout') {
      if (sameLabel && next.verb === 'disable') { out.push(`systemctl --user disable --now ${unit}`); i += 1; }
      else out.push(`systemctl --user stop ${unit}`);
      continue;
    }
    if (cur.verb === 'enable' && sameLabel && next.verb === 'bootstrap') {
      out.push(`systemctl --user enable --now ${unit}`);
      i += 1;                                     // the bootstrap
      if (parse(lines[i + 1] ?? '')?.verb === 'kickstart') i += 1;
      continue;
    }
    if (cur.verb === 'bootstrap') {
      out.push(`systemctl --user start ${unit}`);
      if (parse(lines[i + 1] ?? '')?.verb === 'kickstart') i += 1;
      continue;
    }
    if (cur.verb === 'kickstart') { out.push(`systemctl --user restart ${unit}`); continue; }
    // `enable`/`disable` on their own are boot-persistence only, and `print`
    // is a probe: neither is an intent a systemd argv assertion names.
  }
  return out;
}
