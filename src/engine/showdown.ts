import type { PokemonSet, StatID, StatsTable } from '../types';
import { STATS, emptySP } from '../types';
import { getAbility, getItem, getMove, getNature, getSpecies, toID } from '../data/dex';
import { MAX_SP_PER_STAT, MAX_SP_TOTAL } from './stats';

const STAT_ALIASES: Record<string, StatID> = {
  hp: 'hp', atk: 'atk', def: 'def', spa: 'spa', spd: 'spd', spe: 'spe',
  'special attack': 'spa', 'special defense': 'spd', speed: 'spe', attack: 'atk', defense: 'def',
};

let uid = 0;
export function newId(): string {
  uid += 1;
  return `set-${Date.now().toString(36)}-${uid}`;
}

export function emptySet(species = ''): PokemonSet {
  const s = getSpecies(species);
  return {
    id: newId(),
    species: s?.name ?? species,
    nickname: '',
    item: '',
    ability: s ? s.abilities[0] : '',
    level: 50,
    nature: 'Serious',
    sp: emptySP(),
    moves: ['', '', '', ''],
  };
}

/* ------------------------------------------------------------------ *
 * Export
 * ------------------------------------------------------------------ */

function statLine(stats: StatsTable): string {
  const parts: string[] = [];
  for (const s of STATS) {
    const v = stats[s] ?? 0;
    if (!v) continue;
    parts.push(`${v} ${labelOf(s)}`);
  }
  return parts.join(' / ');
}

/**
 * A Showdown paste carries EVs. At Level 50 an EV contributes floor(EV/8) to the
 * stat, which is exactly what one Stat Point is worth, so that is the conversion —
 * 252 EVs become 31 points, and a 4-EV filler becomes nothing.
 */
export function evsToSP(evs: Partial<StatsTable>): StatsTable {
  const sp = emptySP();
  for (const s of STATS) {
    sp[s] = Math.min(MAX_SP_PER_STAT, Math.floor((evs[s] ?? 0) / 8));
  }
  // Legacy spreads can exceed the Champions budget; trim the largest first so the
  // shape of the spread survives.
  let over = STATS.reduce((n, s) => n + sp[s], 0) - MAX_SP_TOTAL;
  while (over > 0) {
    const biggest = STATS.reduce((a, b) => (sp[a] >= sp[b] ? a : b));
    if (sp[biggest] === 0) break;
    sp[biggest] -= 1;
    over -= 1;
  }
  return sp;
}

function labelOf(s: StatID): string {
  return { hp: 'HP', atk: 'Atk', def: 'Def', spa: 'SpA', spd: 'SpD', spe: 'Spe' }[s];
}

export function exportSet(set: PokemonSet): string {
  const lines: string[] = [];
  const species = getSpecies(set.species)?.name ?? set.species;
  const head = set.nickname && set.nickname !== species ? `${set.nickname} (${species})` : species;
  const gender = set.gender && set.gender !== 'N' ? ` (${set.gender})` : '';
  lines.push(`${head}${gender}${set.item ? ` @ ${getItem(set.item)?.name ?? set.item}` : ''}`);
  if (set.ability) lines.push(`Ability: ${set.ability}`);
  if (set.level !== 100) lines.push(`Level: ${set.level}`);
  if (set.shiny) lines.push('Shiny: Yes');
  if (set.teraType) lines.push(`Tera Type: ${set.teraType}`);

  const spLine = statLine(set.sp);
  if (spLine) lines.push(`SP: ${spLine}`);
  if (set.nature) lines.push(`${set.nature} Nature`);

  for (const move of set.moves) {
    if (move) lines.push(`- ${getMove(move)?.name ?? move}`);
  }
  return lines.join('\n');
}

export function exportTeam(sets: PokemonSet[]): string {
  return sets.map(exportSet).join('\n\n');
}

/* ------------------------------------------------------------------ *
 * Import
 * ------------------------------------------------------------------ */

export interface ImportResult {
  sets: PokemonSet[];
  errors: string[];
}

