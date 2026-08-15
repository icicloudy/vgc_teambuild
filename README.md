# Champions Teambuilder

A VGC teambuilder for **Pokémon Champions** — Showdown-style building with the damage
calculator wired into every screen, so the numbers that matter are already on the page
instead of behind a copy-paste round trip.

Runs entirely in the browser. No backend, no account, teams saved to local storage.

```bash
npm install
npm run data           # regenerate the bundled dex dataset
npm run dev            # http://localhost:5173
npm run build          # static bundle in dist/
npm run check          # offline data + engine sanity checks
npm run smoke          # drives the real UI in Chromium
npm run smoke:mobile   # same, at a phone viewport
npm run smoke:features # filters, the threshold map, any-Pokémon calcs
npm run smoke:draft    # the drafter, end to end, in a browser
```

## Using it on your phone

The app is a static site with no backend, so anything that can serve a folder works.

**Same Wi-Fi, no deploy** — the quickest option:

```bash
npm run dev:lan        # or: npm run build && npm run preview:lan
```

Vite prints a `Network:` URL (`http://192.168.x.x:5173`). Open that on your phone while
it is on the same network. Add it to your home screen and it opens like an app.

**Anywhere** — `npm run build` produces a fully static `dist/`, deployable to GitHub Pages,
Netlify, Cloudflare Pages or any static host. For a host that serves from a sub-path (such
as a GitHub Pages project site at `/<repo>/`), build with the path set:

```bash
BASE_PATH=/vgc_teambuild/ npm run build
```

Teams live in the browser's local storage, so each device keeps its own. To move a team
across, use Import / Export — the paste is plain text.

The layout is built for phones as well as desktop: the team becomes a swipeable strip above
the tabs, and the wide tables (threat matrix, type chart, speed tiers) scroll horizontally
inside their panels rather than stretching the page.

---

## What it does

**Build** — six slots with a species search that takes what a Pokémon *does*, not just its
name: type `intimidate`, `fake out` or `steel`, and stack them (`fake out intimidate`) to
intersect. Unevolved Pokémon sort last and are labelled, so they never crowd out real options.
Move and item pickers that are grouped rather than flat — the moves the format actually
runs sit in their own section at the top, with the share of the metagame carrying each one
measured from ladder data, and each section is alphabetical inside itself so a name you are
looking for is where you expect it. An item list trimmed to what a Champions battle can actually
use and grouped with the staples first, Stat Point sliders with live totals and a marker
where the 66-point budget runs out, and Mega Evolution handled the way the game handles it: hold the
stone, and the forme, typing, ability and stats all switch over everywhere in the app. Showdown
paste import/export both ways, including folding `Mega Charizard Y` back into
Charizard @ Charizardite Y.

