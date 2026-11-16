// shared/injected-prompts.d.mts — hand-written, in `shared/model-advance.d.mts`'s shape: the `.mjs` beside it is what
// runs, and this is what lets a TypeScript caller import it with types. The key tuple is spelled here once and the key
// type derived from it; `single-definition/injected-prompts.test.ts` holds the tuple equal to the list's own keys.

export declare const INJECTED_PROMPT_KEYS: readonly [
  'mail-nudge', 'idle-compact-nudge', 'clear', 'resume', 'compact', 'effort', 'effort-ultracode', 'model', 'renewal-first-prompt',
];
export type InjectedPromptKey = (typeof INJECTED_PROMPT_KEYS)[number];

/** `exact`: the whole text (a trailing newline trimmed). `head`: the text begins with the row's, at a word boundary. */
export type InjectedPromptMatch = 'exact' | 'head';
/** Who types the row: the server, by a referenced constant, or ccd, in bash (held by the census). */
export type InjectedPromptTyper = 'server' | 'ccd';

export interface InjectedPrompt {
  readonly text: string;
  readonly match: InjectedPromptMatch;
  readonly typer: InjectedPromptTyper;
}

export declare const INJECTED_PROMPTS: { readonly [K in InjectedPromptKey]: InjectedPrompt };

// `string`, not the literal: the sentence is spelled once, in the `.mjs`.
export declare const IDLE_COMPACT_NUDGE_PROMPT: string;
export declare const RESUME_PROMPT_PREFIX: string;

export declare function injectedPromptOf(text: unknown): InjectedPromptKey | null;
