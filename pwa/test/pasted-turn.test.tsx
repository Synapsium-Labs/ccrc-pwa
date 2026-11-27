// The chat half of a long paste sent as a file (desktop-polish wave 194): a user turn's pointer line is a chip in its
// place, linking only into THIS session's clips; the pending bubble draws the same before the echo; the echo is matched
// against the pointer text; the list prices a pointer as one chip row; and the coordinator's hostile names (condition
// 7) are text, or links that stay inside this session's clips with the name encoded. An assistant turn and a system
// line holding a perfect pointer draw no chip.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { MessageBubble, type MessageEvent } from '../src/session/MessageBubble';
import { PendingBubble } from '../src/session/PendingBubble';
import { shapeOf } from '../src/session/ChatList';
import type { TranscriptItem } from '../src/session/toolActivity';
import { createSessionStore, type PendingSend } from '../src/stores/session';
import { pastePointer } from '../../shared/pastePointer';
import { pastedTextLabel } from '../src/session/longPasteWords';

const SID = 'lane-a-project-a';
const STORE = `/home/user-a/.cc-clips/${SID}`;
const NAME = 'clip-20261127-153012-1a2b3c4d-paste.txt';
const PATH = `${STORE}/${NAME}`;
const TS = '2026-11-27T10:00:00.000Z';

afterEach(() => cleanup());

const user = (text: string): MessageEvent => ({ kind: 'user', uuid: 'u1', ts: TS, text });
const bubble = (event: MessageEvent): HTMLElement => render(<MessageBubble id={SID} event={event} />).container;
const clipHref = (name: string): string =>
  `${location.origin}/api/sessions/${encodeURIComponent(SID)}/clip/${encodeURIComponent(name)}`;

describe('a user turn with a pointer', () => {
  it('draws the chip in its place, between the text around it, linking to this session\'s clip', () => {
    const c = bubble(user(`before\n${pastePointer(PATH, 214)}\nafter`));
    const body = c.querySelector('.msg-user')!;
    const kids = Array.from(body.childNodes).map((n) => (n instanceof HTMLAnchorElement ? `[${n.textContent}]` : n.textContent));
    expect(kids).toEqual(['before', `[≡${pastedTextLabel(214)}]`, 'after']);
    const a = body.querySelector('a.msg-paste') as HTMLAnchorElement;
    expect(a.href).toBe(clipHref(NAME));
    expect(a.getAttribute('aria-label')).toBe('Open the pasted text, 214 lines, in a new tab');
    expect(body.textContent).not.toContain(PATH);
  });

  it('keeps a tray attachment above the bubble and never pulls the pointer\'s path into the thumbnails', () => {
    const img = `${STORE}/clip-20261127-153012-aaaaaaaa-shot.png`;
    const c = bubble(user(`${img}\nhi\n${pastePointer(PATH, 3)}`));
    const thumbs = c.querySelectorAll('.msg-attach img');
    expect(Array.from(thumbs).map((i) => i.getAttribute('alt'))).toEqual(['clip-20261127-153012-aaaaaaaa-shot.png']);
    expect(c.querySelectorAll('.msg-attach-doc')).toHaveLength(0);
    expect(c.querySelector('.msg-user a.msg-paste')).not.toBeNull();
  });

  it('a turn of a pointer alone is one chip in the bubble', () => {
    const c = bubble(user(pastePointer(PATH, 1)));
    expect(c.querySelector('.msg-user')!.textContent).toBe(`≡${pastedTextLabel(1)}`);
  });

  it('opens the file in a new tab, as a document chip does', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const c = bubble(user(pastePointer(PATH, 2)));
    (c.querySelector('a.msg-paste') as HTMLAnchorElement).click();
    expect(open).toHaveBeenCalledWith(clipHref(NAME), '_blank', 'noopener,noreferrer');
    open.mockRestore();
  });
});

