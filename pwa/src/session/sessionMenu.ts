// The ⋯ menu's items (D-7573, ARCH-05): `sessionMenu`, the one reader of every item's gate, and the entry it returns.
// Moved out of `SessionFlows.tsx`, which hosts the menu sheet and the command target that asks these entries, so the
// header's view, an L1 module, reads the menu without loading a component file.
import { substrateFault, UNCHECKED_PR, type FleetSession } from '../../../shared/api';
import { substrateFaultText } from '../fleet/substrateWords';
import { sessionDocsHref } from '../docs/docsLinks';
import { isPutAway, restoreReachesEnsure } from '../fleet/archivePutAway';
import { hasPrCap, prDoorWord } from './prCap';

/** One item of the ⋯ menu: its command, its words, and whether it is offered enabled. */
export interface SessionMenuEntry {
  id: 'open-terminal' | 'session-pr' | 'session-model' | 'session-effort' | 'open-history' | 'session-docs'
    | 'session-swap' | 'session-archive' | 'session-restore';
  label: string;
  enabled: boolean;
  /** The reason a gated item is disabled (the substrate chip's own words), on `title`. */
  title?: string;
  danger?: boolean;
  /** Docs only: the branch its hint names, and where it goes. */
  docs?: { href: string; branch: string | null };
}

/** The ⋯ menu for `session`, in the order it draws: the one reader of every item's gate, which the menu renders and
 *  the commands' `when` asks. `null` is a deep link before its first fleet frame. */
export function sessionMenu(session: FleetSession | null): SessionMenuEntry[] {
  // The substrate gate (spec §4): under a standing fault the console cannot SEE this session, so Archive (and a main
  // checkout's Restore) — an offer to act on a pane nobody can measure — refuses, disabled with the reason on
  // `title` (the chip's own `tmux unreachable — <reason>`, from `substrateWords.ts`). Read through `substrateFault`:
  // the frame is cast, not revived, so an older server's row lacks the key at runtime.
  const fault = session === null ? null : substrateFault(session);
  const faultTitle = fault === null ? undefined : substrateFaultText(fault);
  // The menu's Docs item (docs design 4.8), from the one builder the actions sheet's row also calls. No item while no
  // row has arrived, and none when the builder answers null (the project fails the project grammar).
  const docsLink = session === null ? null : sessionDocsHref(session);
  const entries: SessionMenuEntry[] = [
    { id: 'session-model', label: 'Change model', enabled: true },
    { id: 'session-effort', label: 'Change effort', enabled: true },
    { id: 'open-history', label: 'History', enabled: true },
  ];
  if (docsLink !== null) {
    entries.push({ id: 'session-docs', label: 'Docs', enabled: true, docs: { href: docsLink.href, branch: docsLink.branch } });
  }
  // The header's doors, each with its word (desktop polish T3c, D-6333): below 900 the header's doors are glyphs and this
  // sheet is where a phone reads what each is. They run the same commands the header's doors do (`open-terminal` and
  // `session-pr`, in `SessionFlows.tsx#SessionFlows`'s `run`), at every width; at the desk they repeat a visible door. The PR door is a
  // workspace's alone (`hasPrCap`), and its word is the cap's own (`prDoorWord`).
  entries.push({ id: 'open-terminal', label: 'Terminal', enabled: true });
  if (hasPrCap(session)) entries.push({ id: 'session-pr', label: prDoorWord(session.pr ?? UNCHECKED_PR), enabled: true });
  // Gated like Archive below (branch review): this item opens the SAME SwapSheet as the actions sheet's gated opener,
  // and SwapSheet's confirm fires api.swap with no substrate check of its own — so an ungated door here was a swap
  // reachable with no gate anywhere.
  entries.push({ id: 'session-swap', label: 'Move to another account', enabled: fault === null, title: faultTitle });
  // Archive for every session, Restore for one already put away (workspace lifecycle §5.2) — never both. Archive is
  // gated like Move above: it ends the pane. It needs the row to choose its words, so a deep link that has not seen
  // its first frame yet offers it disabled. Restore is gated exactly where it IS Restart's request
  // (`restoreReachesEnsure`: a main checkout posts `/ensure`); a workspace's `ws-restore` is a different verb and
  // stays ungated, as in the actions sheet.
  if (session !== null && isPutAway(session)) {
    const ensure = restoreReachesEnsure(session);
    entries.push({
      id: 'session-restore', label: 'Restore', enabled: !(fault !== null && ensure), title: ensure ? faultTitle : undefined,
    });
  } else {
    entries.push({
      id: 'session-archive', label: 'Archive', enabled: fault === null && session !== null, title: faultTitle, danger: true,
    });
  }
  return entries;
}
