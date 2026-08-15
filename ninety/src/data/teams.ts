import { POOL, toId } from './dex';
import { battler } from '../engine/battler';
import type { Battler } from '../engine/battler';

/**
 * Teams to think with.
 *
 * Preview practice needs something on your side of the board, and a random six
 * is not a team — it has no plan, so every question about it has the same
 * answer. These are the shapes the format actually plays, built out of the same
 * measured sets as everything else, and each one respects Item Clause because a
 * team that does not is not a team you could have brought.
 */

export interface TeamMember {
  species: string;
  /** The set label from pool.json — readable, and it survives reordering. */
  set: string;
}

export interface Team {
  id: string;
  name: string;
  note: string;
  members: TeamMember[];
}

export const PRESET_TEAMS: Team[] = [
  {
    id: 'sun',
    name: 'Sun Offense',
    note: 'The most common core in the format — Mega Charizard Y and Garchomp are on 20.6% of teams together — with the standard glue behind it.',
    members: [
      { species: 'Charizard', set: 'Charizardite Y' },
      { species: 'Garchomp', set: 'Life Orb' },
      { species: 'Incineroar', set: 'Sitrus Berry' },
      { species: 'Whimsicott', set: 'Focus Sash' },
      { species: 'Sinistcha', set: 'Kasib Berry' },
      { species: 'Kingambit', set: 'Black Glasses' },
    ],
  },
  {
    id: 'rain',
    name: 'Rain',
    note: 'Drizzle turns three of these six on at once: Electro Shot charges in a turn, Swift Swim doubles Speed, Hurricane stops missing.',
    members: [
      { species: 'Pelipper', set: 'Damp Rock' },
      { species: 'Archaludon', set: 'Leftovers' },
      { species: 'Swampert', set: 'Swampertite' },
      { species: 'Basculegion', set: 'Choice Scarf' },
      { species: 'Incineroar', set: 'Sitrus Berry' },
      { species: 'Whimsicott', set: 'Focus Sash' },
    ],
  },
  {
    id: 'room',
    name: 'Trick Room',
    note: 'Two setters so the room actually goes up, and four Pokémon that would rather be last.',
    members: [
      { species: 'Farigiraf', set: 'Sitrus Berry' },
      { species: 'Sinistcha', set: 'Kasib Berry' },
      { species: 'Mimikyu', set: 'Focus Sash' },
      { species: 'Kingambit', set: 'Chople Berry' },
      { species: 'Gholdengo', set: 'Covert Cloak' },
      { species: 'Metagross', set: 'Metagrossite' },
    ],
  },
  {
    id: 'tailwind',
    name: 'Tailwind Offense',
    note: 'Four turns of moving first, and six Pokémon that all want them.',
    members: [
      { species: 'Whimsicott', set: 'Focus Sash' },
      { species: 'Aerodactyl', set: 'Aerodactylite' },
      { species: 'Sneasler', set: 'Unburden' },
      { species: 'Floette-Eternal', set: 'Floettite' },
      { species: 'Incineroar', set: 'Sitrus Berry' },
      { species: 'Basculegion', set: 'Mystic Water' },
    ],
  },
  {
    id: 'balance',
    name: 'Balance',
    note: 'No plan to set up and nothing to turn on: it just has an answer to most things and outlasts the ones it does not.',
    members: [
      { species: 'Milotic', set: 'Sitrus Berry' },
      { species: 'Incineroar', set: 'Chople Berry' },
      { species: 'Garchomp', set: 'Life Orb' },
      { species: 'Gholdengo', set: 'Covert Cloak' },
      { species: 'Whimsicott', set: 'Focus Sash' },
      { species: 'Staraptor', set: 'Staraptite' },
    ],
  },
  {
    id: 'screens',
    name: 'Screens Offense',
    note: 'Prankster screens on turn one, then five turns in which nothing you take is full price.',
    members: [
      { species: 'Grimmsnarl', set: 'Light Clay' },
      { species: 'Raichu', set: 'Raichunite Y' },
      { species: 'Sneasler', set: 'Unburden' },
      { species: 'Kingambit', set: 'Black Glasses' },
      { species: 'Garchomp', set: 'Life Orb' },
      { species: 'Sylveon', set: 'Fairy Feather' },
    ],
  },
  {
    id: 'fairy',
    name: 'Fairy Spam',
    note: 'Two spread Fairy moves and a Helping Hand, into a format where Kingambit, Garchomp and Basculegion are all in the top four.',
    members: [
      { species: 'Floette-Eternal', set: 'Floettite' },
      { species: 'Sylveon', set: 'Fairy Feather' },
      { species: 'Farigiraf', set: 'Sitrus Berry' },
      { species: 'Incineroar', set: 'Chople Berry' },
      { species: 'Maushold', set: 'Wide Lens' },
      { species: 'Garchomp', set: 'Life Orb' },
    ],
  },
  {
    id: 'bulkyoffense',
    name: 'Bulky Offense',
    note: 'Slow, heavy, and happy to be hit — the team that beats the ones built to move first.',
    members: [
      { species: 'Metagross', set: 'Metagrossite' },
      { species: 'Sinistcha', set: 'Sitrus Berry' },
      { species: 'Kingambit', set: 'Black Glasses' },
      { species: 'Basculegion', set: 'Choice Scarf' },
      { species: 'Pelipper', set: 'Focus Sash' },
      { species: 'Scrafty', set: 'Chople Berry' },
    ],
  },
];

/** Resolve a team into concrete Battlers, or throw with a readable reason. */
export function resolveTeam(team: Team): Battler[] {
  return team.members.map((member) => {
    const entry = POOL.find((p) => toId(p.species) === toId(member.species));
    if (!entry) throw new Error(`${team.name}: ${member.species} is not in the pool`);
    const index = entry.sets.findIndex((s) => s.label === member.set);
    if (index < 0) {
      throw new Error(
        `${team.name}: ${member.species} has no "${member.set}" set ` +
        `(has ${entry.sets.map((s) => s.label).join(', ')})`,
      );
    }
    return battler(entry, index);
  });
}

/** Item Clause is a rule, so a team that breaks it is a bug, not a preference. */
export function itemClauseBreaks(team: Battler[]): string[] {
  const seen = new Map<string, string>();
  const out: string[] = [];
  for (const b of team) {
    const prior = seen.get(b.itemId);
    if (prior) out.push(`${prior} and ${b.species} both hold ${b.item}`);
    else seen.set(b.itemId, b.species);
  }
  return out;
}

/** Species Clause, same reasoning. */
export function speciesClauseBreaks(team: Battler[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const b of team) {
    if (seen.has(b.species)) out.push(`${b.species} appears twice`);
    seen.add(b.species);
  }
  return out;
}