**Draft** — the part that starts a team rather than polishing one. Keep whatever you
already have, choose a game plan (or let it read your core and pick one), turn the spice
dial, and it fills the rest: species, ability, item, Nature, four moves and a Stat Point
spread, for every empty slot — and finishes any set you left half-done rather than
replacing it. It only proposes Pokémon *confirmed* to be in Champions, and says how many
that is; import your in-game roster and it uses exactly what you own. Every pick states
its case in plain language ("answers Mega Charizard Y and Kingambit, which nothing on the
team was beating"), lists the runners-up, and can be
turned down, in which case that Pokémon never comes back. A before/after read-out across
six axes shows what the draft actually changed. Details below.

**Matchups, always on** — while you edit a set, the right-hand panel shows the best move
each way against the top of the metagame, with speed order. No tab switching to find out
whether your spread does anything.

**Threat matrix** — every team member against every metagame threat, both directions,
~1,150 damage calculations recomputed as you type. Colour-coded by verdict, or switch to
raw "you deal" / "you take" percentages. Toggle Tailwind, Trick Room and an opposing
Intimidate to see the matrix under the conditions you actually play in. Click any cell for
the full calc lines.

**Threat report** — each threat ranked by pressure (how badly it beats you, weighted by how
common it is), with who OHKOes it, who it OHKOes, and your best answer.

**Stat Point optimizer** — the part that saves the most time, built around a threshold map.
Pick a threat and a move and it plots the KO boundary across every split of points between HP
and the relevant defence: 33 x 33 real calculations, so the staircase you see is the actual
threshold, not an interpolation. Hover any square for its numbers, click to apply it. Below the
map it lists the cheapest spreads that survive, and the other two modes solve the minimum
investment that secures a KO and the Speed points (and nature) to outrun a benchmark.
Defence runs along the bottom, HP up the side. With all 66 points free every square is
reachable — the dimmed region only appears once points are committed to other stats, and the
dashed line marks where the remaining budget runs out.

**Speed tiers** — your team laid against the metagame with boosts, Tailwind, weather
abilities, paralysis, Choice Scarf and Trick Room inversion, plus what share of the field
each Pokémon outruns.

**Analysis** — defensive type chart with ability immunities folded in (Levitate, Thick Fat,
Flash Fire…), attacking coverage, and a VGC role checklist: speed control, Protect count,
Fake Out, Intimidate, redirection, spread moves, priority.

**Coach** — reads the matrix and the team and tells you what to fix, most important first:
threats nothing answers (with concrete replacement Pokémon you can add in one click), stacked
weaknesses with no resist, missing roles, unspent Stat Points, and Attack investment on a
special attacker.

**Metagame** — the threat list every calculation runs against, fully editable. Paste the set
that just beat you and it becomes part of the analysis.

**Calculator** — either side can be a team member, a listed threat, or *any* Pokémon in the
dex, with its own ability, item, nature, Stat Points and moves.

Every move is labelled Physical / Special / Status wherever it appears — in the team rail,
the draft cards, the pickers and the calculator — because in doubles that decides which
defence it is measured against and whether Intimidate touches it.

---

## How the drafter decides

A teambuilder that autocompletes by picking high-stat Pokémon is a random team generator
with extra steps. This one is built on two ideas.

**A team is a plan, not a pile.** The drafter commits to a game plan first — balanced
goodstuff, Tailwind offense, Trick Room, sun, rain, bulky control — and scores everything
against it. On "read my team and choose" it infers the plan from what you already have: a
core averaging base 45 Speed gets Trick Room, and every later decision follows from that,
down to Quiet Natures and zero Speed investment. The spice dial gates the stranger plans
and widens the draw, so the difference between chalk and spice is a different *team*, not
a worse one.

**Some partnerships are obvious and should be treated that way.** An Archaludon holding
Electro Shot is asking for rain: without it the move spends a turn charging, with it the
move is better than anything else that Pokémon could be doing. The same goes for Solar Beam
and sun, Hurricane and Thunder wanting rain for the accuracy, Aurora Veil needing snow. So
weather-dependent moves are modelled: they steer the plan before anything has been drafted,
they pull the setter in — as an *ability*, since Drizzle is free and Rain Dance costs a slot
and a turn, so a rain team drafts Pelipper first the way a person would — and the card says
which move it was and what the weather does for it.

**A team is a set of relationships, not a pile of good Pokémon.** The scoring above will
happily assemble six Pokémon that each answer something and never help each other, so
`src/engine/synergy.ts` models the pairings directly: the redirector that buys the slow
attacker its turn, the weather setter and the ability that keys off it, the Trick Room
setter and the Pokémon too slow to play fair without it, Intimidate next to something
that folds to physical damage, the Ground immunity that gives a Ground-weak partner
somewhere to stand. Each rule detects one concrete, mechanical pairing; they are scored
into the draft, they are the *first* thing the card says, and the finished team gets a
**Cohesion** reading — the share of its members that work with another member rather than
beside it. "Rage Powder buys Baxcalibur the turn it needs" is a reason you can agree or
disagree with. "Fills a Bug-type coverage gap" usually is not — which is why coverage is
now weighted by how much of the metagame the uncovered type actually accounts for. A hole
nothing walks through is not a hole.

**The drafter only suggests Pokémon that are confirmed to exist.** The roster is curated
and not published in machine-readable form, so the app's "probably in the roster" tier is a
guess. A guess is fine on a badge next to a name you typed; it is not fine coming from a
tool that says "add this to your team". So the drafter draws only from the confirmed list —
121 of the 208 — and the panel says so. Import your in-game roster and it opens up to
exactly what you own.

**"What is missing" is only answerable against the metagame.** Every candidate is scored
on cheap structural terms first — resistances where your team is stacked weak, coverage
nothing else brings, roles nobody fills, speed tiers you do not occupy, physical/special
balance. The top eighteen then get the expensive treatment: a full set is generated for
each, run through the same damage matrix the Threat tab uses, and scored on **how much it
improves your worst answer to each threat, weighted by how common that threat is**. A
Pokémon that beats things you already beat scores nothing for it. That is the term that
decides the pick, and it is why the reasons quote real matchups.

Set generation follows the same rule — every choice has to be derivable:

- **Roles are needs, not a checklist.** A team without speed control has a problem; a
  team without screens does not. Speed control, Fake Out, redirection, Intimidate, Protect
  and a pivot move are standing needs; Trick Room is one only under a plan that inverts the
  speed order; screens are one only for a team too frail to take a hit; recovery belongs on
  something bulky enough to be worth healing. Roles outside that are never chased, and never
  cited as a justification — "nothing else brings screens" is a fact about the team, not a
  reason to have drafted anything.
- **Three kinds of Pokémon.** Some exist to attack: a damage-multiplying ability, or a wide
  offensive movepool and nothing else to offer. Some exist to support, and a Prankster
  Pokémon with four things better to do than deal damage is allowed to carry no attacking
  move at all. Most are neither on their own — Torkoal is an attacker on a Trick Room team
  and a supporter next to something that wants Helping Hand — so for those the *team*
  decides, which is the only place that question can honestly be answered.
- **Moves** — every damaging move has to earn its slot one of four ways: **STAB** (measured
  after any ability that rewrites its type, so Sylveon's Hyper Voice counts as Fairy),
  **coverage** — meaning it hits a type the team cannot otherwise hit, which is a property
  of what it is super-effective *against*, not of its own type, so a Normal move covers
  nothing however few Normal attacks the team has — **a rider** that does something beyond
  damage (Fake Out, Knock Off, U-turn, priority, Icy Wind), or **power high enough that the
  type stops mattering** (Boomburst). A move with none of those is filler and is only used
  to avoid leaving a slot empty. Beyond that: accuracy is punished super-linearly; recoil
  and self-debuff moves pay for what they cost; Foul Play is priced off the target's Attack
  rather than the user's; Protect goes on everything, because Champions has no Assault Vest
  to pay you for dropping it; and moves that need a promise the drafter cannot keep — Focus
  Punch, Future Sight, three-turn lock-ins, Aurora Veil with no snow — are never offered.
  Spread moves are split the way doubles splits them: `allAdjacentFoes` moves (Heat Wave,
  Rock Slide) get the two-target bonus, while `allAdjacent` moves that hit your own partner
  (Earthquake, Surf, Sludge Wave) are not offered at all — they are good on a team built to
  ignore them, and the drafter picks slots one at a time, so it cannot promise that. Pick
  them yourself, where you know who they are standing next to. A damaging support move on
  the wrong attacking stat is marked down too, which is why a physical Pokémon gets Thunder
  Wave rather than Icy Wind.
- **Move slots compete on one scale.** Support moves and attacks used to be chosen in
  separate passes with separate budgets, so a third attack could never lose to a better
  utility move however lopsided the comparison — that is how Incineroar ended up with
  Darkest Lariat instead of Parting Shot. Everything now competes on one number, and
  attacks have diminishing returns: in doubles you face two Pokémon and the game turns on
  tempo, so the first attack is essential, the second buys coverage, and the third is
  usually worth less than the utility it displaced. Most real VGC sets are two attacks and
  two other things, and that curve is why the drafter lands there too.
- **Moves that undercut each other are refused.** Scale Shot lowers Defence to raise Speed;
  Body Press attacks *with* Defence. Both are good moves and no amount of scoring them
  separately catches it, so the model is explicit: which moves change the user's stats,
  which moves read a stat other than the obvious one, and a conflict whenever one moves a
  stat the wrong way for the other. Two moves doing the same job — Parting Shot and U-turn,
  Thunder Wave and Icy Wind — are refused for the same reason.
- **Two attacks of the same type are one attack.** The comparison is on the type a move
  actually goes out as, so Weather Ball in rain is a Water move and Pelipper cannot pair it
  with Muddy Water — Hurricane, which is what the set wanted, gets the slot instead. Weather
  changes accuracy in the same place, which is why Hurricane and Thunder stop being
  70%-accurate gambles under rain and start being the reason to be in rain.
- **Screens are measured, not assumed.** How thin the team is on each side is a number —
  mean HP×Def and HP×SpD against a baseline, weighted by how physical the format actually
  is — and Reflect and Light Screen are valued against their own side of it. So the screen
  that goes on is the one covering the side the team is short of, and the note says which
  side that was. Recovery is gated the other way: it only goes on something bulky enough
  for healing to be the plan, because an offensive team that spends a turn healing has
  already lost the turn it was trying to win.
- **Stat Points** — Speed first, *priced against the threat list*: every point count from 0
  to the budget is costed as "extra share of the metagame outrun" minus "bulk those points
  would have bought", so a slow Pokémon chasing a tier it cannot reach correctly gets
  nothing, and a Choice Scarf is speed control that gets priced with its 1.5x included.
  Then the points buy a specific outcome. An attacker's attacking stat is solved against
  the top of the usage table: every common threat is priced with real damage calculations
  and the set buys the most expensive KO still inside its budget, so the note reads "the
  least that guarantees Draco Meteor KOes Basculegion" rather than "max Attack because it
  is an attacker" — and physical attackers do that arithmetic at -1 when a third of the
  format carries Intimidate, because that is the attack they will really be swinging.
  Everything else solves the mirror question, the least HP and defence that lives through
  the strongest attack the common threats aim at it. Focus Sash is the documented exception:
  it already guarantees the turn, so the points go to maximum Speed and maximum power and
  buy no bulk at all. Whatever is left over goes into bulk one point at a time, to whichever
  of HP/Def/SpD buys the most effective HP.
- **Nature** — decided *with* the Speed investment, not before it, since +Speed costs 10%
  of the attacking stat and has to buy meaningfully more of the field to be worth it.
- **Item** — scored from the finished set (Mental Herb on the Trick Room setter, Light Clay
  behind screens, Focus Sash on the fast and frail), drawn only from the Champions item pool,
  respecting Item Clause, with a fallback chain so a slot is never left empty. An item that
  would do nothing for its holder is not offered at all: Safety Goggles on a Grass type or
  an Overcoat holder, Clear Amulet with Clear Body, Covert Cloak with Shield Dust, an Air
  Balloon on Levitate.
- **The same request twice is not the same team.** Move scores, support values and item
  scores all take a nudge sized by the spice dial and seeded by the draw, so a Pokémon whose
  top five options are close together does not resolve them the same way every time. It is
  a nudge, not a coin flip: at spice 0 the drafter is fully deterministic, and redrawing the
  same seed gives the same answer.
- **Ability** — chosen for the base forme, always: a set that Mega Evolves stores the
  pre-Mega ability, because Gardevoir cannot "have" Pixilate.

**Team shape** is six measurements, not vibes: offense, bulk and speed come from the real
matrix against the threat list, coverage from the type table, support from the VGC role
checklist, resilience from stacked weaknesses with no resist.

None of this is a hard-coded sample team. What *is* curated is the VGC knowledge the dex
does not carry — that Fake Out is worth a slot and Splash is not — and it lives in named
tables at the top of `src/engine/setgen.ts` where you can argue with it.

---

## Format rules

Regulation data lives in `src/data/formats.ts`. Reg M-B (June 17 – September 2, 2026) is the
default:

- Doubles, bring 6 / pick 4, every Pokémon set to Level 50
- Stat Points, not EVs or IVs: 66 to spend, at most 32 in one stat, 1 point = exactly +1 stat.
  Every Pokémon behaves as though it had 31 IVs, so IVs are not modelled at all. Natures remain
  and still scale a stat by ±10%.
- Species Clause (no two with the same Pokédex number) and Item Clause
- Several Mega Stones may be carried, but only one Pokémon Mega Evolves per battle
- No Restricted, Legendary, Mythical, Paradox or Treasures of Ruin Pokémon
- Mega Lucario Z and Mega Garchomp Z are not legal in ranked play
- No Terastallization — Champions is built on Mega Evolution

Reg M-A, an M-B Singles variant, and an unrestricted sandbox format are also included.

### Where the data comes from, and what is approximate

Being straight about this, because a teambuilder that quietly guesses is worse than one that
tells you where it is guessing:

- **What is actually in Champions** — `src/data/champions.ts`, compiled by hand in
  August 2026 from the Regulation M-B announcement, Pikalytics' Reg M-B ranked battle
  data, and published item guides. It carries the item pool, the confirmed species, and
  the roster's known exceptions, each with the reasoning next to it. This is the layer
  that stops the app offering you things the game does not have — Assault Vest, Choice
  Band and Weakness Policy are not in Champions, and a spread built around one is
  unplayable however good the numbers look. It is also the layer most likely to go
  stale: a new regulation will move it, and pasting your in-game roster overrides it.
- **Species, moves, abilities, items, base stats, type chart, learnsets** — from `@pkmn/dex`,
  which already carries the Champions-era Mega Evolutions (Mega Staraptor with Contrary,
  Mega Baxcalibur, the `-Z` Megas, and the rest) with real stats and stone mappings.
  `npm run data` distils it into `src/data/generated/dex-data.json`, so the app ships one
  compact dataset instead of 4.8 MB of nine-generation Pokédex. One judgement call is baked
  in: the dex flags anything absent from Scarlet/Violet as "Past", which covers 22 Mega base
  species (Mawile, Kangaskhan, Absol, Steelix…) and *every* legacy Mega Stone. Champions is
  fed from Pokémon HOME and built around those Megas, so they are treated as legal here.
  Moves are the exception — Champions runs on Gen 9 mechanics, so a move cut from Gen 9
  really is gone.
- **Damage** — `@smogon/calc` on Gen 9 mechanics, with Mega formes applied as species
  overrides. Spread reduction, weather, terrain, screens, Helping Hand, Friend Guard,
  Intimidate, items and abilities all behave as they do in the calculator you already trust.
  The calculator predates Stat Points and rebuilds stats from EVs/IVs whenever it clones a
  Pokémon, so a spread is fed to it as synthetic base stats — the exact inverse of the level-50
  stat formula, checked both ways by `npm run check`.
- **One assumption is not verifiable offline**: whether Stat Points are added before or after
  the Nature multiplier. Champions states 1 point is exactly +1 stat, which only holds if the
  points come after, so that is what `statAt` in `src/engine/stats.ts` does — isolated to one
  function if it ever turns out otherwise.
- **Regulation rules** — from the public Reg M-A / M-B announcements. Reliable, and enforced
  as hard errors.
- **The species roster** — *partly verified*. Champions ships a curated roster (208 species
  and 75 Megas as of Reg M-B) and that list is not published in machine-readable form, so the
  app judges membership in four layers, hardest evidence first: regulation category rules
  (errors); the roster is final-stage only, with Pikachu, Eternal Flower Floette and Qwilfish
  as the known exceptions (also errors — this one rule removes several hundred Pokémon that
  could never be built); a confirmed list that can be cited, from ladder data and the
  regulation announcements; and everything else, selectable but badged, because "fully
  evolved and not a legendary" is not proof it is in the game. **Paste the in-game list into
  the Roster tab and the guessing stops.**
- **Threat list and usage weights** — from Pikalytics' Champions Reg M-B Season 3 ranked
  battle data (retrieved August 2026). The usage order is the real usage order and the moves,
  items and abilities are the ones that actually appear, with the percentages recorded in each
  entry's notes. Spreads are the exception: those are not published per Pokémon, so the Stat
  Points are the app's reading of each set's job and are the part most worth editing. Anything
  reconstructed rather than measured says so in its notes.
- **The item pool** — *researched, not official*. Held items in Champions are bought with VP
  in four tiers, and the pool is much smaller than the dex: the app ships 82 usable items
  where the dex offers 578. Anything outside it is a warning, not an error, and the Open
  sandbox format lifts the restriction entirely.
- **The M-A roster split** from M-B could not be verified offline and is reconstructed from
  the reported M-B additions.
- **Item list** — trimmed to what a Champions battle can use. The dex marks everything
  absent from Gen 9 as "Past", which removes Z-Crystals, Memories, Drives, fossils and the
  Gen 2 evolution drawer in one go (Mega Stones are the deliberate exception); on top of
  that, items with no battle effect at all — evolution stones, sell junk, the berries that
  only lower EVs — are dropped by name. 578 entries become ~160, grouped by category with
  the ones VGC actually runs first. Species-locked items (Light Ball, the Orbs) only appear
  on the species that can use them. The ordering inside "commonly used" is hand-made: no
  usage statistics exist for Champions.
- **Buildable formes** — Gigantamax, Totem, battle-only (Aegislash-Blade, Darmanitan-Zen)
  and item-locked formes (Silvally's memories, Genesect's drives) are not offered, since
  you cannot bring them to a battle. Neither is Floette-Eternal, which no game has released.
- **Sprites** load from Pokémon Showdown and fall back to type-coloured initials, so the app
  works offline and Champions-exclusive Megas without an upstream sprite still render cleanly.

---

## Layout

```
src/
  data/       dex wrappers, Mega registry, formats, roster model, item and move
              catalogues, species search, threat database
  engine/     stats · damage calc · legality · speed · coverage · threat matrix
              · Stat Point optimizer · game plans · set synthesis · pair synergy
              · the drafter · suggestions · Showdown import-export
  components/ UI
scripts/
  build-dataset.mjs distils @pkmn/dex into the compact dataset the app ships
  check-data.ts     validates the threat DB and exercises the engine offline
  smoke.mjs         builds a team through the real UI in Chromium
  draft-check.mjs   drives the drafter end to end and audits what it produced
  mobile-check.mjs  asserts the phone layout stays operable
  make-artifact.mjs packs the single-file build for embedding
  artifact-check.mjs runs that build with no network and no localStorage
```

The engine is plain TypeScript with no React dependency, so `npm run check` exercises the
damage math, the optimizer, legality and paste round-tripping without a browser.

---

## Single-file build

`npm run build:artifact` bundles the entire app — React, the dex, the damage
calculator, every asset — into one self-contained HTML file at
`artifact/champions-teambuilder.html` (~1.7 MB, ~390 KB over the wire). It makes no
external requests at all, so it runs behind a strict content-security policy, from a
`file://` URL, or fully offline.

Two things differ from the normal build. Remote sprites are compiled out and replaced
with type-coloured initials, since a sandboxed embed blocks external images anyway. And
`localStorage` is accessed through a guard that falls back to memory, because some
embedded contexts throw on access rather than on write — teams then last for the session
instead of persisting.

`npm run check:artifact` serves the file and asserts it: boots with `localStorage`
blocked, attempts zero external requests, and still computes learnsets, damage, the
threat matrix and the coach.
