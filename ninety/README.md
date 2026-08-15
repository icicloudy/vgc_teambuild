# Ninety

**Team preview, solved.** You get ninety seconds, six species against six species, and you
have to bring four of yours and lead two of them. That decision is worth more games than
anything you do in the builder, and nothing helps you with it.

This does.

```bash
npm run data:ninety     # cut the preview dataset out of the full dex (and validate it)
npm run dev:ninety      # http://localhost:5273
npm run build:ninety    # static bundle in dist-ninety/
npm run check:ninety    # offline engine checks
npm run check:ninety -- 42   # …and print a whole briefing for seed 42
npm run smoke:ninety    # drives the real UI in Chromium
```

It is a separate app from the teambuilder in the parent folder: its own root, its own
build, its own dataset, sharing only the generated dex the teambuilder also reads.

## What it actually does

### It plays the guessing game as a guessing game

Team preview is **simultaneous**. You choose four without seeing their four; they do the
same. That is a 15 × 15 matrix game, and it has the property every simultaneous game has:
*the four that beats what they usually bring is not the four that beats what they bring
once they know what you bring.* Those are different answers.

So the app solves the matrix — fictitious play, both sides repeatedly best-responding to
the other's history — and hands you three numbers instead of one:

- **the pick** — the best response to their equilibrium play
- **the worst case** — what the same four is worth if they read you perfectly
- **the mix** — how often the equilibrium actually brings each four, drawn as a bar down
  the side of the payoff grid

The grid is the whole game on one screen. A four that is deep blue across every column is
safe. A four that is deep blue in twelve columns and dark red in three is a *read*, and the
app tells you what the read costs. No list of four names can show you that difference, and
it is the entire skill.

### It knows it cannot see their items

At preview you see species. Not items, not moves, not spreads. Every number in this app is
therefore conditional on a guess, and the app is built to say so out loud:

> **13%** Garchomp is the Choice Scarf set — holding this four costs 6 points; you would
> want Incineroar and Sinistcha over Charizard and Kingambit.

Those probabilities are not invented. Champions ranked data publishes item distributions —
Garchomp is Life Orb 52% / Sitrus 14% / Choice Scarf 13%; Kingambit is Chople 43% / Black
Glasses 32% — so a species in this app is a *distribution over sets*, and the risk panel
re-solves the entire matchup with one species swapped to each alternative. What comes back
is the sentence a good player says at preview: "this is fine unless the Garchomp is Scarf."

If you have scouted them, or you are in game two, you can pin a set and the whole solve
moves.

### It grades you

The **Drill** deals a real matchup — one of the format's teams against a legal opponent six
drawn on published usage — and starts the same ninety-second clock the game does. You click
four in order; the first two are your leads, the way the game takes them. Then it scores
what you brought against what the solver would have.

The grade is a *share of the available equity*, not right-or-wrong, because most preview
calls are worth a handful of points and a trainer that shouts "wrong" at a two-point miss
is one you stop believing. When two fours really are equivalent, it says so.

## What the model is

Every sentence the app prints is generated from a number in the model. There is no prose
table anywhere in it. The rule in `engine/brief.ts` is the whole design: *no sentence
without a number behind it*, and when the numbers are close, say that instead.

**The unit is turns, not percentages.** The difference between a move that does 51% and one
that does 99% is nothing; the difference between 99% and 101% is the game. So a 1v1 read is
"how many turns do I need, how many do they need, who moves first" — the question a player
actually asks looking at the sprites.

**Damage** is the Gen 9 formula at Level 50 with Champions Stat Points (66 to spend, 32 to a
stat, every IV perfect), implemented here rather than pulled in: the whole 6 × 18 × both
directions × three weathers × two Intimidate stages table is precomputed once, so every one
of the 225 subset comparisons is a lookup and the drill can re-solve while you type.

**The regime is derived from the four you bring, not the six you own** — which is what makes
the choice interesting. Tailwind only exists if you bring the setter. Two weather setters
means the *slower* one wins, because it sets last. Trick Room beats Tailwind if the side
setting it is genuinely slow, and is a liability if it is not.

**The things that never show up in a damage roll** are priced as named edges, each carrying
the sentence it would be named with: Armor Tail turning off your Fake Out, spread moves
ignoring Rage Powder, Good as Gold refusing every status move you have, Chople Berry being
the reason Kingambit lives through a Close Combat, Disguise making every calculation against
Mimikyu a turn late.

## What it does not do

Stated because a model that hides its edges is worse than one that names them:

- **Last Respects is priced at 50 power**, its floor, because nothing has fainted at preview.
  Against a Basculegion that is the number on turn one and badly wrong on turn six.
- **Unburden and Stamina count at half effect** — they need a turn to happen first.
- **Switching is not simulated.** This answers which four to bring, not how to play them.
- **Spreads are nowhere published**, so every spread in `data/pool.json` is a reading of what
  the set is for. They are the first thing to edit.
- Nine of the twenty-four species have no published move data at all. They are labelled
  <kbd>guess</kbd> everywhere they appear.

## The data

`data/pool.json` is the whole metagame model and is meant to be edited. Each species carries
its sets, their published item shares, and a note quoting the evidence. `npm run data:ninety`
validates every move against the real learnset, every ability against the real ability list
and every spread against the 66/32 budget — a set that could not exist fails the build
instead of shipping as a fake read of the format.
