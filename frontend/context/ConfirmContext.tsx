import React, { createContext, useCallback, useContext, useRef, useState } from 'react';

/**
 * In-app replacement for window.confirm().
 *
 * window.confirm() silently no-ops in some of the contexts Gravity actually
 * runs in (embedded/sandboxed webviews block native dialogs entirely —
 * no popup, and the call returns false immediately, which reads as "user
 * cancelled" even though no one saw anything). Every "Regenerate" button
 * across the app was built on window.confirm() and was silently doing
 * nothing as a result. This renders an actual React modal instead, so the
 * confirmation is guaranteed to be visible regardless of the host context.
 */

interface ConfirmOptions {
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

type ConfirmFn = (message: string, options?: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

export const useConfirm = (): ConfirmFn => {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm must be used within a ConfirmProvider');
  return ctx;
};

export const ConfirmProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, setState] = useState<{ message: string; options: ConfirmOptions } | null>(null);
  const resolveRef = useRef<((value: boolean) => void) | null>(null);

  const confirm: ConfirmFn = useCallback((message, options = {}) => {
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve;
      setState({ message, options });
    });
  }, []);

  const settle = (value: boolean) => {
    resolveRef.current?.(value);
    resolveRef.current = null;
    setState(null);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {state && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm px-4"
          onClick={() => settle(false)}
        >
          <div
            className="w-full max-w-[420px] rounded-2xl border border-white/[0.10] bg-[#151515] p-6 shadow-[0_20px_60px_rgba(0,0,0,0.6)]"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="font-serif-display text-[20px] text-[#F5F4F1] mb-2">
              {state.options.title || 'Are you sure?'}
            </h2>
            <p className="text-[13.5px] text-white/60 leading-relaxed mb-6">{state.message}</p>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => settle(false)}
                className="h-10 px-4 rounded-lg text-[13px] font-semibold text-white/60 hover:text-white hover:bg-white/[0.06] transition-colors"
              >
                {state.options.cancelLabel || 'Cancel'}
              </button>
              <button
                type="button"
                autoFocus
                onClick={() => settle(true)}
                className={`h-10 px-4 rounded-lg text-[13px] font-semibold transition-colors ${
                  state.options.danger
                    ? 'bg-red-500/90 hover:bg-red-500 text-white'
                    : 'bg-[#F5A623] hover:bg-[#ffb833] text-[#1A1208]'
                }`}
              >
                {state.options.confirmLabel || 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
};
