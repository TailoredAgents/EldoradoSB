import crypto from "node:crypto";
import type OpenAI from "openai";

export type AnalyzerInput = {
  prospect: {
    handle: string;
    name?: string | null;
    bio?: string | null;
    url?: string | null;
    location?: string | null;
    followers?: number | null;
    verified?: boolean | null;
  };
  posts: Array<{
    text: string;
    likes?: number | null;
    replies?: number | null;
    reposts?: number | null;
    quotes?: number | null;
  }>;
};

export type AnalysisFeatures = {
  sports: Record<string, number>;
  betting_relevance: number;
  promo_density: number;
  monetization_gap: number;
  operator_readiness: number;
  us_focus: number;
  notes: string[];
};

export function pickPrimarySport(features: AnalysisFeatures): string | null {
  let bestKey: string | null = null;
  let bestVal = -Infinity;
  for (const [k, v] of Object.entries(features.sports ?? {})) {
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    if (v > bestVal) {
      bestVal = v;
      bestKey = k;
    }
  }
  return bestKey;
}

export type AnalyzerOutput = {
  features: AnalysisFeatures;
  performance_score: number;
  acceptance_score: number;
  tier: "A" | "B" | "C";
  rationale: string[];
};

export function computeInputsHash(input: AnalyzerInput): string {
  const json = JSON.stringify(input);
  return crypto.createHash("sha256").update(json).digest("hex");
}

function clamp01(n: unknown): number {
  if (typeof n !== "number" || !Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function clampScore(n: unknown): number {
  if (typeof n !== "number" || !Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 100) return 100;
  return Math.round(n);
}

function isTier(t: unknown): t is "A" | "B" | "C" {
  return t === "A" || t === "B" || t === "C";
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x) => typeof x === "string").slice(0, 8) as string[];
}

function asSportsMap(v: unknown): Record<string, number> {
  if (!v || typeof v !== "object") return {};
  const out: Record<string, number> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof k !== "string") continue;
    const num = typeof val === "number" && Number.isFinite(val) ? val : 0;
    if (num <= 0) continue;
    out[k] = num;
  }
  return out;
}

export function normalizeAnalyzerOutput(raw: unknown): AnalyzerOutput {
  if (!raw || typeof raw !== "object") throw new Error("Analyzer output not an object");
  const obj = raw as Record<string, unknown>;

  const featuresRaw = obj.features;
  const featuresObj = (featuresRaw && typeof featuresRaw === "object"
    ? (featuresRaw as Record<string, unknown>)
    : {}) as Record<string, unknown>;

  const features: AnalysisFeatures = {
    sports: asSportsMap(featuresObj.sports),
    betting_relevance: clamp01(featuresObj.betting_relevance),
    promo_density: clamp01(featuresObj.promo_density),
    monetization_gap: clamp01(featuresObj.monetization_gap),
    operator_readiness: clamp01(featuresObj.operator_readiness),
    us_focus: clamp01(featuresObj.us_focus),
    notes: asStringArray(featuresObj.notes),
  };

  const tier = obj.tier;
  if (!isTier(tier)) throw new Error("Invalid tier");

  const rationale = asStringArray(obj.rationale);
  const performance_score = clampScore(obj.performance_score);
  const acceptance_score = clampScore(obj.acceptance_score);

  return { features, performance_score, acceptance_score, tier, rationale };
}

export async function runAnalyzer(args: {
  client: OpenAI;
  model: string;
  input: AnalyzerInput;
}): Promise<{ output: AnalyzerOutput; usage?: { inputTokens?: number; outputTokens?: number } }> {
  const schema = {
    type: "json_schema",
    name: "prospect_analysis",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["features", "performance_score", "acceptance_score", "tier", "rationale"],
      properties: {
        features: {
          type: "object",
          additionalProperties: false,
          required: [
            "sports",
            "betting_relevance",
            "promo_density",
            "monetization_gap",
            "operator_readiness",
            "us_focus",
            "notes",
          ],
          properties: {
            sports: {
              type: "object",
              additionalProperties: { type: "number" },
              description:
                "Map of sport/niche labels to weights (roughly sum to ~1). Keys examples: nba,nfl,mlb,nhl,soccer,golf,tennis,fantasy,news,meme.",
            },
            betting_relevance: { type: "number", minimum: 0, maximum: 1 },
            promo_density: { type: "number", minimum: 0, maximum: 1 },
            monetization_gap: { type: "number", minimum: 0, maximum: 1 },
            operator_readiness: { type: "number", minimum: 0, maximum: 1 },
            us_focus: { type: "number", minimum: 0, maximum: 1 },
            notes: { type: "array", items: { type: "string" }, maxItems: 8 },
          },
        },
        performance_score: { type: "number", minimum: 0, maximum: 100 },
        acceptance_score: { type: "number", minimum: 0, maximum: 100 },
        tier: { type: "string", enum: ["A", "B", "C"] },
        rationale: { type: "array", items: { type: "string" }, minItems: 3, maxItems: 6 },
      },
    },
  } as const;

  const response = await args.client.responses.create({
    model: args.model,
    instructions:
      "You analyze X accounts for sports betting ambassador outreach. Output STRICT JSON only, matching the schema. No markdown. The program will parse your output.\n\nScoring guidance:\n- performance_score (0-100): deposit potential proxies (real replies, consistency, sports/betting relevance)\n- acceptance_score (0-100): rev-share-only likelihood; prioritize accounts with a 'monetization gap' (low promo density) but enough operator readiness (email/link-in-bio, consistent posting)\n- tier: A/B/C overall priority\n- rationale: 3-6 crisp bullets for an internal outreach list.",
    input: JSON.stringify(args.input),
    temperature: 0.2,
    text: {
      format: schema,
    },
  });

  const text = (response as any).output_text as string | undefined;
  if (!text) throw new Error("No output_text from analyzer response");

  const parsed = JSON.parse(text) as unknown;
  const output = normalizeAnalyzerOutput(parsed);

  const usageAny = (response as any).usage as any | undefined;
  const usage =
    usageAny && typeof usageAny === "object"
      ? {
          inputTokens:
            typeof usageAny.input_tokens === "number" ? usageAny.input_tokens : undefined,
          outputTokens:
            typeof usageAny.output_tokens === "number" ? usageAny.output_tokens : undefined,
        }
      : undefined;

  return { output, usage };
}
