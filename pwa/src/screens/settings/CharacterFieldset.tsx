// Settings › Appearance › Character (the Overlord face plan, Task 7): the Orb or the Dark Lord, one radiogroup of two
// cards, each drawing its own face at rest. The choice is the person's, not this device's: `lib/character.ts` keeps it as
// one server row, so the card's scope reads "You". It is the Switch character command's door (`doorMark`).
//
// The face is `@ccrc/ui`'s `Character` component; the vocabulary's type of the same name is imported under another
// name, so neither shadows the other. The keys are `radioArrows`', as Theme's are.
import type { ReactNode } from 'react';
import { Character, Radio, Section } from '@ccrc/ui';
import { AppearanceFieldset, radioArrows } from '../AppearanceRow';
import { SETTINGS_CARDS } from '../../fleet/settingsText';
import { CHARACTER_CHOICES, setCharacter, useCharacter } from '../../lib/character';

export function CharacterFieldset(): ReactNode {
  const card = SETTINGS_CARDS.appearance.character;
  const current = useCharacter();
  const at = Math.max(0, CHARACTER_CHOICES.findIndex((c) => c.id === current));
  const onKeyDown = radioArrows(CHARACTER_CHOICES.length, at, (next) => setCharacter(CHARACTER_CHOICES[next]!.id));

  return (
    <Section level={3} scope={card.scope} title={card.title} purpose={card.purpose}>
      <AppearanceFieldset legend="Character" command="switch-character">
        <div role="radiogroup" aria-label="Characters" className="settings-characters" onKeyDown={onKeyDown}>
          {CHARACTER_CHOICES.map((c, i) => (
            <span key={c.id} className="settings-character" data-active={i === at}>
              <Radio
                className="settings-character-hit"
                name="settings-character"
                value={c.id}
                checked={i === at}
                tabIndex={i === at ? 0 : -1}
                onChange={() => setCharacter(c.id)}
                bare
              >
                <Character character={c.id} mood="neutral" scale={2} play={false} />
                <span className="settings-character-name">{c.label}</span>
              </Radio>
            </span>
          ))}
        </div>
      </AppearanceFieldset>
    </Section>
  );
}
