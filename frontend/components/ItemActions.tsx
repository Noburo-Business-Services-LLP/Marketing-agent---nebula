import React, { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useConfirm } from '../context/ConfirmContext';
import { MoreMenu } from './PostActions';
import type { ConfirmText } from '../utils/postActions';
import './postActions.css';

/**
 * The post buttons' look (components/PostActions.tsx) for things that are not posts: studio videos and Photoshoot
 * photos. They cannot be scheduled or posted from Nebulaa, so they only get the actions they really have (Download,
 * Make again with its price, Use in Create, Delete or Remove), in the same order and the same style as a post:
 *   variant "row"     every action as a button, the danger ones in "More"
 *   variant "compact" the main button and "More" (tiles)
 * Make again and Delete ask first (confirm); the price is on the button and in the question.
 */
export interface ItemAction {
  key: string;
  label: string;
  /** a short line for the tooltip, screen readers and the menu */
  hint: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  primary?: boolean;
  /** the Quark amount shown on the button (Make again) */
  quarks?: number;
  /** red in the menu; always sits in "More" */
  danger?: boolean;
  disabled?: boolean;
  /** why it cannot be used now, in plain words */
  reason?: string;
  /** asked before it runs */
  confirm?: ConfirmText;
  /** compact only: kept beside the main button as a small icon button instead of going into "More" */
  pin?: boolean;
  onRun: () => void | Promise<void>;
}

const ItemActions: React.FC<{ items: ItemAction[]; variant?: 'row' | 'compact'; name: string; className?: string }> = ({ items, variant = 'row', name, className = '' }) => {
  const confirm = useConfirm();
  const [busy, setBusy] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  if (!items.length) return null;

  const run = async (a: ItemAction) => {
    setMenuOpen(false);
    if (busy || a.disabled) return;
    if (a.confirm) {
      const ok = await confirm(a.confirm.message, { title: a.confirm.title, confirmLabel: a.confirm.confirmLabel, danger: a.confirm.danger });
      if (!ok) return;
    }
    setBusy(a.key);
    try { await a.onRun(); } finally { setBusy(''); }
  };

  const main = items.find((a) => a.primary) || items.find((a) => !a.danger && !a.disabled);
  const buttons = variant === 'compact' ? items.filter((a) => a === main || (a.pin && !a.danger)) : items.filter((a) => !a.danger);
  const inMenu = items.filter((a) => !buttons.includes(a));

  return (
    <div className={`nb-pa ${className}`} data-variant={variant} data-testid="item-actions">
      <div className="nb-pa-row" role="group" aria-label={`Actions for ${name}`}>
        {buttons.map((a) => {
          const Icon = a.icon;
          const iconOnly = variant === 'compact' && a !== main;
          return (
            <button
              key={a.key}
              type="button"
              className="nb-pa-btn"
              data-action={a.key}
              data-primary={a === main ? 'true' : undefined}
              data-icon-only={iconOnly ? 'true' : undefined}
              data-locked={a.disabled ? 'true' : undefined}
              aria-disabled={a.disabled || undefined}
              disabled={Boolean(busy) && busy !== a.key}
              title={a.disabled ? a.reason : a.hint}
              aria-label={`${a.label} ${name}${a.disabled && a.reason ? `. ${a.reason}` : ''}`}
              onClick={() => run(a)}
            >
              {busy === a.key ? <Loader2 className="nb-pa-ico animate-spin" aria-hidden="true" /> : <Icon className="nb-pa-ico" aria-hidden="true" />}
              {!iconOnly && <span className="nb-pa-word">{a.label}</span>}
              {a.quarks && !iconOnly ? <span className="nb-pa-price">{a.quarks.toLocaleString('en-IN')} Quarks</span> : null}
            </button>
          );
        })}
        {inMenu.length > 0 && (
          <MoreMenu
            items={inMenu.map((a) => ({ key: a.key, label: a.label, hint: a.hint, reason: a.reason || '', disabled: Boolean(a.disabled), quarks: a.quarks, icon: a.icon, danger: a.danger }))}
            open={menuOpen}
            setOpen={setMenuOpen}
            onRun={(m: { key: string }) => { const a = inMenu.find((x) => x.key === m.key); if (a) run(a); }}
            busy={busy}
            name={name}
          />
        )}
      </div>
    </div>
  );
};

export default ItemActions;
