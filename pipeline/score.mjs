/**
 * Stage 4 — rank candidates by how good a puzzle they would make.
 *
 * Everything here is arithmetic on data already in hand; the optional LLM
 * judge (stage 4b) contributes a separate difficulty term.
 */
import { minSeparation, spread, surpriseScore, clamp01, gaussian } from "./lib/stats.mjs";

export const WEIGHTS = {
  surprise: 0.40, // the famous item not being the biggest is the whole appeal
  separation: 0.25, // knowable gaps — load-bearing for exact-placement scoring
  fame: 0.20, // every item recognisable
  spread: 0.15, // covers a real range
};

/** Recently-shipped entities are damped so the same six famous animals don't recur. */
const FRESHNESS_WINDOW_DAYS = 45;

export function freshnessPenalty(rows, ledger, now = Date.now()) {
  if (!ledger?.entities) return 1;
  let worst = 1;
  for (const row of rows) {
    const seen = ledger.entities[row.key];
    if (!seen?.lastUsedAt) continue;
    const ageDays = (now - seen.lastUsedAt) / 86400000;
    if (ageDays >= FRESHNESS_WINDOW_DAYS) continue;
    // Linear recovery: used today → 0.25, fully recovered at the window edge.
    worst = Math.min(worst, 0.25 + 0.75 * (ageDays / FRESHNESS_WINDOW_DAYS));
  }
  return worst;
}

/**
 * @param {Array<object>} rows six rows, sorted descending by value
 * @returns {{interest:number, signals:object}}
 */
export function scoreCandidate(rows, { ledger = null, now = Date.now(), weights = WEIGHTS } = {}) {
  const values = rows.map((r) => r.value);
  const fames = rows.map((r) => r.fame ?? 0);

  const separation = minSeparation(values);
  const magnitudes = spread(values);
  const surprise = surpriseScore(values, fames);
  const minFame = Math.min(...fames);

  const signals = {
    surprise,
    // A 4× tightest gap earns full marks; anything below ~1.35 was filtered out.
    separation: clamp01(Math.log(separation) / Math.log(4)),
    // Six figures of monthly pageviews on the *weakest* item is plenty famous.
    fame: clamp01(Math.log10(minFame + 1) / 6),
    // Three orders of magnitude between top and bottom reads as a real range.
    spread: clamp01(magnitudes / 3),
  };

  const base =
    weights.surprise * signals.surprise +
    weights.separation * signals.separation +
    weights.fame * signals.fame +
    weights.spread * signals.spread;

  const freshness = freshnessPenalty(rows, ledger, now);

  return {
    interest: base * freshness,
    signals: { ...signals, freshness, rawSeparation: separation, rawSpread: magnitudes, minFame },
  };
}

/**
 * Fold the judge's predicted player score into the ranking.
 *
 * The target band is deliberately low. A puzzle the model nails every time is
 * one every player nails; a puzzle it scores 0 on may be unknowable rather
 * than hard. Around 2/6 is where a puzzle is worth arguing about.
 */
export const DIFFICULTY_TARGET = 2.0;

export function applyJudge(score, predictedMean, weight = 0.5) {
  if (predictedMean == null) return score;
  const fit = gaussian(predictedMean, DIFFICULTY_TARGET, 1.6);
  return {
    ...score,
    interest: score.interest * (1 - weight) + score.interest * fit * weight + fit * weight * 0.15,
    signals: { ...score.signals, predictedMean, difficultyFit: fit },
  };
}
