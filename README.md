# Champions Teambuilder

A VGC teambuilder for **Pokémon Champions** — Showdown-style building with the damage
calculator wired into every screen, so the numbers that matter are already on the page
instead of behind a copy-paste round trip.

Runs entirely in the browser. No backend, no account, teams saved to local storage.

```bash
npm install
npm run dev            # http://localhost:5173
npm run build          # static bundle in dist/
npm run check          # offline data + engine sanity checks
npm run smoke          # drives the real UI in Chromium
npm run smoke:mobile   # same, at a phone viewport
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

**Build** — six slots, searchable species/item/ability/move pickers with learnset filtering,
EV sliders with live stat totals, and Mega Evolution handled the way the game handles it:
hold the stone, and the forme, typing, ability and stats all switch over everywhere in the
app. Showdown paste import/export both ways, including folding `Mega Charizard Y` back into
Charizard @ Charizardite Y.

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

**EV optimizer** — the part that saves the most time. Pick a threat and a move and it solves
for the cheapest spread that survives it, the minimum Attack investment that secures a KO, or
the Speed EVs (and nature) needed to outrun a benchmark. One click applies it to the set.

**Speed tiers** — your team laid against the metagame with boosts, Tailwind, weather
abilities, paralysis, Choice Scarf and Trick Room inversion, plus what share of the field
each Pokémon outruns.

**Analysis** — defensive type chart with ability immunities folded in (Levitate, Thick Fat,
Flash Fire…), attacking coverage, and a VGC role checklist: speed control, Protect count,
Fake Out, Intimidate, redirection, spread moves, priority.

**Coach** — reads the matrix and the team and tells you what to fix, most important first:
threats nothing answers (with concrete replacement Pokémon you can add in one click), stacked
weaknesses with no resist, missing roles, wasted EVs, Attack investment on a special
attacker, 0 Atk IV opportunities.

**Metagame** — the threat list every calculation runs against, fully editable. Paste the set
that just beat you and it becomes part of the analysis.

---

## Format rules

Regulation data lives in `src/data/formats.ts`. Reg M-B (June 17 – September 2, 2026) is the
default:

- Doubles, bring 6 / pick 4, every Pokémon set to Level 50
- Species Clause (no two with the same Pokédex number) and Item Clause
- Several Mega Stones may be carried, but only one Pokémon Mega Evolves per battle
- No Restricted, Legendary, Mythical, Paradox or Treasures of Ruin Pokémon
- Mega Lucario Z and Mega Garchomp Z are not legal in ranked play
- No Terastallization — Champions is built on Mega Evolution

Reg M-A, an M-B Singles variant, and an unrestricted sandbox format are also included.

### Where the data comes from, and what is approximate

Being straight about this, because a teambuilder that quietly guesses is worse than one that
tells you where it is guessing:

- **Species, moves, abilities, items, base stats, type chart, learnsets** — from `@pkmn/dex`,
  which already carries the Champions-era Mega Evolutions (Mega Staraptor with Contrary,
  Mega Baxcalibur, the `-Z` Megas, and the rest) with real stats and stone mappings.
- **Damage** — `@smogon/calc` on Gen 9 mechanics, with Mega formes applied as species
  overrides. Spread reduction, weather, terrain, screens, Helping Hand, Friend Guard,
  Intimidate, items and abilities all behave as they do in the calculator you already trust.
- **Regulation rules** — from the public Reg M-A / M-B announcements. Reliable, and enforced
  as hard errors.
- **The species roster** — *approximate*. Champions ships a curated roster (208 species and
  75 Megas as of Reg M-B) and that list is not published in any machine-readable form. So the
  app splits legality in two: regulation rules are errors, roster membership is a note. Every
  species with a Champions Mega Stone plus those named in official coverage are marked
  "in roster"; the rest are selectable but badged. **Paste the in-game list into the Roster
  tab and the guessing stops** — your list becomes authoritative for legality, the species
  picker and the counter suggestions.
- **Threat list and usage weights** — hand-picked for Reg M-B from format coverage, not
  scraped ladder statistics (Champions publishes none). Treat it as a starting point and edit
  it in the Metagame tab; everything downstream sharpens as it gets closer to your ladder.
- **The M-A roster split** from M-B could not be verified offline and is reconstructed from
  the reported M-B additions.
- **Sprites** load from Pokémon Showdown and fall back to a monogram, so the app works
  offline and Champions-exclusive Megas without an upstream sprite still render cleanly.

---

## Layout

```
src/
  data/       dex wrappers, Mega registry, formats, roster model, threat database
  engine/     stats · damage calc · legality · speed · coverage · threat matrix
              · EV optimizer · suggestions · Showdown import-export
  components/ UI
scripts/
  check-data.ts   validates the threat DB and exercises the engine offline
  smoke.mjs       builds a team through the real UI in Chromium
```

The engine is plain TypeScript with no React dependency, so `npm run check` exercises the
damage math, the optimizer, legality and paste round-tripping without a browser.