describe('the hostile names of condition 7', () => {
  const at = (name: string, folder = SID): string => `/home/user-a/.cc-clips/${folder}/${name}`;
  const asText = [
    ['an encoded slash', at('clip-20261127-153012-1a2b3c4d%2F..%2Fx-paste.txt')],
    ['a second extension', at('clip-20261127-153012-1a2b3c4d-paste.txt.png')],
    ['upper case in the suffix', at('clip-20261127-153012-1a2b3c4d-PASTE.TXT')],
    ['mixed case in the suffix', at('clip-20261127-153012-1a2b3c4d-Paste.txt')],
    ['a parent step before the clips folder', `/home/user-a/../.cc-clips/${SID}/${NAME}`],
    ['another session whose id has this one\'s as a prefix', at(NAME, `${SID}-b`)],
    ['another session whose id is a prefix of this one', at(NAME, 'lane-a-project')],
  ] as const;
  for (const [what, p] of asText) {
    it(`${what} is text`, () => {
      const line = pastePointer(p, 3);
      const c = bubble(user(line));
      expect(c.querySelector('a.msg-paste')).toBeNull();
      expect(c.querySelector('.msg-user')!.textContent).toContain('The pasted text (3 lines) is in');
    });
  }

  it('a trailing space is text', () => {
    const c = bubble(user(`${pastePointer(PATH, 3)} `));
    expect(c.querySelector('a.msg-paste')).toBeNull();
  });

  const inSession = [
    ['a dot run', 'clip-20261127-153012-1a2b3c4d..-..-paste.txt'],
    ['an extension inside the stem', 'clip-20261127-153012-1a2b3c4d.png-paste.txt'],
  ] as const;
  for (const [what, name] of inSession) {
    it(`${what} links only inside this session's clips, its name encoded`, () => {
      const c = bubble(user(pastePointer(at(name), 3)));
      const a = c.querySelector('a.msg-paste') as HTMLAnchorElement;
      expect(a.href).toBe(clipHref(name));
      expect(a.href.startsWith(`${location.origin}/api/sessions/${encodeURIComponent(SID)}/clip/`)).toBe(true);
      expect(new URL(a.href).pathname.split('/')).toHaveLength(6);
    });
  }

  it('an assistant turn and a system line holding a perfect pointer draw no chip', () => {
    const line = pastePointer(PATH, 3);
    const a = bubble({ kind: 'assistant', uuid: 'a1', ts: TS, text: line });
    expect(a.querySelector('a.msg-paste')).toBeNull();
    cleanup();
    const s = bubble({ kind: 'system', uuid: 's1', ts: TS, text: line });
    expect(s.querySelector('a.msg-paste')).toBeNull();
  });
});

describe('the pending bubble', () => {
  const pending = (state: 'sending' | 'failed', text: string): PendingSend =>
    ({ key: 'k1', text, state, sentAt: 0, ...(state === 'failed' ? { error: 'agent-down' } : {}) }) as PendingSend;

  it('draws the same chip in its place before the echo arrives, and when the send failed', () => {
    for (const state of ['sending', 'failed'] as const) {
      const c = render(<PendingBubble id={SID} send={pending(state, `see\n${pastePointer(PATH, 214)}`)} />).container;
      const body = c.querySelector('.msg-user')!;
      expect(body.firstChild?.textContent).toBe('see');
      expect((body.querySelector('a.msg-paste') as HTMLAnchorElement).href).toBe(clipHref(NAME));
      cleanup();
    }
  });

  it('draws a send with no pointer exactly as before', () => {
    const c = render(<PendingBubble id={SID} send={pending('sending', '  two\n  lines ')} />).container;
    expect(c.querySelector('.msg-user')!.innerHTML).toBe('  two\n  lines ');
  });
});

describe('the echo', () => {
  it('clears the pending when the transcript gives back the pointer text', async () => {
    const prompt = vi.fn().mockResolvedValue(undefined);
    const store = createSessionStore(SID, { api: { prompt } });
    const text = `look\n${pastePointer(PATH, 214)}`;
    await store.getState().send(text);
    expect(prompt).toHaveBeenCalledWith(SID, text, expect.anything());
    store.getState().apply({ type: 'events', uuid: 'u1', offset: 1, events: [{ kind: 'user', uuid: 'e1', ts: new Date(Date.now() + 1000).toISOString(), text }] });
    expect(store.getState().pending).toHaveLength(0);
  });
});

describe('the list prices a pointer as one chip row', () => {
  const lines = (item: TranscriptItem): number => shapeOf(item).lines;
  it('for a confirmed turn and for a pending one', () => {
    const plain = lines({ kind: 'message', event: user('a\nb') } as TranscriptItem);
    expect(lines({ kind: 'message', event: user(`a\n${pastePointer(PATH, 214)}\nb`) } as TranscriptItem)).toBe(plain + 1);
    const send = { key: 'k', text: 'a\nb', state: 'sending', sentAt: 0 } as PendingSend;
    const pend = lines({ kind: 'pending', send } as TranscriptItem);
    expect(lines({ kind: 'pending', send: { ...send, text: `a\n${pastePointer(PATH, 214)}\nb` } } as TranscriptItem))
      .toBe(pend + 1);
  });
});
