/**
 * What actually exists in Pokémon Champions, as opposed to what exists in the
 * Pokédex.
 *
 * Champions is not a mainline game with everything switched on. It ships a
 * curated roster (208 species and 75 Mega Evolutions as of Regulation Set M-B)
 * and — the part that bites hardest in a teambuilder — a *curated item pool*.
 * Assault Vest, Choice Band and Weakness Policy are simply not in the game, so a
 * spread built around them is unplayable however good the numbers look.
 *
 * None of this is published in machine-readable form, so it is compiled here by
 * hand from the sources listed below and dated. Two consequences follow, and the
 * app is built around them: everything here is a *warning*, never a hard error,
 * and pasting your in-game roster into the Roster panel overrides all of it.
 *
 * Sources (retrieved August 2026):
 *  - Regulation Set M-B announcement, Pokémon.com — dates, clauses, 22 new
 *    Pokémon / 16 new Megas / 15 new items.
 *  - Pikalytics Champions Reg M-B S3 ranked battle data — usage order, and the
 *    items and moves that actually appear on ladder, which is the strongest
 *    available evidence of what is in the game.
 *  - Item guides (ChampsDex, GAMES.GG, Serebii items page) for the pool split:
 *    starting items, 700 VP type boosters, 1000 VP premium items, 400 VP
 *    berries, 2000 VP Mega Stones.
 */

export const ROSTER_SIZE = { species: 208, megas: 75 };
export const DATA_AS_OF = 'August 2026, Regulation Set M-B';

/* ------------------------------------------------------------------ *
 * Items
 * ------------------------------------------------------------------ */

/** Free from the start. */
const STARTING_ITEMS = ['sitrusberry', 'lumberry'];

/** 700 VP each: the eighteen flat type boosters, plus the plates. */
const TYPE_BOOSTERS = [
  'blackbelt', 'blackglasses', 'charcoal', 'dragonfang', 'fairyfeather', 'hardstone',
  'magnet', 'metalcoat', 'miracleseed', 'mysticwater', 'nevermeltice', 'poisonbarb',
  'sharpbeak', 'silkscarf', 'silverpowder', 'softsand', 'spelltag', 'twistedspoon',
  'dracoplate', 'dreadplate', 'earthplate', 'fistplate', 'flameplate', 'icicleplate',
  'insectplate', 'ironplate', 'meadowplate', 'mindplate', 'pixieplate', 'skyplate',
  'splashplate', 'spookyplate', 'stoneplate', 'toxicplate', 'zapplate',
];

/** 400 VP: the type-resist berries. */
const RESIST_BERRIES = [
  'occaberry', 'passhoberry', 'wacanberry', 'rindoberry', 'yacheberry', 'chopleberry',
  'kebiaberry', 'shucaberry', 'cobaberry', 'payapaberry', 'tangaberry', 'chartiberry',
  'kasibberry', 'habanberry', 'colburberry', 'babiriberry', 'chilanberry', 'roseliberry',
];

/** 1000 VP premium items available since launch. */
const PREMIUM_ITEMS = [
  'focussash', 'leftovers', 'choicescarf', 'choicespecs', 'mentalherb', 'whiteherb',
  'rockyhelmet', 'eviolite', 'covertcloak', 'clearamulet', 'safetygoggles',
  'boosterenergy', 'quickclaw',
];

/** The fifteen held items added with Regulation Set M-B. */
const M_B_ITEMS = [
  'widelens', 'muscleband', 'wiseglasses', 'blackbelt', 'lightclay', 'lifeorb',
  'zoomlens', 'metronome', 'ironball', 'icyrock', 'smoothrock', 'heatrock',
  'damprock', 'shedshell', 'bigroot',
];

/**
 * Every non-Mega-Stone item a Champions battle can use. Mega Stones are handled
 * separately — each one ships with its Pokémon.
 */
export const CHAMPIONS_ITEM_POOL = new Set<string>([
  ...STARTING_ITEMS,
  ...TYPE_BOOSTERS,
  ...RESIST_BERRIES,
  ...PREMIUM_ITEMS,
  ...M_B_ITEMS,
]);

/**
 * Items a VGC player will reach for out of habit that Champions does not have.
 * Kept explicit so the warning can say "not in the game" rather than the vaguer
 * "not in our list".
 */
