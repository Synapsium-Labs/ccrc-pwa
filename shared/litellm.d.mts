// shared/litellm.d.mts — hand-written, `shared/wrapper.d.mts`'s shape.
import type { Catalogue } from './models.js';

export declare const MODEL_LIST_MARKER: string;
export declare class LitellmTemplateInvalid extends Error {}
export declare function renderLitellmConfig(templateText: string, catalogue: Catalogue): string;
