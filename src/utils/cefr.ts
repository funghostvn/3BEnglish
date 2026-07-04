import { CategoryPerf } from '../types';

export const CEFR_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const;

// A level counts as "achieved" with >= PASS_ACCURACY accuracy over at least
// MIN_QUESTIONS_SOLID questions at that level. Between MIN_QUESTIONS_PROVISIONAL
// and MIN_QUESTIONS_SOLID questions the estimate is shown as provisional
// (tạm tính) so students get early feedback without overclaiming precision.
export const CEFR_PASS_ACCURACY = 0.7;
export const CEFR_MIN_QUESTIONS_SOLID = 30;
export const CEFR_MIN_QUESTIONS_PROVISIONAL = 10;

export interface CefrEstimate {
  level: string | null;     // highest achieved CEFR level, null when no level qualifies yet
  provisional: boolean;     // true when the winning level only has provisional sample size
  nextLevel: string | null; // the level right above the estimate (null at C2)
  // accuracy/total at nextLevel so the UI can show progress toward it
  nextAccuracy: number | null;
  nextTotal: number;
}

// Estimate a student's stable CEFR level from aggregated per-level
// correct/wrong counts (built from Attempt.difficultyPerf).
export function estimateCefrFromPerf(agg: { [level: string]: CategoryPerf }): CefrEstimate {
  let solid: string | null = null;
  let provisionalLevel: string | null = null;

  CEFR_LEVELS.forEach(level => {
    const v = agg[level];
    if (!v) return;
    const total = v.correct + v.wrong;
    if (total <= 0) return;
    const acc = v.correct / total;
    if (acc >= CEFR_PASS_ACCURACY) {
      if (total >= CEFR_MIN_QUESTIONS_SOLID) solid = level;
      else if (total >= CEFR_MIN_QUESTIONS_PROVISIONAL) provisionalLevel = level;
    }
  });

  // A solid level always beats a provisional one below it; a provisional level
  // ABOVE the solid one is still reported (as provisional) since it reflects
  // the most recent ceiling the student has touched.
  let level: string | null = solid;
  let provisional = false;
  if (provisionalLevel && (!solid || CEFR_LEVELS.indexOf(provisionalLevel as any) > CEFR_LEVELS.indexOf(solid as any))) {
    level = provisionalLevel;
    provisional = true;
  }

  const nextIdx = level ? CEFR_LEVELS.indexOf(level as any) + 1 : 0;
  const nextLevel = nextIdx < CEFR_LEVELS.length ? CEFR_LEVELS[nextIdx] : null;
  const nextPerf = nextLevel ? agg[nextLevel] : undefined;
  const nextTotal = nextPerf ? nextPerf.correct + nextPerf.wrong : 0;

  return {
    level,
    provisional,
    nextLevel,
    nextAccuracy: nextPerf && nextTotal > 0 ? nextPerf.correct / nextTotal : null,
    nextTotal,
  };
}
