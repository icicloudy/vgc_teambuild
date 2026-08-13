import { useEffect, useState } from 'react';
import { learnsetSync, loadLearnset } from '../data/dex';

/** Movepool for a species, resolved lazily and cached across the app. */
export function useLearnset(species: string): string[] {
  const [moves, setMoves] = useState<string[]>(() => learnsetSync(species) ?? []);
  useEffect(() => {
    let cancelled = false;
    setMoves(learnsetSync(species) ?? []);
    loadLearnset(species).then((m) => { if (!cancelled) setMoves(m); });
    return () => { cancelled = true; };
  }, [species]);
  return moves;
}
