// The reader lab's device line (native Docs reader, the reader lab plan of 2026-11-03, Task 8, refinement (n)). Ring L1:
// pure. Classes only, from the user agent string, the core count and three feature tests: the engine and its major
// version, the OS class, the cores, and whether the browser has what the reader frame relies on; never the user agent
// string itself or a device model, so the result can go into a public ledger as it is.

/** What the reader frame relies on, tested once by presence: a Worker (the parse), the iframe `sandbox` attribute, and the
 *  iframe `csp` attribute (Chromium's alone: where it is missing, the frame document's meta alone carries the frame
 *  policy). That the lab's own sandboxed frames ran at all is the stronger proof, which the check lines carry. */
export interface LabFeatures {
  readonly worker: boolean;
  readonly frameSandbox: boolean;
  readonly cspAttribute: boolean;
}

export interface LabDevice extends LabFeatures {
  /** `Blink 141`, `WebKit 19`, `Gecko 140`, or `unknown`. */
  readonly engine: string;
  /** `Android`, `iOS`, `macOS`, `Windows`, `Linux` or `other`. */
  readonly os: string;
  /** Null: the browser does not say. */
  readonly cores: number | null;
}

/** The features, read from `win` (the page hands it `window`): presence tests, nothing called. */
export function labFeaturesOf(win: unknown): LabFeatures {
  const w = (typeof win === 'object' && win !== null ? win : {}) as { readonly 'Worker'?: unknown; readonly HTMLIFrameElement?: { readonly prototype?: unknown } };
  const proto = w.HTMLIFrameElement?.prototype;
  const has = (k: string): boolean => typeof proto === 'object' && proto !== null && k in proto;
  return { worker: typeof w['Worker'] === 'function', frameSandbox: has('sandbox'), cspAttribute: has('csp') };
}

/** The device line's facts. Every browser on iOS is WebKit, whatever its name. */
export function deviceOf(ua: string, cores: unknown, features: LabFeatures): LabDevice {
  const first = (re: RegExp): string | null => re.exec(ua)?.[1] ?? null;
  const tagged = (name: string, version: string | null): string => (version === null ? name : `${name} ${version}`);
  const ios = /\b(?:iPhone|iPad|iPod)\b/.test(ua);
  const os = /Android/.test(ua) ? 'Android' : ios ? 'iOS' : /Mac OS X/.test(ua) ? 'macOS'
    : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'other';
  const engine = ios ? tagged('WebKit', first(/OS (\d+)[_.]/))
    : /Firefox\/\d+/.test(ua) ? tagged('Gecko', first(/Firefox\/(\d+)/))
      : /(?:Chrome|Chromium)\/\d+/.test(ua) ? tagged('Blink', first(/(?:Chrome|Chromium)\/(\d+)/))
        : /AppleWebKit\//.test(ua) ? tagged('WebKit', first(/Version\/(\d+)/))
          : 'unknown';
  return { engine, os, cores: typeof cores === 'number' && Number.isSafeInteger(cores) && cores > 0 ? cores : null, ...features };
}

/** The device line, in order: the result block's first line and the page say the same facts. */
export function deviceFacts(d: LabDevice): string[] {
  const yes = (b: boolean): string => (b ? 'yes' : 'no');
  return [d.engine, d.os, ...(d.cores === null ? [] : [`${d.cores} cores`]), `worker ${yes(d.worker)}`,
    `frame sandbox ${yes(d.frameSandbox)}`, `csp attribute ${yes(d.cspAttribute)}`];
}