export const KNOWN_ABSENT_ITEMS: Record<string, string> = {
  assaultvest: 'Assault Vest is not in Champions — the format has no four-attack special wall item.',
  choiceband: 'Choice Band is not in Champions. Choice Scarf and Choice Specs are.',
  weaknesspolicy: 'Weakness Policy is not in Champions.',
  ejectbutton: 'Eject Button is not in Champions.',
  ejectpack: 'Eject Pack is not in Champions.',
  airballoon: 'Air Balloon is not in Champions.',
  expertbelt: 'Expert Belt is not in Champions — the flat type boosters do that job here.',
  roomservice: 'Room Service is not in Champions.',
  throatspray: 'Throat Spray is not in Champions.',
  loadeddice: 'Loaded Dice is not in Champions.',
  punchingglove: 'Punching Glove is not in Champions.',
  protectivepads: 'Protective Pads is not in Champions.',
  mirrorherb: 'Mirror Herb is not in Champions.',
  powerherb: 'Power Herb is not in Champions.',
  utilityumbrella: 'Utility Umbrella is not in Champions.',
  heavydutyboots: 'Heavy-Duty Boots is not in Champions.',
  abilityshield: 'Ability Shield is not in Champions.',
};

/* ------------------------------------------------------------------ *
 * Species
 * ------------------------------------------------------------------ */

/**
 * Species confirmed present in Champions as of Regulation M-B.
 *
 * Every name here traces to a source, and they are grouped by which one. That is
 * a deliberate constraint, not tidiness: an earlier version of this list carried
 * names added from memory, and one of them (Togekiss) is not in the game — which
 * is exactly the failure a teambuilder must not have. **Do not add a name here
 * without a source for it.**
 *
 * On top of this list, roster.ts also treats every species with a Champions Mega
 * Stone as confirmed, since the stone's existence in the game implies the
 * Pokémon's.
 *
 * This is *not* the whole 208. The full roster is not published in a form this
 * app can read, so the rest is inferred (see roster.ts) — and the drafter refuses
 * to pick from the inferred part.
 */
export const CONFIRMED_SPECIES = [
  // Reg M-B ranked usage data (Pikalytics, Season 3) — if people are laddering
  // with it, it exists.
  'Garchomp', 'Basculegion', 'Whimsicott', 'Kingambit', 'Sinistcha', 'Incineroar',
  'Charizard', 'Staraptor', 'Floette-Eternal', 'Sylveon', 'Sneasler', 'Farigiraf',
  'Pelipper', 'Raichu', 'Archaludon', 'Maushold', 'Metagross', 'Swampert',
  'Grimmsnarl', 'Aerodactyl', 'Milotic', 'Meganium', 'Mimikyu', 'Scrafty',
  // Named in the Regulation Set M-B announcement as new to the roster.
  'Vileplume', 'Qwilfish', 'Sceptile', 'Blaziken', 'Mawile', 'Musharna', 'Scolipede',
  'Eelektross', 'Pyroar', 'Malamar', 'Barbaracle', 'Dragalge', 'Falinks', 'Overqwil',
  'Houndstone', 'Annihilape', 'Gholdengo',
  // Named in launch coverage of the roster.
  'Dragonite', 'Tyranitar', 'Greninja', 'Dragapult', 'Palafin',
  // Serebii's Champions Pokédex: individual entries and type listings.
  'Excadrill', 'Feraligatr', 'Ampharos', 'Altaria', 'Hydreigon', 'Tyrantrum',
  'Pidgeot', 'Kangaskhan', 'Tauros', 'Ditto', 'Snorlax', 'Castform', 'Lopunny',
  'Watchog', 'Audino',
  // Enumerated in published roster guides (A-C section).
  'Abomasnow', 'Absol', 'Aegislash', 'Aggron', 'Alakazam', 'Alcremie', 'Appletun',
  'Araquanid', 'Arbok', 'Arcanine', 'Ariados', 'Armarouge', 'Aromatisse', 'Aurorus',
  'Avalugg', 'Azumarill', 'Banette', 'Bastiodon', 'Beartic', 'Beedrill', 'Bellibolt',
  'Blastoise', 'Camerupt', 'Ceruledge', 'Chandelure', 'Chesnaught', 'Chimecho',
  'Clawitzer', 'Clefable', 'Cofagrigus', 'Conkeldurr', 'Corviknight', 'Crabominable',
];

/**
 * Pokémon that are not fully evolved but *are* on the roster. The roster is
 * otherwise final-stage only, which is the single most useful rule it follows:
 * it removes several hundred species that can never be built.
 */
export const NFE_EXCEPTIONS = ['Pikachu', 'Floette-Eternal', 'Qwilfish', 'Qwilfish-Hisui'];
