/**
 * Stage 4b — the LLM stands in for a player, to calibrate difficulty.
 *
 * The model is shown ONLY the metric and the six labels, never the values, and
 * asked to order them. Running several trials gives a predicted score
 * distribution, which is the closest cheap proxy for what real players will
 * average — and lets us drop puzzles that are trivially easy or pure guesswork
 * before anyone sees them.
 *
 * The rule this file exists to respect: the model NEVER supplies a number.
 * It is a stand-in player and nothing else. Every value in the library comes
 * from the harvested table. Model-recalled figures are confidently wrong often
 * enough to quietly poison a puzzle library, and a wrong value is invisible —
 * it just makes the "correct" order incorrect.
 *
 * Optional: without ANTHROPIC_API_KEY, or without --judge, the pipeline ranks
 * on the arithmetic signals alone.
 */
import { makeRng, shuffled, mean } from "./lib/stats.mjs";

/**
 * Trials are varied by shuffling how the six labels are presented, not by
 * temperature — sampling parameters are rejected on current models, and
 * shuffling is better methodology anyway: it cancels any positional bias in
 * how the model reads the list.
 */
export const DEFAULT_TRIALS = 4;
export const MODEL = process.env.PIPELINE_JUDGE_MODEL || "claude-opus-5";

let clientPromise = null;

async function getClient() {
  if (!clientPromise) {
    clientPromise = (async () => {
      const { default: Anthropic } = await import("@anthropic-ai/sdk");
      return new Anthropic();
    })();
  }
  return clientPromise;
}

const SYSTEM = `You are standing in for a well-read person playing a daily ranking puzzle.
Answer from general knowledge, the way someone would in under a minute. Do not
research, do not overthink, and do not hedge — commit to an order.
Reply with ONLY a JSON array of the six labels, most-first. No prose.`;

function buildPrompt(labels, prompt, hint) {
  return `Metric: ${prompt}
Order: ${hint}

Items (listed in no particular order):
${labels.map((l) => `- ${l}`).join("\n")}

Return the six labels as a JSON array, ordered ${hint}.`;
}

/** Pull the first JSON array out of a response, tolerating stray prose or fences. */
export function parseOrder(text, labels) {
  const match = String(text).match(/\[[\s\S]*?\]/);
  if (!match) return null;
  let parsed;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length !== labels.length) return null;

  // Match case-insensitively, and require an exact permutation — a response
  // that drops or invents an item is not a usable trial.
  const remaining = new Map(labels.map((l) => [l.toLowerCase(), l]));
  const order = [];
  for (const entry of parsed) {
    const key = String(entry).toLowerCase().trim();
    if (!remaining.has(key)) return null;
    order.push(remaining.get(key));
    remaining.delete(key);
  }
  return order;
}

/** How many labels the guess placed exactly right — the game's own scoring. */
export function scoreGuess(guess, truth) {
  return guess.reduce((n, label, i) => n + (label === truth[i] ? 1 : 0), 0);
}

/**
 * Run the trials for one candidate.
 * @returns {Promise<{predictedMean:number, scores:number[], trials:number}|null>}
 */
export async function judgeCandidate(candidate, { trials = DEFAULT_TRIALS, seed = 1 } = {}) {
  const client = await getClient();
  const truth = candidate.rows.map((r) => r.entity);
  const rng = makeRng(seed);
  const scores = [];

  for (let trial = 0; trial < trials; trial++) {
    const presented = shuffled(truth, rng);
    try {
      const response = await client.messages.create({
        model: MODEL,
        // Thinking is on by default on current models and its tokens count
        // toward this ceiling, so leave room even though the answer is tiny.
        max_tokens: 4000,
        // A player guesses; they do not deliberate for minutes. Low effort is
        // the closest analogue, and keeps a few hundred trials affordable.
        output_config: { effort: "low" },
        system: SYSTEM,
        messages: [{ role: "user", content: buildPrompt(presented, candidate.prompt, candidate.hint) }],
      });

      if (response.stop_reason === "refusal") continue;

      const text = response.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("");

      const order = parseOrder(text, truth);
      if (order) scores.push(scoreGuess(order, truth));
    } catch (err) {
      const { default: Anthropic } = await import("@anthropic-ai/sdk");
      if (err instanceof Anthropic.AuthenticationError) throw err; // no key: fail loudly, once
      if (err instanceof Anthropic.RateLimitError) {
        await new Promise((r) => setTimeout(r, 5000));
        continue;
      }
      if (err instanceof Anthropic.APIError) continue; // skip this trial
      throw err;
    }
  }

  if (scores.length === 0) return null;
  return { predictedMean: mean(scores), scores, trials: scores.length };
}

export function judgeAvailable() {
  return Boolean(
    process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_PROFILE
  );
}
