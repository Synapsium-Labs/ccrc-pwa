// The chat's name context (chat reading Task L, D-8062; ring L4: a React context). `SessionScreen` provides what its session
// knows to resolve a name (`ChatRefContext`: the measured repository, the project, the branch, the runs and items the console
// holds, whether the session claims a run elsewhere); `ChatRef` and `linkify` read it and ask `refHref`. `null`, the default, has
// ONE meaning: no session around the chat, so every name stays text and the output is today's.
import { createContext } from 'react';
import type { ChatRefContext } from '../lib/chatRefs';
import type { MessageRepos } from '../lib/chatRepoEvidence';

export const ChatRefsContext = createContext<ChatRefContext | null>(null);

/** What the message around a name says about repositories (desktop polish Task C21, D-8172): `ChatMarkdown` provides
 *  `messageRepos` of its whole text, memoised, and `ChatRef` passes it to `refHref`. `null`, the default, has ONE meaning: no
 *  message around the name, so the name stays text, as with no session. */
export const MessageReposContext = createContext<MessageRepos | null>(null);
