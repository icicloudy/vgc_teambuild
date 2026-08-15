import type { Battler } from '../engine/battler';

/** Type colours, because a sprite sheet would be a network request and there are none here. */
const TYPE_COLOR: Record<string, string> = {
  Normal: '#a8a878', Fire: '#f0803c', Water: '#6890f0', Electric: '#f8d030',
  Grass: '#78c850', Ice: '#98d8d8', Fighting: '#c03028', Poison: '#a040a0',
  Ground: '#e0c068', Flying: '#a890f0', Psychic: '#f85888', Bug: '#a8b820',
  Rock: '#b8a038', Ghost: '#705898', Dragon: '#7038f8', Dark: '#705848',
  Steel: '#b8b8d0', Fairy: '#ee99ac',
};

export function initials(name: string): string {
  const core = name.split('-')[0];
  return core.length <= 4 ? core.slice(0, 4) : core.slice(0, 3);
}

export function Disc({ b, size = '' }: { b: Battler; size?: 'sm' | 'xs' | '' }) {
  const [a, c] = b.types;
  const one = TYPE_COLOR[a] ?? '#8b8b8b';
  const two = c ? TYPE_COLOR[c] ?? one : one;
  return (
    <span
      className={`disc ${size}`}
      style={{ background: `linear-gradient(135deg, ${one} 52%, ${two} 52%)` }}
      aria-hidden="true"
    >
      {initials(b.species)}
    </span>
  );
}

export function MonCard({
  b, picked, dim, order, lead, onClick, showSet = true, title,
}: {
  b: Battler; picked?: boolean; dim?: boolean; order?: number; lead?: boolean;
  onClick?: () => void; showSet?: boolean; title?: string;
}) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      className={`mon ${picked ? 'picked' : ''} ${dim ? 'dim' : ''} ${lead ? 'lead' : ''}`}
      onClick={onClick}
      type={onClick ? 'button' : undefined}
      title={title ?? `${b.species} @ ${b.item} · ${b.ability} · ${b.moves.map((m) => m.name).join(', ')}`}
      aria-pressed={onClick ? !!picked : undefined}
    >
      {order !== undefined && <span className="mon-order">{order}</span>}
      <Disc b={b} />
      <span className="mon-name">{b.species}</span>
      {showSet && <span className="mon-set">{b.set.label}</span>}
    </Tag>
  );
}

export function Figure({ label, value, tone }: { label: string; value: string; tone?: 'up' | 'down' }) {
  return (
    <span className="figure">
      <b className={tone ?? ''}>{value}</b>
      <span>{label}</span>
    </span>
  );
}

export const signed = (n: number) => (n >= 0 ? `+${n.toFixed(0)}` : n.toFixed(0));
export const tone = (n: number) => (n >= 0 ? 'up' : 'down') as 'up' | 'down';
