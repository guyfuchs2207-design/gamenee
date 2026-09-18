/**
 * A harvested + enriched table, shaped exactly as harvest.mjs writes one.
 *
 * The network is the only part of the pipeline these fixtures cannot stand in
 * for, so everything downstream of HTTP is tested against real-shaped data.
 * Fame figures are plausible mean monthly enwiki pageviews.
 */
export const animalDeaths = {
  id: "animal-deaths",
  prompt: "Human deaths caused per year",
  hint: "most → least",
  unit: "deaths / year",
  category: "animals",
  volatility: "evergreen",
  format: { kind: "compact" },
  sourceNote: "Fixture source, 2025",
  harvestedAt: "2026-09-18T00:00:00.000Z",
  enrichedAt: "2026-09-18T00:00:00.000Z",
  rows: [
    // Deliberately anti-correlated with fame: sharks are by far the most
    // famous and kill the fewest. This is the shape a good puzzle has.
    { entity: "Mosquitoes", key: "Q1234", value: 725000, article: "Mosquito", fame: 120000 },
    { entity: "Snakes", key: "Q2345", value: 100000, article: "Snake", fame: 210000 },
    { entity: "Dogs", key: "Q3456", value: 35000, article: "Dog", fame: 900000 },
    { entity: "Crocodiles", key: "Q4567", value: 1000, article: "Crocodile", fame: 300000 },
    { entity: "Hippos", key: "Q5678", value: 500, article: "Hippopotamus", fame: 400000 },
    { entity: "Sharks", key: "Q6789", value: 10, article: "Shark", fame: 1400000 },
    // Padding so the sampler has room to choose, plus two rows that must be
    // filtered: one too obscure, one too close to its neighbour.
    { entity: "Wolves", key: "Q7001", value: 8, article: "Wolf", fame: 350000 },
    { entity: "Jellyfish", key: "Q7002", value: 40, article: "Jellyfish", fame: 260000 },
    { entity: "Elephants", key: "Q7003", value: 600, article: "Elephant", fame: 500000 },
    { entity: "Bees", key: "Q7004", value: 55, article: "Bee", fame: 280000 },
    { entity: "Obscure parasite", key: "Q7005", value: 2000, article: "Obscure_parasite", fame: 40 },
    { entity: "Near duplicate", key: "Q7006", value: 725000 * 0.99, article: "Near_duplicate", fame: 250000 },
  ],
};

/** Fame tracks value almost exactly — the boring case the scorer should demote. */
export const predictable = {
  ...animalDeaths,
  id: "predictable",
  prompt: "Predictable metric",
  rows: [
    { entity: "Alpha", key: "P1", value: 1000000, article: "Alpha", fame: 1000000 },
    { entity: "Beta", key: "P2", value: 200000, article: "Beta", fame: 800000 },
    { entity: "Gamma", key: "P3", value: 40000, article: "Gamma", fame: 600000 },
    { entity: "Delta", key: "P4", value: 8000, article: "Delta", fame: 400000 },
    { entity: "Epsilon", key: "P5", value: 1600, article: "Epsilon", fame: 200000 },
    { entity: "Zeta", key: "P6", value: 320, article: "Zeta", fame: 100000 },
  ],
};
