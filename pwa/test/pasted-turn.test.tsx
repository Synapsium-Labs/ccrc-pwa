// The chat half of a long paste sent as a file (desktop-polish wave 194): a user turn's pointer line is a chip in its
// place, linking only into THIS session's clips; the pending bubble draws the same before the echo; the echo is matched
// against the pointer text; the list prices a pointer as one chip row; and the coordinator's hostile names (condition
// 7) are text, or links that stay inside this session's clips with the name encoded. An assistant turn and a system
// line holding a perfect pointer draw no chip.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { linkify, MessageBubble, type MessageEvent } from '../src/session/MessageBubble';
import { PendingBubble } from '../src/session/PendingBubble';
import { ChatList, shapeOf } from '../src/session/ChatList';
import { ChatRefsContext } from '../src/session/chatRefsContext';
import type { ChatRefContext } from '../src/lib/chatRefs';
import { plainLines } from '../src/session/itemHeight';
import { PASTED_CHIP_LINES } from '../src/session/pastedTurn';
import { SkinSetProvider } from '../src/skins/frame';
import { REFINED_SET } from '../src/skins/refined/parts';
import type { TranscriptItem } from '../src/session/toolActivity';
import { createSessionStore, type PendingSend } from '../src/stores/session';
import { splitClipPaths, type ChatEvent } from '../../shared/api';
import { pastePointer } from '../../shared/pastePointer';
import { pastedTextLabel } from '../src/session/longPasteWords';

// The list draws every row at once here (as `transcript-rows.test.tsx` does): jsdom lays nothing out, so the real
// virtuoso would draw none.
vi.mock('react-virtuoso', async () => {
  const React = await import('react');
  return {
    Virtuoso: React.forwardRef((props: Record<string, unknown>, ref: React.Ref<unknown>) => {
      React.useImperativeHandle(ref, () => ({ scrollToIndex: () => undefined }));
      const count = props.totalCount as number;
      const key = props.computeItemKey as (i: number) => string | number;
      const content = props.itemContent as (i: number) => React.ReactNode;
      return React.createElement('div', null,
        Array.from({ length: count }, (_, i) => React.createElement('div', { key: key(i) }, content(i))));
    }),
  };
});

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

  const brokenName = [
    ['a right-to-left override', 'clip-20261127-153012-1a2b‮3c4d-paste.txt'],
    ['a newline', 'clip-20261127-153012-1a2b\n3c4d-paste.txt'],
    ['a carriage return', 'clip-20261127-153012-1a2b\r3c4d-paste.txt'],
  ] as const;
  for (const [what, name] of brokenName) {
    it(`${what} in the file name is text`, () => {
      const c = bubble(user(pastePointer(at(name), 3)));
      expect(c.querySelector('a.msg-paste')).toBeNull();
      expect(c.querySelector('.msg-user')!.textContent).toContain('The pasted text (3 lines) is in');
    });
  }

  it('a bidi character in the path\'s prefix is accepted, and the link holds no part of the prefix', () => {
    const c = bubble(user(pastePointer(`/home/user-a‮⁦/.cc-clips/${SID}/${NAME}`, 3)));
    const a = c.querySelector('a.msg-paste') as HTMLAnchorElement;
    expect(a.href).toBe(clipHref(NAME));
    expect(a.textContent).toBe(`≡${pastedTextLabel(3)}`);
    expect(a.getAttribute('aria-label')).toBe('Open the pasted text, 3 lines, in a new tab');
    for (const s of [a.href, decodeURIComponent(a.href), a.outerHTML]) {
      expect(s).not.toMatch(/[‮⁦]|user-a/);
    }
  });

  it('a perfect pointer inside a tool result is drawn as the result\'s text, never a chip', () => {
    const use = { kind: 'tool_use', uuid: 't1', ts: TS, toolId: 'tool-1', name: 'Bash', input: '{"command":"cat x"}' };
    const result = { kind: 'tool_result', ts: TS, toolId: 'tool-1', text: pastePointer(PATH, 3), isError: false };
    const { container } = render(
      <SkinSetProvider set={{ ...REFINED_SET, toolActivity: 'none' }}>
        <ChatList id={SID} events={[use, result] as ChatEvent[]} pending={[]} onRetry={() => {}} onDiscard={() => {}} />
      </SkinSetProvider>,
    );
    // Open every disclosure, the ones an opened row reveals too, until the result itself is drawn.
    for (let round = 0; round < 4; round += 1) {
      for (const b of container.querySelectorAll<HTMLElement>('[aria-expanded="false"]')) fireEvent.click(b);
    }
    expect(container.textContent).toContain('The pasted text (3 lines) is in');
    expect(container.querySelector('a.msg-paste')).toBeNull();
  });

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

