import type { FormatRules, LegalityIssue, PokemonSet, Team } from '../types';
import { STATS } from '../types';
import {
  abilitiesFor, getItem, getMove, getSpecies, learnsetSync, megaFromItem, megasFor, toID,
} from '../data/dex';
import { CATEGORY_LABELS, categoryViolation, rosterConfidence } from '../data/roster';
import type { RosterOverride } from '../data/roster';
import { MAX_EV_SINGLE, MAX_EV_TOTAL, evTotal, resolveForm } from './stats';
import { displayName } from './calc';
import { plural } from '../text';

function issue(
  level: LegalityIssue['level'],
  slot: number | null,
  code: string,
  message: string,
  fix?: string,
): LegalityIssue {
  return { level, slot, code, message, fix };
}

export function validateSet(
  set: PokemonSet,
  slot: number,
  format: FormatRules,
  override: RosterOverride | null,
): LegalityIssue[] {
  const out: LegalityIssue[] = [];
  const species = getSpecies(set.species);
  if (!species) {
    return [issue('error', slot, 'no-species', `"${set.species}" is not a Pokémon.`)];
  }
  const label = species.name;

  // --- species legality -------------------------------------------------
  const violation = categoryViolation(set.species, format);
  if (violation) {
    out.push(
      issue('error', slot, 'category',
        `${label} is a ${CATEGORY_LABELS[violation]} and is not legal in ${format.shortName}.`,
        'Pick a different Pokémon.'),
    );
  } else if (format.bannedSpecies.some((b) => toID(b) === toID(set.species))) {
    out.push(issue('error', slot, 'banned', `${label} is banned in ${format.shortName}.`));
  } else {
    const conf = rosterConfidence(set.species, format, override);
    if (conf === 'likely') {
      out.push(
        issue('info', slot, 'roster-likely',
          `${label} passes every rule, but is not on the app's verified Champions roster.`,
          'Check it exists in-game, or import the real roster from the Roster panel.'),
      );
    } else if (conf === 'unverified') {
      out.push(
        issue('warning', slot, 'roster-unverified',
          `${label} is probably not in the Champions roster (208 species as of Reg M-B).`,
          'Import the in-game roster from the Roster panel to make this check exact.'),
      );
    }
  }

  // --- mega -------------------------------------------------------------
  const stoneMega = megaFromItem(set.species, set.item);
  const rawStone = set.item && megasFor(set.species).find((m) => m.stoneId === toID(set.item));
  if (rawStone && !stoneMega) {
    out.push(
      issue('error', slot, 'mega-banned',
        `${displayName(rawStone.forme)} is not legal in ${format.shortName}.`,
        'Swap the Mega Stone for a normal item.'),
    );
  }
  if (set.item && !stoneMega) {
    const item = getItem(set.item);
    if (item?.megaStone && !rawStone) {
      out.push(
        issue('error', slot, 'wrong-stone',
          `${item.name} does nothing for ${label} — it belongs to another species.`),
      );
    }
  }

  // --- ability ----------------------------------------------------------
  const legalAbilities = abilitiesFor(set.species);
  if (!set.ability) {
    out.push(issue('warning', slot, 'no-ability', `${label} has no Ability selected.`));
  } else if (!legalAbilities.some((a) => toID(a) === toID(set.ability))) {
    out.push(
      issue('error', slot, 'bad-ability',
        `${label} cannot have ${set.ability}.`,
        `Legal: ${legalAbilities.join(', ')}.`),
    );
  }

  // --- item -------------------------------------------------------------
  if (set.item && !getItem(set.item)) {
    out.push(issue('error', slot, 'bad-item', `"${set.item}" is not an item.`));
  }
  if (set.item && format.bannedItems.some((i) => toID(i) === toID(set.item))) {
    out.push(issue('error', slot, 'banned-item', `${set.item} is banned in ${format.shortName}.`));
  }

  // --- moves ------------------------------------------------------------
  const filled = set.moves.filter(Boolean);
  if (filled.length === 0) {
    out.push(issue('error', slot, 'no-moves', `${label} has no moves.`));
  } else if (filled.length < 4) {
    out.push(issue('info', slot, 'few-moves', `${label} only has ${plural(filled.length, 'move')}.`));
  }
  const seenMoves = new Set<string>();
  const learnset = learnsetSync(set.species);
  for (const move of filled) {
    const m = getMove(move);
    if (!m) {
      out.push(issue('error', slot, 'bad-move', `"${move}" is not a move.`));
      continue;
    }
    if (seenMoves.has(m.id)) {
      out.push(issue('error', slot, 'dupe-move', `${label} has ${m.name} twice.`));
    }
    seenMoves.add(m.id);
    if (format.bannedMoves.some((b) => toID(b) === toID(move))) {
      out.push(issue('error', slot, 'banned-move', `${m.name} is banned in ${format.shortName}.`));
    }
    if (learnset && !learnset.some((l) => toID(l) === m.id)) {
      out.push(
        issue('warning', slot, 'not-learnable',
          `${label} does not appear to learn ${m.name}.`,
          'Move data comes from the Gen 9 dex plus transfer moves; verify in-game if unsure.'),
      );
    }
  }

  // --- EVs / IVs / level -------------------------------------------------
  const total = evTotal(set.evs);
  if (total > MAX_EV_TOTAL) {
    out.push(
      issue('error', slot, 'ev-total', `${label} uses ${total} EVs (max ${MAX_EV_TOTAL}).`),
    );
  }
  for (const s of STATS) {
    const ev = set.evs[s] ?? 0;
    if (ev > MAX_EV_SINGLE) {
      out.push(issue('error', slot, 'ev-single', `${label} has ${ev} ${s.toUpperCase()} EVs (max ${MAX_EV_SINGLE}).`));
    }
    if (ev < 0) out.push(issue('error', slot, 'ev-neg', `${label} has negative ${s} EVs.`));
    const iv = set.ivs[s] ?? 31;
    if (iv < 0 || iv > 31) out.push(issue('error', slot, 'iv-range', `${label} has an out-of-range ${s} IV.`));
  }
  if (set.level !== format.level) {
    out.push(
      issue('info', slot, 'level',
        `${format.shortName} sets every Pokémon to Level ${format.level}; this set is Level ${set.level}.`,
        'Damage numbers only match ranked play at the format level.'),
    );
  }

  // --- tera -------------------------------------------------------------
  if (set.teraType && !format.teraAllowed) {
    out.push(
      issue('info', slot, 'tera',
        'Terastallization does not exist in Pokémon Champions — the Tera type is ignored.'),
    );
  }

  return out;
}

