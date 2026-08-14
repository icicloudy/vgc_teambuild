import type { FormatRules } from '../types';

/**
 * Pokémon Champions regulation sets.
 *
 * Rules encoded here come from the public regulation announcements (see
 * `sourceNotes` on each entry and README.md). Anything the app cannot verify
 * offline — most importantly the exact in-game species roster — is treated as a
 * *warning*, never a hard error, and can be corrected from the Roster panel.
 */

const CHAMPIONS_COMMON = {
  level: 50,
  speciesClause: true,
  itemClause: true,
  megaPerBattle: 1,
  teraAllowed: false,
  bannedItems: [] as string[],
  bannedMoves: [] as string[],
  itemPool: 'champions' as const,
};

export const FORMATS: FormatRules[] = [
  {
    ...CHAMPIONS_COMMON,
    id: 'champs-mb-doubles',
    name: 'Champions VGC — Regulation Set M-B (Doubles)',
    shortName: 'Reg M-B Doubles',
    window: 'June 17 – September 9, 2026',
    active: true,
    gameType: 'Doubles',
    bring: 6,
    pick: 4,
    excludedCategories: ['restricted', 'sublegendary', 'mythical', 'paradox', 'ultrabeast'],
    bannedSpecies: ['Salamence-Mega'],
    bannedMegas: ['Lucario-Mega-Z', 'Garchomp-Mega-Z'],
    notes: [
      'Bring 6, pick 4. Doubles. All Pokémon are set to Level 50.',
      'Species Clause: no two Pokémon with the same Pokédex number.',
      'Item Clause: no two Pokémon holding the same item.',
      'You may carry several Mega Stones, but only one Pokémon may Mega Evolve per battle.',
      'No Restricted, Legendary, Mythical, Paradox or Treasures of Ruin Pokémon.',
      'Mega Lucario Z and Mega Garchomp Z are not legal in ranked play.',
      'Held items are limited to the pool Champions ships: no Assault Vest, Choice Band or Weakness Policy.',
    ],
    sourceNotes:
      'Rules per the Regulation Set M-B announcement (Pokémon.com / Serebii / Victory Road, June 2026); ' +
      'the window was extended to September 9 during the August 5 update. The 208-species roster is ' +
      'not published in machine-readable form — see the Roster panel and data/champions.ts.',
  },
  {
    ...CHAMPIONS_COMMON,
    id: 'champs-mb-singles',
    name: 'Champions Ranked — Regulation Set M-B (Singles)',
    shortName: 'Reg M-B Singles',
    window: 'June 17 – September 9, 2026',
    active: true,
    gameType: 'Singles',
    bring: 6,
    pick: 3,
    excludedCategories: ['restricted', 'sublegendary', 'mythical', 'paradox', 'ultrabeast'],
    bannedSpecies: ['Salamence-Mega'],
    bannedMegas: ['Lucario-Mega-Z', 'Garchomp-Mega-Z'],
    notes: [
      'Bring 6, pick 3. Singles. All Pokémon are set to Level 50.',
      'Same species/item clauses and Mega limit as the Doubles regulation.',
    ],
    sourceNotes: 'Singles variant of Regulation Set M-B ranked battles.',
  },
  {
    ...CHAMPIONS_COMMON,
    id: 'champs-ma-doubles',
    name: 'Champions VGC — Regulation Set M-A (Doubles)',
    shortName: 'Reg M-A Doubles',
    window: 'April 8 – June 17, 2026 (concluded)',
    active: false,
    gameType: 'Doubles',
    bring: 6,
    pick: 4,
    excludedCategories: ['restricted', 'sublegendary', 'mythical', 'paradox', 'ultrabeast'],
    bannedSpecies: ['Salamence-Mega'],
    // M-A ran with 186 species / 59 megas; M-B added 22 species and ~16 megas.
    // These are the Mega additions reported for M-B, so they are illegal in M-A.
    bannedMegas: [
      'Sceptile-Mega', 'Blaziken-Mega', 'Swampert-Mega', 'Mawile-Mega', 'Staraptor-Mega',
      'Lucario-Mega-Z', 'Garchomp-Mega-Z',
    ],
    notes: [
      'The first Mega-Evolution regulation: 186 Pokémon, 59 Mega Evolutions.',
      'Superseded by Regulation Set M-B on June 17, 2026 — kept for reference and old teams.',
      'The M-A mega ban list here is reconstructed from the reported M-B additions and is approximate.',
    ],
    sourceNotes:
      'Regulation Set M-A ran April 8 – June 17, 2026. Its exact roster split from M-B could not be ' +
      'verified offline; treat the M-A pool as approximate.',
  },
  {
    ...CHAMPIONS_COMMON,
    id: 'champs-open',
    name: 'Champions Open (no roster restriction)',
    shortName: 'Open',
    window: 'Sandbox',
    active: true,
    gameType: 'Doubles',
    bring: 6,
    pick: 4,
    excludedCategories: [],
    bannedSpecies: [],
    bannedMegas: [],
    itemPool: 'all',
    notes: [
      'Every species, Mega and item in the data set is selectable — useful for theorycrafting ' +
      'future regulations or testing a matchup against something that is not currently legal.',
      'Clauses and the Level 50 rule still apply so damage numbers stay meaningful.',
    ],
    sourceNotes: 'Sandbox format defined by this app, not an official regulation.',
  },
];

export const DEFAULT_FORMAT_ID = 'champs-mb-doubles';

export function getFormat(id: string): FormatRules {
  return FORMATS.find((f) => f.id === id) ?? FORMATS[0];
}
