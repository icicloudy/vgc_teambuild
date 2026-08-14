/**
 * Generates the compact dex dataset the app ships.
 *
 * @pkmn/dex carries every species, move and learnset for all nine generations —
 * 4.8 MB into the bundle to use a couple of dozen fields of it. This reads the
 * full package at build time and emits only what Champions needs, with learnsets
 * pre-merged across pre-evolutions and stored as indices into the move table.
 *
 * Run with: npm run data
 */
import { Dex } from '@pkmn/dex';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const OUT = process.argv[2] || 'src/data/generated/dex-data.json';

const toID = (s) => ('' + s).toLowerCase().replace(/[^a-z0-9]+/g, '');

/**
 * What counts as real content for Champions.
 *
 * The dex marks anything absent from Scarlet/Violet as "Past" — which covers 22
 * Mega base species (Mawile, Kangaskhan, Absol, Steelix…) and *every* legacy Mega
 * Stone. Champions is fed from Pokémon HOME across all generations and is built
 * around exactly those Megas, so "Past" is legal here. Only fan-made (CAP),
 * Let's Go-exclusive, Showdown-custom and unobtainable entries are dropped.
 */
const EXCLUDED_STANDARDS = new Set(['CAP', 'LGPE', 'Custom', 'Unobtainable']);
const keep = (thing) => !EXCLUDED_STANDARDS.has(thing.isNonstandard);

/* ---------------- species ---------------- */

/** Base formes a builder can select, mirroring allSelectableSpecies(). */
function isSelectable(s) {
  // "Mega" is not always the start of the forme name: Meowstic-F-Mega and
  // Tatsugiri-Curly-Mega are formes of formes, and are results, not choices.
  if (s.forme && (/(^|-)Mega/.test(s.forme) || s.forme === 'Primal')) return false;
  if (!keep(s)) return false;
  if (s.isCosmeticForme) return false;
  if (s.num <= 0) return false;

  // Formes you cannot bring to a battle, only end up in.
  if (s.battleOnly) return false;                 // Aegislash-Blade, Darmanitan-Zen, Greninja-Ash…
  // Formes that exist only while an item is held (Silvally's memories, Genesect's
  // drives, Arceus's plates). Mega Stones work this way too, but Megas are already
  // out above and are modelled properly through the stone.
  if (s.requiredItem) return false;
  if (s.isNonstandard === 'Gigantamax') return false;
  if (/-(Gmax|Totem)$/.test(s.name)) return false;
  // Cosplay and cap Pikachu: identical stats, cosmetic only.
  if (s.baseSpecies === 'Pikachu' || s.name === 'Pichu-Spiky-eared') return false;
  // Never released. The dex carries it, no game has ever handed one out.
  if (s.name === 'Floette-Eternal') return false;
  return true;
}

const speciesById = new Map();
const addSpecies = (s) => {
  if (!s?.exists || speciesById.has(s.id)) return;
  speciesById.set(s.id, s);
};

for (const s of Dex.species.all()) {
  if (!keep(s)) continue;
  if (isSelectable(s)) addSpecies(s);
}

// Every Mega forme reachable from a stone, plus the pre-evolution chain of each
// selectable species so the learnset merge below has something to walk.
for (const item of Dex.items.all()) {
  if (!item.megaStone || !keep(item)) continue;
  for (const forme of Object.values(item.megaStone)) {
    addSpecies(Dex.species.get(forme));
  }
}
for (const s of [...speciesById.values()]) {
  let cur = s;
  while (cur?.prevo) {
    const prevo = Dex.species.get(cur.prevo);
    if (!prevo?.exists) break;
    addSpecies(prevo);
    cur = prevo;
  }
}

/* ---------------- moves ---------------- */

const moves = [];
const moveIndex = new Map();
for (const m of Dex.moves.all()) {
  if (!m.exists || !keep(m)) continue;
  moveIndex.set(m.id, moves.length);
  moves.push({
    id: m.id,
    name: m.name,
    type: m.type,
    category: m.category,
    basePower: m.basePower,
    // `true` means "never misses"; keep that distinct from a percentage.
    accuracy: m.accuracy === true ? true : m.accuracy,
    target: m.target,
    priority: m.priority,
    shortDesc: m.shortDesc || '',
    ...(m.isNonstandard ? { isNonstandard: m.isNonstandard } : {}),
  });
}

/* ---------------- learnsets ---------------- */

/**
 * Merge each species' learnset with its pre-evolutions and base forme, exactly
 * as the runtime used to do lazily — a Pokémon transferred into Champions keeps
 * what it could learn earlier.
 */
