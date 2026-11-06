// The chat's name context (chat reading Task L, D-8062; ring L4: a React context). `SessionScreen` provides what its session
// knows to resolve a name (`ChatRefContext`: the measured repository, the project, the branch, the runs and items the console
// holds); `ChatRef` and `linkify` read it and ask `refHref`. `null`, the default, has ONE meaning: no session around the chat,
// so every name stays text and the output is today's.
import { createContext } from 'react';
import type { ChatRefContext } from '../lib/chatRefs';

export const ChatRefsContext = createContext<ChatRefContext | null>(null);
