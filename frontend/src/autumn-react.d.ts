// Types for the Autumn React island loader (`react-islands.js`).
// Copy this file into your frontend, or reference it from tsconfig.

import type { ComponentType, createElement } from 'react';
import type { Root, RootOptions } from 'react-dom/client';

/** One registration on the `window.autumnReact` queue. */
export interface AutumnReactEntry {
  createElement: typeof createElement;
  createRoot: (container: Element, options?: RootOptions) => Root;
  // Props come from server JSON, so `any` is the honest type.
  components: Record<string, ComponentType<any>>;
}

/** The loader API. Before the loader runs, the global is a plain array. */
export interface AutumnReactLoader {
  readonly loader: true;
  push(...entries: AutumnReactEntry[]): number;
  names(): string[];
}

/** `detail` of `autumn:react:mount`, `:update`, `:unmount` and `:error`. */
export interface AutumnReactEventDetail {
  name: string;
  element: Element;
  error?: unknown;
}

/** `detail` of `autumn:react:props`. */
export type AutumnReactPropsDetail =
  | { target?: string; props: Record<string, unknown> }
  | { value: Array<{ target: string; props: Record<string, unknown> }> };

declare global {
  interface Window {
    autumnReact?: AutumnReactEntry[] | AutumnReactLoader;
  }
  interface DocumentEventMap {
    'autumn:react:mount': CustomEvent<AutumnReactEventDetail>;
    'autumn:react:update': CustomEvent<AutumnReactEventDetail>;
    'autumn:react:unmount': CustomEvent<AutumnReactEventDetail>;
    'autumn:react:error': CustomEvent<AutumnReactEventDetail>;
    'autumn:react:props': CustomEvent<AutumnReactPropsDetail>;
  }
}