async function mergedLearnset(species) {
  const ids = new Set();
  const queue = [species.name];
  const seen = new Set();
  while (queue.length) {
    const name = queue.shift();
    if (seen.has(toID(name))) continue;
    seen.add(toID(name));
    const cur = Dex.species.get(name);
    if (!cur?.exists) continue;
    try {
      const ls = await Dex.learnsets.get(cur.id);
      if (ls?.learnset) for (const id of Object.keys(ls.learnset)) ids.add(id);
    } catch {
      /* species with no learnset data */
    }
    if (cur.prevo) queue.push(cur.prevo);
    if (cur.baseSpecies && cur.baseSpecies !== cur.name) queue.push(cur.baseSpecies);
    if (cur.changesFrom) queue.push(cur.changesFrom);
  }

  const out = [];
  for (const id of ids) {
    const idx = moveIndex.get(id);
    if (idx === undefined) continue;
    const move = moves[idx];
    // Champions runs on Gen 9 mechanics, so moves cut from Gen 9 genuinely do not
    // exist — unlike species and items, "Past" really is unavailable here.
    if (move.isNonstandard && move.isNonstandard !== 'Future') continue;
    out.push(idx);
  }
  return out.sort((a, b) => a - b);
}

const learnsets = {};
for (const s of speciesById.values()) {
  if (!isSelectable(s)) continue; // only selectable formes are ever asked for
  learnsets[s.id] = await mergedLearnset(s);
}

/* ---------------- items, abilities, types, natures ---------------- */

/**
 * Items with no effect inside a battle: evolution and trade items, sell junk,
 * bottle caps, and the berries that only lower EVs. They are legal to hold and
 * completely pointless, so they are not choices a teambuilder should offer.
 */
const NO_BATTLE_EFFECT = new Set([
  // Evolution and trade items.
  'dawnstone', 'duskstone', 'firestone', 'icestone', 'leafstone', 'moonstone',
  'shinystone', 'sunstone', 'thunderstone', 'waterstone', 'ovalstone', 'dragonscale',
  'metalcoat', 'prismscale', 'upgrade', 'dubiousdisc', 'protector', 'reapercloth',
  'electirizer', 'magmarizer', 'metalalloy', 'auspiciousarmor', 'maliciousarmor',
  'chippedpot', 'crackedpot', 'masterpieceteacup', 'unremarkableteacup',
  'galaricacuff', 'galaricawreath', 'sweetapple', 'tartapple', 'syrupyapple',
  'berrysweet', 'cloversweet', 'flowersweet', 'lovesweet', 'ribbonsweet',
  'starsweet', 'strawberrysweet',
  // Sold, not used.
  'bottlecap', 'goldbottlecap', 'bignugget', 'nugget', 'rarebone', 'prettyfeather',
  // Berries that only lower EVs.
  'pomegberry', 'kelpsyberry', 'qualotberry', 'hondewberry', 'grepaberry', 'tamatoberry',
]);

/**
 * An item ships only if a Champions battle can actually use it.
 *
 * The dex marks everything absent from Gen 9 as "Past", which covers Z-Crystals,
 * Memories, Drives, fossils and the whole Gen 2 evolution-item drawer. Mega Stones
 * are the deliberate exception — Champions is built on them (see README).
 */
function battleItem(i) {
  if (i.megaStone) return true;
  if (i.isPokeball || i.zMove || i.isGem || i.onMemory || i.onDrive) return false;
  if (i.isNonstandard) return false;
  return !NO_BATTLE_EFFECT.has(i.id);
}

const items = [];
for (const i of Dex.items.all()) {
  if (!i.exists || !keep(i) || i.num < 0) continue;
  if (!battleItem(i)) continue;
  items.push({
    id: i.id,
    name: i.name,
    num: i.num,
    shortDesc: i.shortDesc || i.desc || '',
    ...(i.megaStone ? { megaStone: { ...i.megaStone } } : {}),
    ...(i.isNonstandard ? { isNonstandard: i.isNonstandard } : {}),
    ...(i.isBerry ? { berry: true } : {}),
    ...(i.isChoice ? { choice: true } : {}),
    ...(i.naturalGift ? { boostType: i.naturalGift.type } : {}),
    // Items that only do something for one Pokémon, so the picker can hide them
    // everywhere else.
    ...(i.itemUser?.length ? { user: [...i.itemUser] } : {}),
  });
}

const abilities = [];
for (const a of Dex.abilities.all()) {
  if (!a.exists || !keep(a)) continue;
  abilities.push({ id: a.id, name: a.name });
}