describe('the list prices a pointer as the chip it draws', () => {
  const lines = (item: TranscriptItem, session = SID): number => shapeOf(item, undefined, undefined, session).lines;
  const turn = (text: string): TranscriptItem => ({ kind: 'message', event: user(text) }) as TranscriptItem;
  const send = (text: string): TranscriptItem =>
    ({ kind: 'pending', send: { key: 'k', text, state: 'sending', sentAt: 0 } as PendingSend }) as TranscriptItem;

  it('the chip costs its tap floor and its two margins over one line of the bubble: 52 over 22.5, about 2.3 lines', () => {
    expect(PASTED_CHIP_LINES).toBeCloseTo(52 / 22.5, 10);
  });

  it('those four numbers are the ones the token sheet and the chat sheet draw the chip and the bubble with', () => {
    const read = (p: string): string => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');
    const tokens = read('../../ui/src/styles/tokens.css');
    const chat = read('../src/session/chat.css');
    const token = (name: string): string => new RegExp(`--${name}:\\s*([^;]+);`).exec(tokens)![1]!.trim();
    expect([token('tap-min'), token('sp-1'), token('fs-base'), token('lh-normal')]).toEqual(['44px', '4px', '15px', '1.5']);
    const rule = (sel: string): string => {
      const at = chat.indexOf(`${sel} {`);
      return chat.slice(at, chat.indexOf('}', at));
    };
    expect(rule('.msg-user .msg-paste')).toContain('min-height: var(--tap-min);');
    expect(rule('.msg-user .msg-paste')).toContain('margin: var(--sp-1) 0;');
    expect(rule('\n.msg-user')).toContain('font-size: var(--fs-base);');
    expect(rule('\n.msg-user')).toContain('line-height: var(--lh-normal);');
  });

  it('for a confirmed turn and for a pending one', () => {
    const chip = `a\n${pastePointer(PATH, 214)}\nb`;
    expect(lines(turn(chip))).toBeCloseTo(lines(turn('a\nb')) + PASTED_CHIP_LINES, 10);
    expect(lines(send(chip))).toBeCloseTo(lines(send('a\nb')) + PASTED_CHIP_LINES, 10);
  });

  // A line that is no pointer here is drawn as today's text: the confirmed bubble takes its clip path out as an
  // attachment (`splitClipPaths`) and the pending bubble draws it as typed. The price is that drawing, with no chip.
  const asText = (text: string) => {
    const { paths, rest } = splitClipPaths(text);
    return { bucket: 'user', lines: plainLines(rest), attach: paths.length };
  };

  it('a look-alike is priced as the text it is drawn as', () => {
    const near = `a\n${pastePointer(PATH, 214).replace('214 lines', '214 line')}\nb`;
    expect(shapeOf(turn(near), undefined, undefined, SID)).toEqual(asText(near));
    expect(lines(send(near))).toBe(plainLines(near));
    expect(bubble(user(near)).querySelector('a.msg-paste')).toBeNull();
  });

  it('only a pointer of this session is a chip, as the bubble draws it: another session\'s is text here', () => {
    const other = `/home/user-a/.cc-clips/lane-b/${NAME}`;
    const text = `a\n${pastePointer(other, 214)}\nb`;
    expect(shapeOf(turn(text), undefined, undefined, SID)).toEqual(asText(text));
    expect(lines(send(text))).toBe(plainLines(text));
    expect(lines(turn(text), 'lane-b')).toBeCloseTo(lines(turn('a\nb'), 'lane-b') + PASTED_CHIP_LINES, 10);
    expect(bubble(user(text)).querySelector('a.msg-paste')).toBeNull();
  });
});

describe('a turn\'s repository evidence is the whole turn\'s (review 4119 F4)', () => {
  const CROSS: ChatRefContext = {
    repo: 'owner-a/repo-a', project: 'project-a', branch: 'ws/one', knownRuns: new Set(), knownItems: new Set(),
    runsElsewhere: true,
  };
  const links = (text: string): string[][] => {
    const { container } = render(
      <ChatRefsContext value={CROSS}><MessageBubble id={SID} event={user(text)} /></ChatRefsContext>,
    );
    const out = Array.from(container.querySelectorAll('.msg-user a:not(.msg-paste)'))
      .map((a) => [a.textContent ?? '', a.getAttribute('href') ?? '']);
    cleanup();
    return out;
  };

  it('a repository named before a chip still qualifies a bare reference after it', () => {
    const want = [
      ['owner-b/repo-b#12', 'https://github.com/owner-b/repo-b/issues/12'],
      ['#12', 'https://github.com/owner-b/repo-b/issues/12'],
    ];
    expect(links(`owner-b/repo-b#12 merged\nsee #12 again`)).toEqual(want);
    expect(links(`owner-b/repo-b#12 merged\n${pastePointer(PATH, 3)}\nsee #12 again`)).toEqual(want);
  });

  it('a turn with no pointer links exactly as the bubble always did', () => {
    const text = '#512 is green; owner-b/repo-b#12 merged.';
    const { container } = render(
      <ChatRefsContext value={CROSS}><MessageBubble id={SID} event={user(text)} /></ChatRefsContext>,
    );
    const body = container.querySelector('.msg-user')!;
    const ref = document.createElement('div');
    render(<>{linkify(text, CROSS)}</>, { container: ref });
    expect(body.innerHTML).toBe(ref.innerHTML);
  });
});
