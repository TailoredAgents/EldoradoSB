import type { Prospect } from "@el-dorado/db";

export type QueuePolicyConfig = {
  valueCount: number;
  acceptanceCount: number;
  explorationCount: number;
  acceptanceMinForValue: number;
  performanceMinForAcceptance: number;
  performanceMinForExploration: number;
  maxPerSport: number;
};

type ScoredProspect = Prospect & {
  overallScore: number;
  performanceScore: number;
  acceptanceScore: number;
};

function isScored(p: Prospect): p is ScoredProspect {
  return (
    typeof p.overallScore === "number" &&
    typeof p.performanceScore === "number" &&
    typeof p.acceptanceScore === "number"
  );
}

function byDesc<T>(get: (t: T) => number) {
  return (a: T, b: T) => get(b) - get(a);
}

export function buildDailyQueue(args: {
  candidates: Prospect[];
  policy: QueuePolicyConfig;
  seed?: number;
}): Array<{ prospect: Prospect; reason: "value" | "acceptance" | "exploration" }> {
  const policy = args.policy;
  const scored = args.candidates.filter(isScored);

  const selected: Array<{ prospect: Prospect; reason: "value" | "acceptance" | "exploration" }> = [];
  const selectedIds = new Set<string>();
  const sportCounts = new Map<string, number>();

  const canTake = (p: Prospect) => {
    if (selectedIds.has(p.id)) return false;
    const sport = (p.primarySport ?? "").trim().toLowerCase();
    if (sport) {
      const count = sportCounts.get(sport) ?? 0;
      if (count >= policy.maxPerSport) return false;
    }
    return true;
  };

  const take = (p: Prospect, reason: "value" | "acceptance" | "exploration") => {
    selected.push({ prospect: p, reason });
    selectedIds.add(p.id);
    const sport = (p.primarySport ?? "").trim().toLowerCase();
    if (sport) sportCounts.set(sport, (sportCounts.get(sport) ?? 0) + 1);
  };

  const valuePool = scored
    .filter((p) => p.acceptanceScore >= policy.acceptanceMinForValue)
    .sort(byDesc((p) => p.overallScore));
  for (const p of valuePool) {
    if (selected.length >= policy.valueCount) break;
    if (!canTake(p)) continue;
    take(p, "value");
  }

  const acceptancePool = scored
    .filter((p) => p.performanceScore >= policy.performanceMinForAcceptance)
    .sort(byDesc((p) => p.acceptanceScore));
  for (const p of acceptancePool) {
    if (selected.filter((s) => s.reason === "acceptance").length >= policy.acceptanceCount) break;
    if (selected.length >= policy.valueCount + policy.acceptanceCount) break;
    if (!canTake(p)) continue;
    take(p, "acceptance");
  }

  // Exploration: pseudo-random but stable ordering with score bias (no LLM).
  const seed = args.seed ?? 0;
  const explorationPool = scored
    .filter((p) => p.performanceScore >= policy.performanceMinForExploration)
    .map((p) => ({
      p,
      // hash-ish shuffle: combine seed + id + overallScore
      key:
        (p.overallScore * 31 +
          seed * 997 +
          Array.from(p.id).reduce((acc, ch) => acc + ch.charCodeAt(0), 0)) %
        10_000,
    }))
    .sort(byDesc((x) => x.key));

  for (const { p } of explorationPool) {
    if (selected.filter((s) => s.reason === "exploration").length >= policy.explorationCount) break;
    const targetTotal = policy.valueCount + policy.acceptanceCount + policy.explorationCount;
    if (selected.length >= targetTotal) break;
    if (!canTake(p)) continue;
    take(p, "exploration");
  }

  return selected;
}