const TYPE_NAMES = [
  'Normal', 'Fire', 'Water', 'Electric', 'Grass', 'Ice', 'Fighting', 'Poison', 'Ground',
  'Flying', 'Psychic', 'Bug', 'Rock', 'Ghost', 'Dragon', 'Dark', 'Steel', 'Fairy',
];
const types = {};
for (const name of TYPE_NAMES) {
  const t = Dex.types.get(name);
  const taken = {};
  // Only non-neutral entries need storing; the reader defaults the rest to 1x.
  for (const [atk, code] of Object.entries(t.damageTaken)) {
    if (code && TYPE_NAMES.includes(atk)) taken[atk] = code;
  }
  types[name] = taken;
}

const natures = {};
for (const n of Dex.natures.all()) {
  if (!n.exists) continue;
  natures[n.name] = n.plus && n.minus ? { plus: n.plus, minus: n.minus } : {};
}

/* ---------------- aliases ---------------- */

/**
 * @pkmn/dex resolves "Mega Charizard Y", "Landorus-T" and nicknames like "Ttar",
 * but does not export the table. Structural aliases are generated; the hand-written
 * nicknames are harvested from the package source and then *verified* against the
 * live Dex, so a future repack yields fewer aliases rather than wrong ones.
 */
const aliases = {};
const addAlias = (from, target) => {
  const id = toID(from);
  if (!id || speciesById.has(id) || aliases[id]) return;
  aliases[id] = target;
};

for (const s of speciesById.values()) {
  if (!s.forme || !s.baseSpecies) continue;
  const m = /^(Mega|Primal)(?:-([XYZ]))?$/.exec(s.forme);
  if (m) {
    addAlias(`${m[1]} ${s.baseSpecies}${m[2] ? ` ${m[2]}` : ''}`, s.id);
  }
  // "Landorus-T" style: forme abbreviated to its first letter.
  addAlias(`${s.baseSpecies}-${s.forme[0]}`, s.id);
}

let harvested = 0;
try {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync('node_modules/@pkmn/dex/build/index.mjs', 'utf8');
  for (const [, id, value] of src.matchAll(/\b([a-z][a-z0-9]{1,20})\s*=\s*"([A-Z][A-Za-z0-9 .'’:-]{2,30})"/g)) {
    if (speciesById.has(id) || aliases[id]) continue;
    // Only keep it if the live Dex agrees this alias points at this species.
    const resolved = Dex.species.get(id);
    if (!resolved?.exists) continue;
    if (toID(resolved.name) !== toID(value)) continue;
    if (!speciesById.has(resolved.id)) continue;
    aliases[id] = resolved.id;
    harvested++;
  }
} catch {
  /* package layout changed — structural aliases still apply */
}

/* ---------------- emit ---------------- */

const species = [];
for (const s of speciesById.values()) {
  species.push({
    id: s.id,
    name: s.name,
    num: s.num,
    types: [...s.types],
    baseStats: { ...s.baseStats },
    // Ordered, first entry is the default ability.
    abilities: [...new Set(Object.values(s.abilities).filter(Boolean))],
    weightkg: s.weightkg,
    ...(s.tags?.length ? { tags: [...s.tags] } : {}),
    ...(s.isNonstandard ? { isNonstandard: s.isNonstandard } : {}),
    ...(s.forme ? { forme: s.forme } : {}),
    ...(s.baseSpecies && s.baseSpecies !== s.name ? { baseSpecies: s.baseSpecies } : {}),
    ...(s.prevo ? { prevo: s.prevo } : {}),
    ...(s.nfe ? { nfe: true } : {}),
    ...(s.doublesTier ? { doublesTier: s.doublesTier } : {}),
    ...(s.requiredItem ? { requiredItem: s.requiredItem } : {}),
    ...(isSelectable(s) ? { selectable: true } : {}),
  });
}

const data = { species, moves, items, abilities, types, natures, learnsets, aliases };
const json = JSON.stringify(data);

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, json);

console.log(`wrote ${OUT}`);
console.log(`  species   ${species.length} (${species.filter((s) => s.selectable).length} selectable)`);
console.log(`  moves     ${moves.length}`);
console.log(`  items     ${items.length}`);
console.log(`  abilities ${abilities.length}`);
console.log(`  learnsets ${Object.keys(learnsets).length}`);
console.log(`  aliases   ${Object.keys(aliases).length} (${harvested} harvested)`);
console.log(`  size      ${(json.length / 1024 / 1024).toFixed(2)} MB`);
