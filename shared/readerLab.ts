// The reader lab's vocabulary (native Docs reader, the reader lab plan of 2026-11-03, Task 1; the reader lab design,
// sections 3 and 4; the rich-docs spec's row M10.1): the door's paths, the closed list of probe names a lab run counts,
// the classes the door keeps of each request, and the wire of its three session-gated routes. L0: it imports nothing,
// so the server's door and the PWA's page read one copy.

/** The frame CSP battery's 27 channels (lab 1-2's list; rich-docs spec M8.B1), in the battery's order. The desktop
 *  browser leg and the reader lab run this one list (M10.16). */
export type LabBatteryChannel =
  | 'fetch-cors' | 'fetch-nocors' | 'fetch-credentials' | 'fetch-post' | 'fetch-keepalive' | 'xhr-get' | 'xhr-post'
  | 'beacon' | 'websocket' | 'eventsource' | 'image' | 'image-srcset' | 'script' | 'script-module' | 'link-stylesheet'
  | 'link-prefetch' | 'link-preload' | 'link-modulepreload' | 'style-import' | 'css-background' | 'css-font-face'
  | 'css-content-url' | 'audio' | 'video' | 'svg-image' | 'import-dynamic' | 'iframe';

const LAB_BATTERY_CHANNEL_MAP: Record<LabBatteryChannel, true> = {
  'fetch-cors': true, 'fetch-nocors': true, 'fetch-credentials': true, 'fetch-post': true, 'fetch-keepalive': true,
  'xhr-get': true, 'xhr-post': true, beacon: true, websocket: true, eventsource: true, image: true, 'image-srcset': true,
  script: true, 'script-module': true, 'link-stylesheet': true, 'link-prefetch': true, 'link-preload': true,
  'link-modulepreload': true, 'style-import': true, 'css-background': true, 'css-font-face': true,
  'css-content-url': true, audio: true, video: true, 'svg-image': true, 'import-dynamic': true, iframe: true,
};
export const LAB_BATTERY_CHANNELS = Object.keys(LAB_BATTERY_CHANNEL_MAP) as LabBatteryChannel[];

/** Every probe that is not a battery channel, by the check that sends it (the reader lab design, section 3.2):
 *  - `cookie-console` is the console's own request, the cookie check's control; `cookie-*` the frame's requests, and
 *    `cookie-ran` its sign that it ran;
 *  - `ambient-<key>-held` / `-broke`: the opaque-origin frame's report for each thing it tried to reach;
 *  - `csp-canary`: the wall frame's one allowed request, its sign that the battery ran;
 *  - `popup-open`, `popup-blank`, `top-nav`: targets that must never be reached; `popup-null`, `popup-window`,
 *    `top-read-*`, `top-write-*`: the frame's report; `popup-ran`: its sign that the tap happened;
 *  - `self-nav-tried`, then `self-nav`, the target the frame must not reach;
 *  - `busy-start`, `busy-end`: the busy frame's spin;
 *  - `strays-sent`: the stray frame's sign that it posted;
 *  - `hostile-img`, `hostile-click`: the hostile figures' targets, which must never be reached. */
export type LabFixedProbe =
  | 'cookie-console' | 'cookie-fetch' | 'cookie-fetch-marker' | 'cookie-xhr' | 'cookie-beacon' | 'cookie-websocket'
  | 'cookie-image' | 'cookie-ran'
  | 'ambient-parent-held' | 'ambient-parent-broke' | 'ambient-origin-held' | 'ambient-origin-broke'
  | 'ambient-cookie-held' | 'ambient-cookie-broke' | 'ambient-local-held' | 'ambient-local-broke'
  | 'ambient-session-held' | 'ambient-session-broke' | 'ambient-idb-held' | 'ambient-idb-broke'
  | 'ambient-caches-held' | 'ambient-caches-broke'
  | 'csp-canary'
  | 'popup-open' | 'popup-blank' | 'top-nav' | 'popup-null' | 'popup-window' | 'top-read-held' | 'top-read-broke'
  | 'top-write-threw' | 'top-write-returned' | 'popup-ran'
  | 'self-nav-tried' | 'self-nav'
  | 'busy-start' | 'busy-end'
  | 'strays-sent'
  | 'hostile-img' | 'hostile-click';

