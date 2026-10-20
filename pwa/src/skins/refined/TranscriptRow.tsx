// Refined's transcript row (D-5475, W2 Task S13b; spec §5.3, "plain-language tool rows").
//
// A run of tool entries reads as ONE line: the group's sentence ("Read 3 files · Edited chat.css · Ran npm"), how
// many calls it holds, and a disclosure that opens the run in place into today's tool cards. Collapsed by default.
// Nothing that wants the reader's eye is ever inside it: `groupToolRun` ends a run at an ask, a failed entry and a
// live one, so each of those is a plain item here, drawn as today.
//
// Markup and this skin's own class names only. The words are `groupToolRun`'s (one derived value, one function); the
// cards are the shared renderer's (`useTranscriptRow().renderItem`); whether to fold at all is `ChatList`'s, read off
// the set's `transcriptGrouping` (D-5469). The row part takes no props (D-5678).
import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import { FOCUS_RING } from '@ccrc/ui';
import type { ToolGroupItem } from '../../session/toolSummary';
import { useTranscriptRow } from '../../session/transcriptRow';

function ToolGroupRow({ group }: { group: ToolGroupItem }): ReactNode {
  const { renderItem } = useTranscriptRow();
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  const count = group.entries.length;
  return (
    <div className="ref-tool-group">
      <button
        type="button"
        className={`ref-tool-group-row ${FOCUS_RING}`}
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="ref-tool-group-chev" aria-hidden="true">▸</span>
        <span className="ref-tool-group-text">{group.sentence}</span>
        <span className="ref-tool-group-count">
          <span aria-hidden="true">{count}</span>
          <span className="sr-only">{`, ${count} tool ${count === 1 ? 'call' : 'calls'}`}</span>
        </span>
      </button>
      {open && (
        <div id={bodyId} className="ref-tool-group-body">
          {group.entries.map((e) => <div key={e.key}>{renderItem(e)}</div>)}
        </div>
      )}
    </div>
  );
}

export function TranscriptRow(): ReactNode {
  const { item, renderItem } = useTranscriptRow();
  return item.kind === 'tool-group' ? <ToolGroupRow group={item} /> : renderItem(item);
}
