import type { DiscoveryQuery } from "./queries";
import { selectQueriesForRun } from "./queries";
import type { QueryYieldStat } from "./yield";

function mulberry32(seed: number) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function pickWeighted<T>(items: Array<{ item: T; weight: number }>, rand: () => number): T | null {
  const total = items.reduce((sum, x) => sum + x.weight, 0);
  if (total <= 0) return null;
  let r = rand() * total;
  for (const x of items) {
    r -= x.weight;
    if (r <= 0) return x.item;
  }
  return items[items.length - 1]?.item ?? null;
}

export type AdaptiveSelection = {
  queries: [DiscoveryQuery, DiscoveryQuery];
  debug: {
    general: { picked: string; explored: boolean; candidates: Array<{ id: string; score: number; discovered: number }> };
    sport: { picked: string; explored: boolean; candidates: Array<{ id: string; score: number; discovered: number }> };
    lookbackDays: number;
    epsilon: number;
  };
};

export function selectQueriesAdaptive(args: {
  runIndex: number;
  general: DiscoveryQuery[];
  sport: DiscoveryQuery[];
  yieldStats: Map<string, QueryYieldStat>;
  lookbackDays: number;
  epsilon: number; // exploration probability per pick
}): AdaptiveSelection {
  // If we have no yield stats yet, fall back to deterministic rotation.
  if (!args.yieldStats.size) {
    const [a, b] = selectQueriesForRun(args.runIndex) as [DiscoveryQuery, DiscoveryQuery];
    return {
      queries: [a, b],
      debug: {
        general: { picked: a.id, explored: false, candidates: [] },
        sport: { picked: b.id, explored: false, candidates: [] },
        lookbackDays: args.lookbackDays,
        epsilon: args.epsilon,
      },
    };
  }

  const rand = mulberry32(args.runIndex + Math.floor(Date.now() / (60 * 60 * 1000)));

  const makeCandidates = (pool: DiscoveryQuery[]) =>
    pool
      .map((q) => {
        const stat = args.yieldStats.get(q.id);
        return {
          q,
          score: stat?.score ?? 0,
          discovered: stat?.discovered ?? 0,
        };
      })
      .sort((a, b) => b.score - a.score);

  const generalCandidates = makeCandidates(args.general);
  const sportCandidates = makeCandidates(args.sport);

  const pickFrom = (candidates: Array<{ q: DiscoveryQuery; score: number; discovered: number }>) => {
    const explore = rand() < args.epsilon;
    if (explore) {
      const idx = Math.floor(rand() * candidates.length);
      return { picked: candidates[idx]!.q, explored: true };
    }

    // Exploit: weighted by a smoothed score; add tiny prior so new queries still have a chance.
    const weighted = candidates.map((c) => ({
      item: c.q,
      weight: 0.05 + c.score * 1.0,
    }));
    const picked = pickWeighted(weighted, rand) ?? candidates[0]!.q;
    return { picked, explored: false };
  };

  const genPick = pickFrom(generalCandidates);
  const sportPick = pickFrom(sportCandidates);

  return {
    queries: [genPick.picked, sportPick.picked],
    debug: {
      general: {
        picked: genPick.picked.id,
        explored: genPick.explored,
        candidates: generalCandidates.slice(0, 8).map((c) => ({
          id: c.q.id,
          score: Number(c.score.toFixed(4)),
          discovered: c.discovered,
        })),
      },
      sport: {
        picked: sportPick.picked.id,
        explored: sportPick.explored,
        candidates: sportCandidates.slice(0, 8).map((c) => ({
          id: c.q.id,
          score: Number(c.score.toFixed(4)),
          discovered: c.discovered,
        })),
      },
      lookbackDays: args.lookbackDays,
      epsilon: args.epsilon,
    },
  };
}