const LAB_FIXED_PROBE_MAP: Record<LabFixedProbe, true> = {
  'cookie-console': true, 'cookie-fetch': true, 'cookie-fetch-marker': true, 'cookie-xhr': true, 'cookie-beacon': true,
  'cookie-websocket': true, 'cookie-image': true, 'cookie-ran': true,
  'ambient-parent-held': true, 'ambient-parent-broke': true, 'ambient-origin-held': true, 'ambient-origin-broke': true,
  'ambient-cookie-held': true, 'ambient-cookie-broke': true, 'ambient-local-held': true, 'ambient-local-broke': true,
  'ambient-session-held': true, 'ambient-session-broke': true, 'ambient-idb-held': true, 'ambient-idb-broke': true,
  'ambient-caches-held': true, 'ambient-caches-broke': true,
  'csp-canary': true,
  'popup-open': true, 'popup-blank': true, 'top-nav': true, 'popup-null': true, 'popup-window': true,
  'top-read-held': true, 'top-read-broke': true, 'top-write-threw': true, 'top-write-returned': true, 'popup-ran': true,
  'self-nav-tried': true, 'self-nav': true,
  'busy-start': true, 'busy-end': true,
  'strays-sent': true,
  'hostile-img': true, 'hostile-click': true,
};
export const LAB_FIXED_PROBES = Object.keys(LAB_FIXED_PROBE_MAP) as LabFixedProbe[];

/** Every name a lab run counts: the fixed probes, then the wall frame's battery (`csp-`) and the control frame's (`ctl-`). */
export type LabProbeName = LabFixedProbe | `csp-${LabBatteryChannel}` | `ctl-${LabBatteryChannel}`;
export const LAB_PROBE_NAMES: readonly LabProbeName[] = [
  ...LAB_FIXED_PROBES,
  ...LAB_BATTERY_CHANNELS.map((c): LabProbeName => `csp-${c}`),
  ...LAB_BATTERY_CHANNELS.map((c): LabProbeName => `ctl-${c}`),
];
const PROBE_NAME_SET: ReadonlySet<string> = new Set<string>(LAB_PROBE_NAMES);

/** Whether `s` is a name of the vocabulary: membership, nothing more. */
export const isLabProbeName = (s: string): s is LabProbeName => PROBE_NAME_SET.has(s);

/** A run's nonce: 16 random bytes as unpadded base64url, 22 characters, minted by the server and never by a client. */
const NONCE_SHAPE = /^[A-Za-z0-9_-]{22}$/;
export const isLabNonce = (s: string): boolean => NONCE_SHAPE.test(s);

/** `Sec-Fetch-Site`, as the door keeps it: the four values browsers send, `absent`, or `other`. */
export type LabSiteClass = 'same-origin' | 'same-site' | 'cross-site' | 'none' | 'absent' | 'other';
const LAB_SITE_CLASS_MAP: Record<LabSiteClass, true> = {
  'same-origin': true, 'same-site': true, 'cross-site': true, none: true, absent: true, other: true,
};
export const LAB_SITE_CLASSES = Object.keys(LAB_SITE_CLASS_MAP) as LabSiteClass[];

/** `Origin`, as the door keeps it: an opaque origin's literal `null`, `absent`, or `present` (whose text is not kept). */
export type LabOriginClass = 'null' | 'absent' | 'present';
const LAB_ORIGIN_CLASS_MAP: Record<LabOriginClass, true> = { null: true, absent: true, present: true };
export const LAB_ORIGIN_CLASSES = Object.keys(LAB_ORIGIN_CLASS_MAP) as LabOriginClass[];

/** The run routes' root. `server/src/readerLab/routes.ts` spells the same paths as literals, which the route census
 *  reads; `reader-lab-routes.test.ts` holds them equal. */
