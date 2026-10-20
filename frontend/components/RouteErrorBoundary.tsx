import React from 'react';
import { ChunkLoadError } from '../utils/lazyWithRetry';

interface Props {
  /** Changes when the visitor moves to another page; a shown error is cleared then. */
  resetKey?: string;
  children: React.ReactNode;
}
interface State { error: unknown }

/** True for a page file that could not be fetched (an old tab after a release, or no connection). */
export function isChunkFailure(error: unknown): boolean {
  if (error instanceof ChunkLoadError) return true;
  const msg = String((error as any)?.message || error || '');
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|ChunkLoadError/i.test(msg);
}

/** Catches a page that fails to load or to draw, so the shell stays and the visitor is never left on a blank screen. */
export default class RouteErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error };
  }

  componentDidCatch(error: unknown) {
    console.error('Page failed', error);
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const stale = isChunkFailure(error);
    return (
      <div role="alert" className="mx-auto max-w-md py-16 text-center">
        <h2 className="text-lg font-semibold text-[var(--gv-text-primary)]">
          {stale ? 'Nebulaa has been updated' : 'This page could not open'}
        </h2>
        <p className="mt-2 text-sm text-[var(--gv-text-secondary)]">
          {stale
            ? 'A newer version is ready. Reload to continue; your work on other pages is saved.'
            : 'Something went wrong while opening this page. Reloading usually fixes it.'}
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-5 rounded-full bg-[var(--gv-accent)] px-5 py-2 text-sm font-semibold text-[#14203A]"
        >
          Reload
        </button>
      </div>
    );
  }
}
