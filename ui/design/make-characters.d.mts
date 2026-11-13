// Types for make-characters.mjs, which pwa's tests and the icon generator import (`pwa/design/audit.d.mts`'s idiom).
import type { MoodArt, Tone } from '../src/characters/art';

export interface StillCell { tone: Tone; under: Tone | null; alpha: number | null }
export type StillGrid = (StillCell | null)[][];

/** One SVG text -> its mood's art. Throws `refused <what>: …` for anything outside the vocabulary. */
export function parseArt(svgText: string): MoodArt;
/** The whole set (`<character>-<mood>.svg` name -> text) -> the text of `art.ts` and `characters.css`. */
export function compileAll(files: Record<string, string>): { art: string; css: string };
/** The resting pose of one mood: 32 rows of 32 cells. */
export function stillGrid(art: MoodArt): StillGrid;
/** A window of a grid. */
export function crop(grid: StillGrid, x: number, y: number, w: number, h: number): StillGrid;
/** The resting style of each class the files draw: hidden or not, and its whole-cell translate. Refuses a resting `transform` that is not one. */
export function restingStyles(files: Record<string, string>): Map<string, { hidden: boolean; at: [number, number] }>;
