// Two shapes that are class strings and nothing else.
//
// Both were found by the shape census, and both share the same awkwardness:
// each is a handful of utilities that two or three app rules spelled
// identically, applied to an element that already exists for other reasons.
// A `<MonoPath>` component would wrap a `<span>` the call site already
// renders, and an `<AttentionDot>` cannot be a component at all — it is a
// `::before` on something else.
//
// So they are constants, which is the same answer `TEXT_INPUT_INLINE` got for
// the same question. The value of moving them here is not the line count: it
// is that the next consumer has somewhere to take them FROM, and that the
// census can refuse a fourth copy by name.

/** A path that may be long. `.reap-ignored` and `.reap-size` (chat.css, the
 *  reap sheet's workspace lines) and `.hotfiles-path` (fleet.css, a hot-file
 *  claim's path) declared the same four, and the first of them added
 *  `word-break` — which is the declaration that makes the shape what it is, so
 *  it rides here and the other two inherit a fix they were missing.
 *
 *  `block`, not `inline`: all three sit in a stacked list where a path owns
 *  its own line. `break-all` is Tailwind's spelling of `word-break:
 *  break-word`'s useful half — a `/home/you/very/long/workspace` must break
 *  somewhere, and a path has no spaces to break at. */
export const MONO_PATH = 'block font-mono text-xs text-ink-secondary break-all';

/** The 6px dot an offline strip draws before its word. `.offline-banner::before`
 *  (fleet.css) and `.chat-banner--offline::before` (chat.css) are the same five
 *  declarations in two stylesheets — the one piece of the offline strip that
 *  banner.tsx's header said "stays its own rule until it earns a component".
 *  Two copies of it is the strip earning one, and a `::before` is the half a
 *  component could never have carried.
 *
 *  It does NOT breathe. The strips it marks are a STATE — the socket is down —
 *  and this palette's rule is that attention is a mark and only busy is alive. */
export const ATTENTION_DOT =
  "before:content-[''] before:block before:size-[6px] before:rounded-full"
  + ' before:bg-status-attention';
