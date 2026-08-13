import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { spriteUrl } from '../data/dex';
import { displayName } from '../engine/calc';

/* ------------------------------------------------------------------ *
 * Sprite with graceful fallback (Champions-exclusive Megas have no
 * upstream sprite yet, and the app works fully offline).
 * ------------------------------------------------------------------ */

export function Sprite({
  species, size = 40, className = '',
}: { species: string; size?: number; className?: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [species]);

  const label = displayName(species);
  const initials = label
    .replace(/^Mega /, '')
    .split(/[\s-]/)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();

  if (!species) {
    return <span className={`sprite sprite-empty ${className}`} style={{ width: size, height: size }} />;
  }
  if (failed) {
    return (
      <span
        className={`sprite sprite-fallback ${className}`}
        style={{ width: size, height: size, fontSize: size * 0.34 }}
        title={label}
      >
        {initials}
      </span>
    );
  }
  return (
    <img
      className={`sprite ${className}`}
      style={{ width: size, height: size }}
      src={spriteUrl(species)}
      alt={label}
      title={label}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

/* ------------------------------------------------------------------ */

export function TypeBadge({ type, small = false }: { type: string; small?: boolean }) {
  if (!type) return null;
  return (
    <span className={`type type-${type.toLowerCase()} ${small ? 'type-sm' : ''}`}>{type}</span>
  );
}

export function Pill({
  tone = 'neutral', children, title,
}: { tone?: string; children: ReactNode; title?: string }) {
  return <span className={`pill pill-${tone}`} title={title}>{children}</span>;
}

/* ------------------------------------------------------------------ *
 * Searchable combobox
 * ------------------------------------------------------------------ */

export interface ComboOption {
  value: string;
  label: string;
  sublabel?: ReactNode;
  right?: ReactNode;
  group?: string;
  keywords?: string;
  disabled?: boolean;
}

export function Combobox({
  value, options, onChange, placeholder = 'Search…', allowClear = true, renderValue, compact,
}: {
  value: string;
  options: ComboOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  allowClear?: boolean;
  renderValue?: (value: string) => ReactNode;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // Only auto-scroll for keyboard navigation: scrolling on hover would move the
  // list out from under the pointer between mousedown and mouseup.
  const keyboardNav = useRef(false);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options.slice(0, 300);
    const scored = options
      .map((o) => {
        const hay = `${o.label} ${o.keywords ?? ''}`.toLowerCase();
        const idx = hay.indexOf(q);
        if (idx < 0) return null;
        return { o, score: (o.label.toLowerCase().startsWith(q) ? 0 : 1) * 100 + idx };
      })
      .filter(Boolean) as { o: ComboOption; score: number }[];
    return scored.sort((a, b) => a.score - b.score).slice(0, 300).map((s) => s.o);
  }, [options, query]);

  useEffect(() => setCursor(0), [query, open]);
  useEffect(() => {
    if (!keyboardNav.current) return;
    const el = listRef.current?.querySelector<HTMLElement>('[data-active="true"]');
    el?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  const commit = (v: string) => {
    onChange(v);
    setOpen(false);
    setQuery('');
  };

  return (
    <div className={`combo ${compact ? 'combo-compact' : ''}`} ref={rootRef}>
      <button
        type="button"
        className={`combo-value ${open ? 'is-open' : ''} ${value ? '' : 'is-empty'}`}
        // Toggle on mousedown, not click: selecting an option unmounts the list
        // mid-gesture and the browser then retargets the trailing click at this
        // button, which would immediately reopen the dropdown.
        onMouseDown={(e) => { e.preventDefault(); setOpen((o) => !o); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen((o) => !o); }
        }}
      >
        {renderValue ? renderValue(value) : <span>{value || placeholder}</span>}
        <span className="combo-caret">▾</span>
      </button>

      {open && (
        <div className="combo-pop">
          <input
            autoFocus
            className="combo-input"
            value={query}
            placeholder={placeholder}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                keyboardNav.current = true;
                setCursor((c) => Math.min(c + 1, filtered.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                keyboardNav.current = true;
                setCursor((c) => Math.max(c - 1, 0));
              }
              else if (e.key === 'Enter') { e.preventDefault(); const o = filtered[cursor]; if (o && !o.disabled) commit(o.value); }
              else if (e.key === 'Escape') { setOpen(false); }
            }}
          />
          <div className="combo-list" ref={listRef}>
            {allowClear && (
              <button type="button" className="combo-opt combo-clear" onClick={() => commit('')}>
                (none)
              </button>
            )}
            {filtered.map((o, i) => (
              <button
                type="button"
                key={o.value + i}
                data-active={i === cursor}
                className={`combo-opt ${o.disabled ? 'is-disabled' : ''} ${i === cursor ? 'is-active' : ''}`}
                onMouseEnter={() => { keyboardNav.current = false; setCursor(i); }}
                onClick={() => !o.disabled && commit(o.value)}
              >
                <span className="combo-opt-main">
                  <span className="combo-opt-label">{o.label}</span>
                  {o.sublabel && <span className="combo-opt-sub">{o.sublabel}</span>}
                </span>
                {o.right && <span className="combo-opt-right">{o.right}</span>}
              </button>
            ))}
            {!filtered.length && <div className="combo-empty">No matches</div>}
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

export function StatBar({ value, max = 255, tone }: { value: number; max?: number; tone?: string }) {
  const pct = Math.max(2, Math.min(100, (value / max) * 100));
  return (
    <span className="statbar">
      <span className={`statbar-fill ${tone ? `statbar-${tone}` : ''}`} style={{ width: `${pct}%` }} />
    </span>
  );
}

export function Toggle({
  checked, onChange, label, title,
}: { checked: boolean; onChange: (v: boolean) => void; label: string; title?: string }) {
  return (
    <button
      type="button"
      title={title}
      className={`toggle ${checked ? 'is-on' : ''}`}
      onClick={() => onChange(!checked)}
    >
      {label}
    </button>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="field">
      <span className="field-label">
        {label}
        {hint && <span className="field-hint" title={hint}>?</span>}
      </span>
      {children}
    </label>
  );
}

export function Section({
  title, subtitle, children, actions,
}: { title: string; subtitle?: ReactNode; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="panel">
      <header className="panel-head">
        <div>
          <h2>{title}</h2>
          {subtitle && <p className="panel-sub">{subtitle}</p>}
        </div>
        {actions && <div className="panel-actions">{actions}</div>}
      </header>
      {children}
    </section>
  );
}
