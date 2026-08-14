import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { getSpecies, spriteUrl } from '../data/dex';
import { displayName } from '../engine/calc';

/* ------------------------------------------------------------------ *
 * Sprite with graceful fallback: Champions-exclusive Megas have no
 * upstream sprite yet, the app must work offline, and a sandboxed embed
 * may block remote images entirely. The fallback is type-coloured so it
 * still carries information rather than looking like a broken image.
 * ------------------------------------------------------------------ */

/** Builds without remote sprites (single-file/embedded builds) skip the request. */
const REMOTE_SPRITES = import.meta.env.VITE_OFFLINE_SPRITES !== '1';

const TYPE_COLORS: Record<string, string> = {
  normal: '#a8a878', fire: '#f0803c', water: '#6890f0', electric: '#f8d030',
  grass: '#78c850', ice: '#98d8d8', fighting: '#c03028', poison: '#a040a0',
  ground: '#e0c068', flying: '#a890f0', psychic: '#f85888', bug: '#a8b820',
  rock: '#b8a038', ghost: '#705898', dragon: '#7038f8', dark: '#705848',
  steel: '#b8b8d0', fairy: '#ee99ac',
};

function SpriteFallback({
  species, label, size, className,
}: { species: string; label: string; size: number; className: string }) {
  const initials = label
    .replace(/^Mega /, '')
    .split(/[\s-]/)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();

  const types = getSpecies(species)?.types ?? [];
  const a = TYPE_COLORS[(types[0] ?? '').toLowerCase()] ?? 'var(--line-2)';
  const b = TYPE_COLORS[(types[1] ?? types[0] ?? '').toLowerCase()] ?? a;

  return (
    <span
      className={`sprite sprite-fallback ${className}`}
      style={{
        width: size,
        height: size,
        fontSize: size * 0.34,
        background: `linear-gradient(135deg, ${a} 0%, ${a} 50%, ${b} 50%, ${b} 100%)`,
      }}
      title={label}
    >
      <span className="sprite-initials">{initials}</span>
    </span>
  );
}

export function Sprite({
  species, size = 40, className = '',
}: { species: string; size?: number; className?: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [species]);

  const label = displayName(species);

  if (!species) {
    return <span className={`sprite sprite-empty ${className}`} style={{ width: size, height: size }} />;
  }
  if (failed || !REMOTE_SPRITES) {
    return <SpriteFallback species={species} label={label} size={size} className={className} />;
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
  /** Stable identifier, so a caller can match options against its own data. */
  id?: string;
}

export function Combobox({
  value, options, onChange, placeholder = 'Search…', allowClear = true, renderValue, compact,
  search, renderHeader,
}: {
  value: string;
  options: ComboOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  allowClear?: boolean;
  renderValue?: (value: string) => ReactNode;
  compact?: boolean;
  /** Replaces the default substring match, for callers with a richer query language. */
  search?: (query: string, options: ComboOption[]) => ComboOption[];
  /** Rendered under the input — used to show which filters a query parsed into. */
  renderHeader?: (query: string, matches: number) => ReactNode;
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
      if (!rootRef.current?.contains(e.target as Node)) close();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const filtered = useMemo(() => {
    if (search) return search(query, options).slice(0, 300);
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
  }, [options, query, search]);

  useEffect(() => setCursor(0), [query, open]);
  useEffect(() => {
    if (!keyboardNav.current) return;
    const el = listRef.current?.querySelector<HTMLElement>('[data-active="true"]');
    el?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  // Closing always drops the query: reopening a picker still filtered by what you
  // typed a minute ago looks like a broken list.
  const close = () => {
    setOpen(false);
    setQuery('');
  };

  const commit = (v: string) => {
    onChange(v);
    close();
  };

  return (
    <div className={`combo ${compact ? 'combo-compact' : ''}`} ref={rootRef}>
      <button
        type="button"
        className={`combo-value ${open ? 'is-open' : ''} ${value ? '' : 'is-empty'}`}
        // Toggle on mousedown, not click: selecting an option unmounts the list
        // mid-gesture and the browser then retargets the trailing click at this
        // button, which would immediately reopen the dropdown.
        onMouseDown={(e) => { e.preventDefault(); if (open) close(); else setOpen(true); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            if (open) close(); else setOpen(true);
          }
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
              else if (e.key === 'Escape') { close(); }
            }}
          />
          {renderHeader?.(query, filtered.length)}
          <div className="combo-list" ref={listRef}>
            {allowClear && (
              <button type="button" className="combo-opt combo-clear" onClick={() => commit('')}>
                (none)
              </button>
            )}
            {filtered.map((o, i) => (
              <Fragment key={o.value + i}>
                {o.group && o.group !== filtered[i - 1]?.group && (
                  <div className="combo-group">{o.group}</div>
                )}
              <button
                type="button"
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
              </Fragment>
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
