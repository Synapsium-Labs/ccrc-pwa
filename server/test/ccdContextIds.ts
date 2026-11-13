// D-8563: ARCH-34's context ids, a leaf module. `consolidationCensus.ts` re-exports them for ccd's manifest, and
// `rings/ringContextMap.ts` reads them here, so the growth check, which loads the ring classifier, loads no census.

/** The contexts a manifest row may name: the 08-10 spec's nine, C10 Session host (the session-host ruling Q13,
 *  D-8272: hosting, observing and driving sessions behind one SessionHost interface, home `ccd/lib/sessionhost.sh`
 *  in the file-split plan's Task 7) and K (kernels and platform, no aggregate). */
export const CCD_CONTEXTS = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8', 'C9', 'C10', 'K'] as const;
export type CcdContext = (typeof CCD_CONTEXTS)[number];
/** Contexts ccd has and `server/src` and `pwa/src` do not, so the spec's ring-context-map table holds no row for them:
 *  C10 is ccd's SessionHost adapter, and the server declares the port at its consumer, C3 (D-8272). */
export const CCD_ONLY_CONTEXTS: readonly CcdContext[] = ['C10'];
