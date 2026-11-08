// D-8121: the session's Browser tools sheet, opened from its ⋯ menu (`session-browser`). Two rows, On and Off: a tap
// writes the session's `browser` routing field (`api.route`, `ccd route --set browser=…`), which ccd reads at the
// session's NEXT start — nothing is typed into the pane and a running session keeps the servers it has. The line under
// the rows is `browserMcpView`'s reading of the fleet frame: what this run's spawn applied, and whether a change waits
// for a restart. A box whose ccd does not take the field answers 501, said in words.
import { useState } from 'react';
import type { ReactNode } from 'react';
import { OptionRow, Sheet, toast } from '@ccrc/ui';
import type { FleetSession } from '../../../shared/api';
import { ApiError, api, failedTo } from '../lib/api';
import { BROWSER_SHEET_TEXT, BROWSER_WORDS, browserLine, browserMcpView, type BrowserWord } from '../fleet/browserMcpWords';
import './chat.css';

export interface BrowserSheetProps {
  id: string;
  session: FleetSession | null;
  open: boolean;
  onClose: () => void;
}

export function BrowserSheet({ id, session, open, onClose }: BrowserSheetProps): ReactNode {
  const [saving, setSaving] = useState<BrowserWord | null>(null);
  const view = session === null ? null : browserMcpView(session);
  const pick = async (word: BrowserWord): Promise<void> => {
    if (saving !== null) return;
    setSaving(word);
    try {
      await api.route(id, 'browser', word);
      onClose();
      toast(BROWSER_SHEET_TEXT.saved[word]);
    } catch (err) {
      toast(err instanceof ApiError && err.status === 501 ? BROWSER_SHEET_TEXT.unsupported : failedTo('save that', err), 'error');
    } finally {
      setSaving(null);
    }
  };
  return (
    <Sheet open={open} onClose={onClose} eyebrow="browser" title={BROWSER_SHEET_TEXT.title}>
      <div className="opts">
        {BROWSER_WORDS.map((w) => {
          const active = view?.asked === w;
          return (
            <OptionRow
              key={w}
              selected={active}
              glyph={active ? '❯' : ''}
              label={BROWSER_SHEET_TEXT.label[w]}
              sublabel={BROWSER_SHEET_TEXT.sublabel[w]}
              enter={active ? '●' : undefined}
              busy={saving === w}
              disabled={saving !== null && saving !== w}
              onClick={() => void pick(w)}
            />
          );
        })}
      </div>
      {view !== null && <p className="sheet-foot" data-browser-queued={view.queued ? 'yes' : 'no'}>{browserLine(view)}</p>}
      <p className="sheet-foot">{BROWSER_SHEET_TEXT.foot}</p>
    </Sheet>
  );
}
