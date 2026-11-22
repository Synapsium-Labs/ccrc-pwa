// The React singleton: the three lists that keep one React in every config that loads @ccrc/ui's source (vite.config.ts, and
// vitest.browser.config.ts for a browser file that renders ui components to static markup). One module, so a list cannot drift
// between configs; `test/react-singleton-pin.test.ts` holds both configs to it.
//
// @ccrc/ui is consumed as SOURCE from a sibling folder and keeps its own
// react/react-dom/vaul so Storybook can run standalone. Node resolves a bare
// import from the IMPORTER outward, so ui/src/primitives/sheet.tsx — and vaul
// and radix beneath it — all find ui/node_modules/react long before they
// reach this package. Two React instances (19.3.0 there, 19.2.7 here), and
// every hook the sheet calls throws "Invalid hook call".
//
// `dedupe` alone does NOT fix it: dedupe picks one copy among the candidates
// the resolver already offers, and ui's copy is simply found first. These
// aliases are absolute and unconditional, so there is only ever one
// candidate. vaul is aliased too — otherwise it loads from ui's tree and
// drags ui's radix, and therefore ui's react, back in behind it.
//
// react-dom is listed BEFORE react because vite matches alias keys by prefix
// in insertion order, and 'react-dom' starts with 'react'.
//
// EVERY REACT-CALLING PACKAGE ui DEPENDS ON BELONGS IN ALL THREE LISTS
// (dedupe, alias, and `test.server.deps.inline` below). framer-motion joined
// when the composites migrated: `ToolCard` renders `motion`/`AnimatePresence`,
// so it reaches react through framer-motion's copy exactly as the sheet
// reaches it through vaul's. (NOT because of reduced motion — ui has its own
// `usePrefersReducedMotion` precisely so that branch needs no framer import.)
// Adding a ui dependency without adding it here fails only under test, and
// fails as "Invalid hook call" — which reads like a bug in the component
// rather than a second React.
import path from 'node:path';

// `import.meta.dirname`, not `new URL(..., import.meta.url)`: vite's asset plugin rewrites that URL form under a test's transform.
const pkg = (name: string): string => path.join(import.meta.dirname, 'node_modules', name);

/** `resolve.dedupe`: every react-calling package ui depends on. */
const dedupe = ['react', 'react-dom', 'vaul', 'framer-motion', '@radix-ui/react-popover'] as const;

/** `resolve.alias`: absolute and unconditional, 'react-dom' before 'react' (vite matches keys by prefix, in order). */
const alias: Readonly<Record<string, string>> = {
  'react-dom': pkg('react-dom'),
  react: pkg('react'),
  vaul: pkg('vaul'),
  'framer-motion': pkg('framer-motion'),
  // The Popover (D-5934) reaches react through Radix exactly as the sheet does through vaul, so pwa carries its own copy on
  // vaul's Radix line here and this alias takes it (D-6018).
  '@radix-ui/react-popover': pkg('@radix-ui/react-popover'),
};

/** `test.server.deps.inline`: vitest externalises node_modules and lets NODE resolve it, which walks past `resolve.alias`; vaul
 *  would then load ui/node_modules/react. Inlining routes both through vite's pipeline, where the alias applies. */
const inline = [/node_modules\/(vaul|@radix-ui|framer-motion)\//, '@ccrc/ui'] as const;

export const REACT_SINGLETON = { dedupe, alias, inline } as const;
