// One spelling of "how long has this been going on", because there were about
// to be two.
//
// `FleetHostBanner` wrote this arithmetic first, for "fleet host unreachable
// since 2h 10m ago". D-792's mail strip needs the same words in a different
// frame — "held at not-idle for 2h 10m" — and a second copy of a
// d/h/m ladder is exactly the drift `single-definition.test.ts` exists to
// stop: one of the two would eventually learn about seconds, or round
// differently, and the console would say two things about one duration.
//
// So the DURATION is shared and the SENTENCE is not. `elapsedWords` returns
// the bare span; each caller supplies its own preposition ("… ago", "for …"),
// because those are different claims about the same number and collapsing
// them is how a phrase ends up in a place it does not fit.

/** "2h 10m" / "5m" / "3d 4h" / "moments" — a span, never a sentence.
 *
 *  Coarse ON PURPOSE, at every scale: a duration this UI shows is being read
 *  at a glance to answer "is this normal", and `2h 10m 6s` answers it no
 *  better than `2h 10m` while being harder to compare against the row above.
 *  Under a minute it declines to guess at all — "moments" is honest about a
 *  number the viewer's own clock skew can move.
 *
 *  A negative span (a stamp in the future, which clock skew between the server
 *  and the viewer makes ordinary) clamps to zero rather than rendering a
 *  minus: "moments" is the truthful reading of "so recent my clock disagrees
 *  about the order". */
export function elapsedWords(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return h > 0 ? `${d}d ${h}h` : `${d}d`;
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  if (m > 0) return `${m}m`;
  return 'moments';
}