export function importTeam(text: string): ImportResult {
  const errors: string[] = [];
  const blocks = text
    .replace(/\r/g, '')
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean);

  const sets: PokemonSet[] = [];
  for (const block of blocks) {
    const parsed = importSet(block, errors);
    if (parsed) sets.push(parsed);
  }
  if (!sets.length && text.trim()) errors.push('No Pokémon could be read from that paste.');
  return { sets, errors };
}

function importSet(block: string, errors: string[]): PokemonSet | null {
  const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return null;

  const set = emptySet();
  set.nature = 'Serious';

  // Header: "Nickname (Species) (M) @ Item"
  let header = lines[0];
  let item = '';
  const atIndex = header.lastIndexOf(' @ ');
  if (atIndex >= 0) {
    item = header.slice(atIndex + 3).trim();
    header = header.slice(0, atIndex).trim();
  }
  const genderMatch = /\((M|F)\)\s*$/.exec(header);
  if (genderMatch) {
    set.gender = genderMatch[1] as 'M' | 'F';
    header = header.slice(0, genderMatch.index).trim();
  }
  let speciesName = header;
  let nickname = '';
  const parenMatch = /^(.*)\s+\(([^)]+)\)$/.exec(header);
  if (parenMatch) {
    nickname = parenMatch[1].trim();
    speciesName = parenMatch[2].trim();
  }

  const species = getSpecies(speciesName);
  if (!species) {
    errors.push(`Unknown Pokémon: "${speciesName}"`);
    return null;
  }
  // A Mega forme in the paste becomes base species + stone.
  if (species.forme?.startsWith('Mega')) {
    const base = getSpecies(species.baseSpecies ?? species.name);
    set.species = base?.name ?? species.name;
    if (species.requiredItem && !item) item = species.requiredItem;
  } else {
    set.species = species.name;
  }
  set.nickname = nickname && toID(nickname) !== toID(set.species) ? nickname : '';

  if (item) {
    const resolved = getItem(item);
    if (!resolved) errors.push(`Unknown item: "${item}"`);
    set.item = resolved?.name ?? item;
  }

  const moves: string[] = [];
  for (const line of lines.slice(1)) {
    if (line.startsWith('-') || line.startsWith('~')) {
      const raw = line.slice(1).trim().split('/')[0].trim();
      const move = getMove(raw);
      if (!move) errors.push(`Unknown move: "${raw}"`);
      moves.push(move ? move.name : raw);
      continue;
    }
    const colon = line.indexOf(':');
    const key = colon >= 0 ? line.slice(0, colon).trim().toLowerCase() : '';
    const value = colon >= 0 ? line.slice(colon + 1).trim() : '';

    switch (key) {
      case 'ability': set.ability = getAbility(value)?.name ?? value; break;
      case 'level': set.level = Number(value) || 50; break;
      case 'shiny': set.shiny = /yes|true/i.test(value); break;
      case 'happiness': set.happiness = Number(value) || undefined; break;
      case 'tera type': set.teraType = value; break;
      case 'sp': applyStats(set.sp, value, 0); break;
      case 'evs': {
        // A Scarlet/Violet paste: convert its EVs into the Champions budget.
        const evs = emptySP();
        applyStats(evs, value, 0);
        set.sp = evsToSP(evs);
        break;
      }
      case 'ivs': break; // Champions has no IVs — everything behaves as 31.
      case 'gender': set.gender = (value.toUpperCase()[0] as 'M' | 'F' | 'N') ?? 'N'; break;
      default: {
        const nature = /^([A-Za-z]+)\s+Nature$/i.exec(line);
        const resolved = nature && getNature(nature[1]);
        if (resolved) set.nature = resolved.name;
      }
    }
  }

  if (!set.ability) set.ability = species.abilities[0];
  set.moves = [moves[0] ?? '', moves[1] ?? '', moves[2] ?? '', moves[3] ?? ''];
  return set;
}

function applyStats(target: StatsTable, value: string, fallback: number) {
  for (const s of STATS) target[s] = fallback;
  for (const chunk of value.split('/')) {
    const m = /^\s*(\d+)\s+([A-Za-z ]+?)\s*[+-]?\s*$/.exec(chunk);
    if (!m) continue;
    const stat = STAT_ALIASES[m[2].trim().toLowerCase()];
    if (stat) target[stat] = Number(m[1]);
  }
}
