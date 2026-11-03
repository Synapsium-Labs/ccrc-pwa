import type { ReactNode } from 'react';
import { RadioFieldset } from '@ccrc/ui';
import type { ConnectMethod } from '../../../shared/providers';
import { METHOD_LINES } from '../fleet/accountWords';
import type { Choice } from './connectFlow';

/** A method's name and line, when the words have one (the Anthropic methods); any other reads as its own word. */
const linesOf = (m: ConnectMethod): { name: string; line: string | null } =>
  (Object.hasOwn(METHOD_LINES, m) ? METHOD_LINES[m as keyof typeof METHOD_LINES] : { name: m, line: null });

/**
 * "Method" (spec §6.1, §12.3 frame 3; accounts plan Task A18): one radio group, each method with its consequence line.
 * THE ORDER AND THE DEFAULT ARE THE CALLER'S `choices`, which `methodChoices` read from `PROVIDERS[provider].connect`:
 * nothing here restates either. A method whose cap word the fleet does not advertise narrows in place with its reason.
 * `children` is what the chosen method asks for below the radio (the paste method's secret field, Confirm it's you and
 * the primary), drawn by the sheet so the field's lifetime is the frame's.
 */
export function MethodFrame({ choices, selected, onSelect, children }: {
  choices: readonly Choice<ConnectMethod>[];
  selected: ConnectMethod | null;
  onSelect: (m: ConnectMethod) => void;
  children?: ReactNode;
}): ReactNode {
  return (
    <div className="acct-frame" data-frame="method">
      <RadioFieldset<ConnectMethod>
        legend="How should this lane get its credential?"
        name="acct-method"
        className="acct-methods"
        value={selected}
        onPick={onSelect}
        options={choices.map((c) => {
          const l = linesOf(c.value);
          return {
            value: c.value,
            disabled: c.narrowed !== null,
            label: (
              <span className="acct-method-body">
                <span className="acct-method-name">{l.name}</span>
                {l.line !== null && <span className="acct-method-line">{l.line}</span>}
                {c.narrowed !== null && <span className="acct-narrowed">{c.narrowed}</span>}
              </span>
            ),
          };
        })}
      />
      {children}
    </div>
  );
}
