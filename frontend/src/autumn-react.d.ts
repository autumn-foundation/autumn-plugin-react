// Types for the Autumn React island loader (`react-islands.js`).
// Copy this file into your frontend, or reference it from tsconfig.

import type { ComponentType, createElement } from 'react';
import type { flushSync } from 'react-dom';
import type { Root, RootOptions } from 'react-dom/client';

/** One registration on the `window.autumnReact` queue. */
export interface AutumnReactEntry {
  createElement: typeof createElement;
  createRoot: (container: Element, options?: RootOptions) => Root;
  /** Optional. With it, the loader events fire after React commits. */
  flushSync?: typeof flushSync;
  /** Optional. React's `version`. The loader refuses React before 19. */
  version?: string;
  // Props come from server JSON. The loader cannot check their types.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

/** One props update. Without `target`, the event target is the island. */
export interface AutumnReactPropsUpdate {
  target?: string;
  props: Record<string, unknown>;
}

/** `detail` of `autumn:react:props`: one update, or a list from htmx. */
export type AutumnReactPropsDetail = AutumnReactPropsUpdate | { value: AutumnReactPropsUpdate[] };

interface AutumnReactEventMap {
  'autumn:react:mount': CustomEvent<AutumnReactEventDetail>;
  'autumn:react:update': CustomEvent<AutumnReactEventDetail>;
  'autumn:react:unmount': CustomEvent<AutumnReactEventDetail>;
  'autumn:react:error': CustomEvent<AutumnReactEventDetail>;
  'autumn:react:props': CustomEvent<AutumnReactPropsDetail>;
}

declare global {
  interface Window {
    autumnReact?: AutumnReactEntry[] | AutumnReactLoader;
  }
  // The events bubble from the island element to `document`.
  interface DocumentEventMap extends AutumnReactEventMap {}
  interface HTMLElementEventMap extends AutumnReactEventMap {}
}
