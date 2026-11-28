// The act journal's signed head, one line (Overlord W2, act journal plan Task A3; spec §7.6 H27): L4, drawn beside the Overlord's
// readiness part. It decides nothing: `actHeadOneLine` (L1) says what, if anything, the line reads, from the view it is handed;
// `ActHeadLiveLine` hands it the console's own check (`useActHead`: the head read, the kept head on this device, WebCrypto).
//
// Class hooks: `ovl-line` (the line) with `ovl-status--ok|quiet|attention` through the `data-tone` it carries.
import type { ReactNode } from 'react';
import { actHeadOneLine, type ActHeadView } from './actHeadWords';
import { useActHead } from './useActHead';

/** The line over the console's own check, for the Overlord place. */
export function ActHeadLiveLine(): ReactNode {
  return <ActHeadLine view={useActHead()} />;
}

export function ActHeadLine({ view }: { readonly view: ActHeadView }): ReactNode {
  const line = actHeadOneLine(view);
  if (line === null) return null;
  return (
    <p className={`ovl-line ovl-status--${line.tone}`} role="status" data-act-head-line data-tone={line.tone} data-act-head={line.word}>
      {line.text}
    </p>
  );
}
