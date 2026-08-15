/**
 * Prints whole drafts so a human can read the drafter's judgement.
 * Not a pass/fail check — `npm run check` is that. Run with: npx tsx scripts/inspect-draft.ts
 */
import { BUILT_IN_THREATS } from '../src/data/threats.ts';
import { getFormat } from '../src/data/formats.ts';
import { defaultField } from '../src/engine/calc.ts';
import { draftTeam } from '../src/engine/autobuild.ts';
import type { PlanId } from '../src/engine/plans.ts';

const format = getFormat('champs-mb-doubles')!;
const field = defaultField();

const plans = (process.argv[2]?.split(',') ?? ['balance', 'rain', 'trickroom']) as PlanId[];
const seeds = (process.argv[3]?.split(',') ?? ['1', '2']).map(Number);

for (const plan of plans) {
  for (const seed of seeds) {
    const res = draftTeam({
      team: [], format, threats: BUILT_IN_THREATS, field, override: null,
      options: { plan, spice: 0.4, banned: [], seed },
    });
    console.log(`\n========== ${plan}  seed ${seed} ==========`);
    for (const p of res.picks) {
      const m = p.set;
      console.log(`\n${m.species} @ ${m.item}  (${m.ability})  ${m.nature}`);
      console.log(`  ${m.moves.filter(Boolean).join(' / ')}`);
      console.log(`  SP ${Object.entries(m.sp).filter(([, v]) => v).map(([k, v]) => `${v} ${k}`).join(', ')}`);
      for (const r of p.reasons) console.log(`   · [${r.kind}] ${r.text}`);
      for (const n of p.notes) console.log(`   → ${n}`);
    }
  }
}
