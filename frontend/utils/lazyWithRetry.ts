import React from 'react';

/** Waits this long before the one retry (a flaky connection, or a deploy that is still being copied). */
export const RETRY_DELAY_MS = 400;

/** Marks a failure of the page file itself (an old tab after a new release, or no connection). The error screen offers a reload for it. */
export class ChunkLoadError extends Error {
  readonly cause: unknown;
  constructor(cause: unknown) {
    super('The page file could not be loaded.');
    this.name = 'ChunkLoadError';
    this.cause = cause;
  }
}

/** Runs a dynamic import; when it fails, tries once more after a short wait, then throws a ChunkLoadError. */
export async function retryImport<T>(load: () => Promise<T>, delayMs: number = RETRY_DELAY_MS): Promise<T> {
  try {
    return await load();
  } catch (first) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    try {
      return await load();
    } catch (second) {
      throw new ChunkLoadError(second ?? first);
    }
  }
}

/** React.lazy with one retry. The loader stays reachable so the same import can be started early (prefetch). */
export function lazyWithRetry<T extends React.ComponentType<any>>(load: () => Promise<{ default: T }>) {
  return React.lazy(() => retryImport(load));
}