export const READER_LAB_RUNS_PATH = '/api/reader-lab/runs';
/** The probe route's pattern, as Fastify matches it: the counter compares a request's matched route with it. */
export const READER_LAB_PROBE_ROUTE = '/api/reader-lab/probe/:nonce/:name';
export const readerLabRunPath = (nonce: string): string => `${READER_LAB_RUNS_PATH}/${nonce}`;
export const readerLabClosePath = (nonce: string): string => `${READER_LAB_RUNS_PATH}/${nonce}/close`;
/** The path a lab frame appends a probe name to: the probe route with this run's nonce. */
export const readerLabProbeBase = (nonce: string): string => `/api/reader-lab/probe/${nonce}/`;
export const readerLabProbePath = (nonce: string, name: LabProbeName): string => `${readerLabProbeBase(nonce)}${name}`;

// The lab run's own time caps (the reader lab design, section 4.4). The page's run (`pwa/src/readerLab/run.ts`) waits by
// these, and the door derives a run's life from their sum (`server/src/readerLab/runs.ts`), so a run that spends every
// cap still ends inside its life.
/** How long a frame's script is given before its counts are read. */
export const LAB_SETTLE_MS = 2000;
/** How long the busy frame spins. */
export const LAB_BUSY_SPIN_MS = 3000;
/** How long the popup step waits for the operator's tap. */
export const LAB_TAP_WAIT_MS = 30_000;
/** The run's own cap on one timed reader mount, above the lab profile's 60 s watchdog. */
export const LAB_MOUNT_WAIT_MS = 65_000;
/** How far a mount's frame-gap window runs past `ready` once the library draws after `ready` (the run's
 *  `ready-and-settle` window; the reader lab design, section 8). */
export const LAB_DRAW_SETTLE_MS = 10_000;
/** The run's steps, for the page's progress. */
export const LAB_STEPS = 9;
/** The run's reader mounts: the nine pages, the hostile page, and the benign page the stray messages are sent to. */
export const LAB_MOUNTS = 11;
/** The longest a run takes by its own caps: the tap wait, a settle per step, the spin, and every mount at its cap and its
 *  draw settle. About fifteen minutes; a run on a working phone takes about two. */
export const LAB_RUN_CAPS_MS = LAB_TAP_WAIT_MS + LAB_STEPS * LAB_SETTLE_MS + LAB_BUSY_SPIN_MS
  + LAB_MOUNTS * (LAB_MOUNT_WAIT_MS + LAB_DRAW_SETTLE_MS);

/** What the door counted for one probe name: arrivals, and of those how many carried the session cookie (by name),
 *  were WebSocket upgrades, and fell in each class. */
export interface LabProbeTally {
  readonly hits: number;
  readonly cookie: number;
  readonly upgrade: number;
  readonly site: Readonly<Record<LabSiteClass, number>>;
  readonly origin: Readonly<Record<LabOriginClass, number>>;
}

/** One open run's counts. `probes` names every probe of the vocabulary, zeros included. `counted` is every request
 *  that named this run, `ignored` those of them whose name is outside the vocabulary; `saturated` is true once
 *  `counted` reached the door's cap, after which nothing more was counted, so the run's result is not trusted. */
export interface LabRunView {
  readonly openedAt: number;
  readonly expiresAt: number;
  readonly counted: number;
  readonly ignored: number;
  readonly saturated: boolean;
  readonly probes: Readonly<Record<LabProbeName, LabProbeTally>>;
}

/** `POST /api/reader-lab/runs`. */
export interface LabOpenAnswer { readonly ok: true; readonly nonce: string; readonly ttlMs: number }
/** `GET /api/reader-lab/runs/:nonce`: 200 with the run, or 404 `unknown-run` (no open run that this session opened
 *  carries that nonce: another session's run answers exactly as an unknown nonce does). */
export type LabReadAnswer = { readonly ok: true; readonly run: LabRunView } | { readonly ok: false; readonly error: 'unknown-run' };
/** `POST /api/reader-lab/runs/:nonce/close`: `closed` is false when no run of this session was open under that nonce. */
export interface LabCloseAnswer { readonly ok: true; readonly closed: boolean }
