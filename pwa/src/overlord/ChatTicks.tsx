// The ticks under an operator message in the Overlord chat (Overlord W1, the chat, Task 4): recorded, queued or delivered,
// picked up, settled. Each tick lit by its own stamp (`shared/overlordChat.ts#chatTicksOf`); a gap is drawn as a gap. The
// words say the same to a screen reader (`chatWords.ts#tickWords`). L4: it draws and decides nothing.
import type { ReactNode } from 'react';
import { TICK_STAGES, tickStageWords, type ChatTicks as Ticks } from '../../../shared/overlordChat';
import { tickWords } from './chatWords';

export function ChatTicks({ ticks }: { ticks: Ticks }): ReactNode {
  return (
    <p className="oc-ticks" aria-label={tickWords(ticks)} data-unknown={ticks.unknown || undefined}>
      {TICK_STAGES.map((s) => (
        <span key={s} className="oc-tick" data-lit={ticks.lit[s] || undefined} aria-hidden="true"
          title={s === 'delivery' ? ticks.delivery ?? tickStageWords(s) : tickStageWords(s)}>
          {ticks.lit[s] ? '✓' : '·'}
        </span>
      ))}
    </p>
  );
}
