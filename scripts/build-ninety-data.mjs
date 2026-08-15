/**
 * Cuts a tiny dex out of the big one, for the preview app.
 *
 * Ninety only ever looks at the ~24 species of the Reg M-B preview pool and the
 * ~70 moves their sets run, so shipping the 1259-species dex would be 99% dead
 * weight in a page whose whole point is answering in under 90 seconds.
 *
 * It also validates. Every move in pool.json is checked against the real
 * learnset, every ability against the real ability list, every spread against
 * the 66/32 budget. A set that does not exist fails the build here rather than
 * shipping as a fake read of the metagame.
 *
 * Run with: npm run data:ninety
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const dex = JSON.parse(readFileSync(resolve(root, 'src/data/generated/dex-data.json'), 'utf8'));
const pool = JSON.parse(readFileSync(resolve(root, 'ninety/data/pool.json'), 'utf8'));

const id = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const speciesById = new Map(dex.species.map((s) => [s.id, s]));
const moveById = new Map(dex.moves.map((m) => [m.id, m]));
const itemById = new Map(dex.items.map((i) => [i.id, i]));

const problems = [];
const fail = (m) => problems.push(m);

/** The learnsets are indices into the move table; expand one to a set of ids. */
function learnset(speciesId) {
  const raw = dex.learnsets[speciesId];
  if (!raw) return null;
  return new Set(raw.map((i) => dex.moves[i]?.id).filter(Boolean));
}

/**
 * A Pokémon holding a Mega Stone is, for every purpose that matters at preview,
 * the Mega. The stone itself carries the mapping.
 */
function megaOf(speciesName, itemName) {
  const item = itemById.get(id(itemName));
  const map = item?.megaStone;
  if (!map) return null;
  const target = map[speciesName] ?? Object.values(map)[0];
  return speciesById.get(id(target)) ?? null;
}

const keepSpecies = new Map();
const keepMoves = new Map();
const keepItems = new Map();
const keepNatures = new Set();

const out = [];
for (const entry of pool.species) {
  const base = speciesById.get(id(entry.species));
  if (!base) {
    fail(`${entry.species}: not in the dex`);
    continue;
  }
  keepSpecies.set(base.id, base);

  // Megas inherit the base forme's learnset, so legality is checked on the base.
  const legal = learnset(base.id);
  if (!legal) fail(`${entry.species}: no learnset`);

  const sets = [];
  for (const set of entry.sets) {
    const where = `${entry.species} / ${set.label}`;

    if (!dex.natures[set.nature]) fail(`${where}: "${set.nature}" is not a Nature`);
    else keepNatures.add(set.nature);

    const item = itemById.get(id(set.item));
    if (!item) fail(`${where}: "${set.item}" is not an item`);
    else keepItems.set(item.id, item);

    if (!base.abilities.some((a) => id(a) === id(set.ability))) {
      fail(`${where}: ${entry.species} cannot have ${set.ability} (has ${base.abilities.join(', ')})`);
    }

    const total = Object.values(set.sp).reduce((a, b) => a + b, 0);
    if (total > pool.format.spBudget) fail(`${where}: spends ${total} Stat Points, budget is ${pool.format.spBudget}`);
    for (const [stat, n] of Object.entries(set.sp)) {
      if (n > pool.format.spPerStat) fail(`${where}: ${n} in ${stat}, cap is ${pool.format.spPerStat}`);
      if (n < 0) fail(`${where}: negative ${stat}`);
    }

    const moveIds = [];
    for (const name of set.moves) {
      const move = moveById.get(id(name));
      if (!move) {
        fail(`${where}: "${name}" is not a move`);
        continue;
      }
      if (legal && !legal.has(move.id)) fail(`${where}: ${entry.species} cannot learn ${name}`);
      keepMoves.set(move.id, move);
      moveIds.push(move.id);
    }
    if (new Set(moveIds).size !== moveIds.length) fail(`${where}: duplicate move`);

    const mega = megaOf(base.name, set.item);
    if (mega) keepSpecies.set(mega.id, mega);

    sets.push({
      label: set.label,
      share: set.share,
      item: item?.name ?? set.item,
      ability: mega ? mega.abilities[0] : set.ability,
      baseAbility: set.ability,
      nature: set.nature,
      sp: set.sp,
      moves: moveIds,
      forme: mega ? mega.id : base.id,
      mega: !!mega,
      note: set.note,
    });
  }

  out.push({
    id: base.id,
    species: base.name,
    usage: entry.usage,
    measured: entry.measured,
    sets,
  });
}

if (problems.length) {
  console.error(`\nninety/data/pool.json has ${problems.length} problem(s):\n`);
  for (const p of problems) console.error('  ✗ ' + p);
  console.error('');
  process.exit(1);
}

/** Only the type rows we can actually be hit by or hit with. */
const types = {};
for (const [name, taken] of Object.entries(dex.types)) types[name] = taken;

const payload = {
  format: pool.format,
  types,
  natures: Object.fromEntries([...keepNatures].map((n) => [n, dex.natures[n]])),
  species: Object.fromEntries([...keepSpecies.values()].map((s) => [s.id, {
    name: s.name,
    types: s.types,
    baseStats: s.baseStats,
    abilities: s.abilities,
    weightkg: s.weightkg,
  }])),
  moves: Object.fromEntries([...keepMoves.values()].map((m) => [m.id, {
    name: m.name,
    type: m.type,
    category: m.category,
    basePower: m.basePower,
    accuracy: m.accuracy,
    target: m.target,
    priority: m.priority,
    shortDesc: m.shortDesc,
  }])),
  items: Object.fromEntries([...keepItems.values()].map((i) => [i.id, { name: i.name, shortDesc: i.shortDesc }])),
  pool: out,
};

const dest = resolve(root, 'ninety/src/generated/dex.json');
mkdirSync(dirname(dest), { recursive: true });
writeFileSync(dest, JSON.stringify(payload));

const kb = (JSON.stringify(payload).length / 1024).toFixed(0);
console.log(
  `ninety: ${out.length} species, ${out.reduce((n, s) => n + s.sets.length, 0)} sets, ` +
  `${keepSpecies.size} formes, ${keepMoves.size} moves — ${kb} kB (dex is ${(readFileSync(resolve(root, 'src/data/generated/dex-data.json')).length / 1024 / 1024).toFixed(1)} MB)`,
);
