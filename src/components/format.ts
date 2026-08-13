/** Colour bucket for a damage percentage, shared by every damage read-out. */
export function damageTone(pct: number): string {
  if (pct >= 100) return 'ko';
  if (pct >= 50) return 'high';
  if (pct >= 25) return 'mid';
  if (pct > 0) return 'low';
  return 'none';
}