export function validateTeam(
  team: Team,
  format: FormatRules,
  override: RosterOverride | null,
): LegalityIssue[] {
  const out: LegalityIssue[] = [];

  if (team.members.length === 0) {
    return [issue('info', null, 'empty', 'Add a Pokémon to get started.')];
  }
  if (team.members.length > format.bring) {
    out.push(issue('error', null, 'too-many', `${format.shortName} allows ${format.bring} Pokémon.`));
  } else if (team.members.length < format.bring) {
    out.push(
      issue('info', null, 'incomplete',
        `${team.members.length}/${format.bring} Pokémon — you bring ${format.bring} and pick ${format.pick}.`),
    );
  }

  // Species clause is by Pokédex number, so alternate formes collide too.
  if (format.speciesClause) {
    const byNum = new Map<number, number[]>();
    team.members.forEach((m, i) => {
      const s = getSpecies(m.species);
      if (!s) return;
      if (!byNum.has(s.num)) byNum.set(s.num, []);
      byNum.get(s.num)!.push(i);
    });
    for (const [, slots] of byNum) {
      if (slots.length > 1) {
        const name = getSpecies(team.members[slots[0]].species)?.name ?? '?';
        for (const slot of slots) {
          out.push(
            issue('error', slot, 'species-clause',
              `Species Clause: ${name} appears ${slots.length} times (same Pokédex number).`),
          );
        }
      }
    }
  }

  if (format.itemClause) {
    const byItem = new Map<string, number[]>();
    team.members.forEach((m, i) => {
      if (!m.item) return;
      const id = toID(m.item);
      if (!byItem.has(id)) byItem.set(id, []);
      byItem.get(id)!.push(i);
    });
    for (const [id, slots] of byItem) {
      if (slots.length > 1) {
        for (const slot of slots) {
          out.push(
            issue('error', slot, 'item-clause',
              `Item Clause: ${getItem(id)?.name ?? id} is held by ${slots.length} Pokémon.`),
          );
        }
      }
    }
  }

  const megaSlots = team.members
    .map((m, i) => (resolveForm(m, format)?.mega ? i : -1))
    .filter((i) => i >= 0);
  if (format.megaPerBattle > 0 && megaSlots.length > format.megaPerBattle) {
    out.push(
      issue('info', null, 'mega-count',
        `${megaSlots.length} Pokémon are holding Mega Stones. That is legal, but only ` +
        `${format.megaPerBattle} can Mega Evolve per battle.`),
    );
  }

  team.members.forEach((m, i) => out.push(...validateSet(m, i, format, override)));
  return out;
}

export function issueCounts(issues: LegalityIssue[]) {
  return {
    error: issues.filter((i) => i.level === 'error').length,
    warning: issues.filter((i) => i.level === 'warning').length,
    info: issues.filter((i) => i.level === 'info').length,
  };
}
