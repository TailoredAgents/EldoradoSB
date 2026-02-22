import { prisma, Prisma } from "@el-dorado/db";
import { WorkerRunStatus } from "@el-dorado/db";
import { getOrCreateSettings } from "./settings";
import { getTodayUsage, incrementTodayUsage } from "./usage";
import { XClient, getBearerTokenFromEnv } from "./x/client";
import { getRunIndexUtc } from "./discovery/runIndex";
import { GENERAL_QUERIES, SPORT_QUERIES, selectQueriesForRun } from "./discovery/queries";
import { getQueryYieldStats } from "./discovery/yield";
import { selectQueriesAdaptive } from "./discovery/selectAdaptive";
import { discoverAuthorsFromQueries, upsertDiscoveredProspects } from "./pipeline/discover";
import { sampleRecentPosts } from "./pipeline/sample";
import {
  getModelExtract,
  getModelWrite,
  getOpenAiClient,
  hasOpenAiKey,
} from "./openai/client";
import {
  computeInputsHash,
  pickPrimarySport,
  runAnalyzer,
  type AnalyzerInput,
} from "./openai/analyzer";
import { ProspectStatus } from "@el-dorado/db";
import { buildDailyQueue } from "./queue/policy";
import { startOfDayApp } from "./time";
import { runWriter } from "./openai/writer";
import { ensureAccessToken } from "./x/credentials";
import { postTweet } from "./x/write";
import { XActionStatus, XActionType } from "@el-dorado/db";
import { runAutoPost } from "./x/autopost";
import { runOutboundEngagement } from "./x/outbound";
import { runInboundAutoReply } from "./x/inbound";

export type RunOptions = {
  dryRun: boolean;
  xTestPost?: boolean;
  xTestText?: string | null;
};

const ACTIVE_STATUSES: ProspectStatus[] = [
  ProspectStatus.new,
  ProspectStatus.queued,
  ProspectStatus.contacted,
  ProspectStatus.replied,
  ProspectStatus.negotiating,
];

export async function runOnce(options: RunOptions) {
  const run = await prisma.workerRun.create({
    data: {
      status: WorkerRunStatus.started,
      dryRun: options.dryRun,
      stats: { phase: 3, steps: ["budget", "stub"] },
    },
    select: { id: true, startedAt: true },
  });

  try {
    const settings = await getOrCreateSettings();
    if (!settings.enabled) {
      await prisma.workerRun.update({
        where: { id: run.id },
        data: {
          status: WorkerRunStatus.skipped_disabled,
          finishedAt: new Date(),
          stats: { phase: 3, reason: "disabled" },
        },
      });
      return { status: "skipped_disabled" as const, runId: run.id };
    }

    // Phase 3: scheduled auto-posting for the Eldorado account (does not consume post-read budget).
    let xAutoPost: Prisma.InputJsonValue | null = null;
    try {
      xAutoPost = (await runAutoPost({ dryRun: options.dryRun })) as unknown as Prisma.InputJsonValue;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      xAutoPost = { status: "error", error: message } as unknown as Prisma.InputJsonValue;
      try {
        await prisma.xActionLog.create({
          data: {
            actionType: XActionType.post,
            status: XActionStatus.error,
            reason: "autopost_error",
            meta: { message },
          },
        });
      } catch {
        // ignore: don't fail the whole run if logging fails
      }
    }

    // Manual test: post a tweet using OAuth credentials (safe: only when flag is provided).
    if (options.xTestPost) {
      if (options.dryRun) {
        await prisma.workerRun.update({
          where: { id: run.id },
          data: {
            status: WorkerRunStatus.success,
            finishedAt: new Date(),
            stats: { phase: "x_test_post", dryRun: true, xAutoPost },
          },
        });
        return { status: "success" as const, runId: run.id };
      }

      const text =
        (options.xTestText && String(options.xTestText).trim()) ||
        `Eldorado agent test post (${new Date().toISOString()})`;

      const accessToken = await ensureAccessToken();
      const posted = await postTweet({ accessToken, text });

      await prisma.xActionLog.create({
        data: {
          actionType: XActionType.post,
          status: XActionStatus.success,
          reason: "x_test_post",
          xId: posted.id ?? null,
          meta: { text, response: posted },
        },
      });

      await prisma.workerRun.update({
        where: { id: run.id },
        data: {
          status: WorkerRunStatus.success,
          finishedAt: new Date(),
          stats: { phase: "x_test_post", xId: posted.id ?? null, xAutoPost },
        },
      });
      return { status: "success" as const, runId: run.id };
    }

    const today = await getTodayUsage();
    if (today.xPostReads >= settings.maxPostReadsPerDay) {
      await prisma.workerRun.update({
        where: { id: run.id },
        data: {
          status: WorkerRunStatus.skipped_budget,
          finishedAt: new Date(),
          stats: {
            reason: "daily_post_cap_reached",
            today: { xPostReads: today.xPostReads, xUserLookups: today.xUserLookups },
            caps: { maxPostReadsPerDay: settings.maxPostReadsPerDay },
          },
        },
      });
      return { status: "skipped_budget" as const, runId: run.id };
    }

    const maxPostReadsThisRun = settings.maxPostReadsPerRun;
    const remainingToday = Math.max(0, settings.maxPostReadsPerDay - today.xPostReads);
    const remainingThisRunInitial = Math.min(maxPostReadsThisRun, remainingToday);

    if (remainingThisRunInitial <= 0) {
      await prisma.workerRun.update({
        where: { id: run.id },
        data: {
          status: WorkerRunStatus.skipped_budget,
          finishedAt: new Date(),
          stats: {
            reason: "no_remaining_budget",
            today: { xPostReads: today.xPostReads, xUserLookups: today.xUserLookups },
            caps: {
              maxPostReadsPerRun: settings.maxPostReadsPerRun,
              maxPostReadsPerDay: settings.maxPostReadsPerDay,
            },
            xAutoPost,
          },
        },
      });
      return { status: "skipped_budget" as const, runId: run.id };
    }

    let remainingThisRun = remainingThisRunInitial;

    // Phase 4: inbound auto-replies (mentions + DMs). Uses a small portion of the read budget.
    let xInbound: Prisma.InputJsonValue | null = null;
    let inboundPostReads = 0;
    try {
      const inboundReadBudget = Math.min(10, remainingThisRun);
      const inRes = await runInboundAutoReply({
        dryRun: options.dryRun,
        readBudget: inboundReadBudget,
      });
      xInbound = inRes as unknown as Prisma.InputJsonValue;
      if (inRes.status === "processed") inboundPostReads = inRes.postsRead;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      xInbound = { status: "error", error: message } as unknown as Prisma.InputJsonValue;
      try {
        await prisma.xActionLog.create({
          data: {
            actionType: XActionType.inbound_scan,
            status: XActionStatus.error,
            reason: "inbound_error",
            meta: { message },
          },
        });
      } catch {
        // ignore
      }
    }

    remainingThisRun = Math.max(0, remainingThisRun - inboundPostReads);

    // Phase 5: search-based outbound engagement (1 reply/run, limited daily quota).
    // Runs before discovery and uses a small portion of the read budget.
    let xOutbound: Prisma.InputJsonValue | null = null;
    let outboundPostReads = 0;
    try {
      const outboundReadBudget = Math.min(10, remainingThisRun);
      if (outboundReadBudget > 0) {
        const outRes = await runOutboundEngagement({
          dryRun: options.dryRun,
          readBudget: outboundReadBudget,
        });
        xOutbound = outRes as unknown as Prisma.InputJsonValue;
        if (outRes.status === "replied") outboundPostReads = outRes.postsRead;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      xOutbound = { status: "error", error: message } as unknown as Prisma.InputJsonValue;
      try {
        await prisma.xActionLog.create({
          data: {
            actionType: XActionType.outbound_comment,
            status: XActionStatus.error,
            reason: "outbound_error",
            meta: { message },
          },
        });
      } catch {
        // ignore
      }
    }

    remainingThisRun = Math.max(0, remainingThisRun - outboundPostReads);

    if (!options.dryRun) {
      const runIndex = getRunIndexUtc(90);
      const lookbackDays = 30;
      const epsilon = 0.15;
      const yieldStats = await getQueryYieldStats({ lookbackDays });
      const adaptive = selectQueriesAdaptive({
        runIndex,
        general: GENERAL_QUERIES,
        sport: SPORT_QUERIES,
        yieldStats,
        lookbackDays,
        epsilon,
      });
      const queries = adaptive.queries;

      if (!process.env.X_BEARER_TOKEN) {
        await prisma.workerRun.update({
          where: { id: run.id },
          data: {
            status: WorkerRunStatus.success,
            finishedAt: new Date(),
            stats: {
              phase: 4,
              note: "missing X_BEARER_TOKEN (skipping discovery pipeline)",
              xAutoPost,
              xInbound,
              xOutbound,
            },
          },
        });
        return { status: "success" as const, runId: run.id };
      }

      const x = new XClient({
        bearerToken: getBearerTokenFromEnv(),
        minDelayMs: 1200,
        maxRetries: 3,
      });

      // Discovery: 2 queries × 5 posts = 10 post reads target, capped by remaining budget.
      const perQuery = Math.max(1, Math.min(5, Math.floor(remainingThisRun / queries.length)));
      const discovered = await discoverAuthorsFromQueries({
        x,
        queries,
        maxResultsPerQuery: perQuery,
      });

      const discoveryPostReads = discovered.reduce((sum, r) => sum + r.postsReturned, 0);
      const upsertStats = await upsertDiscoveredProspects({ discovered });

      // Post budget allocation after discovery.
      const remainingAfterDiscovery = Math.max(0, remainingThisRun - discoveryPostReads);
      const refreshBudget = Math.min(5, remainingAfterDiscovery);
      const samplingBudget = Math.max(0, remainingAfterDiscovery - refreshBudget);

      // Refresh: trickle refresh a tiny rotating set of active prospects (non-done).
      const refreshPostsPerProspect = 3;
      const maxProspectsToRefresh = Math.floor(refreshBudget / refreshPostsPerProspect);
      const refreshedProspectIds: string[] = [];
      let refreshedPostReads = 0;
      let refreshedProspects = 0;

      if (maxProspectsToRefresh > 0) {
        const refreshCandidates = await prisma.prospect.findMany({
          where: { status: { in: ACTIVE_STATUSES } },
          orderBy: [{ lastSampledAt: "asc" }, { updatedAt: "asc" }],
          take: 50,
          select: { id: true, xUserId: true, handle: true, lastSampledAt: true },
        });

        for (const p of refreshCandidates) {
          if (refreshedProspects >= maxProspectsToRefresh) break;
          // Avoid refreshing those sampled in the last 12 hours.
          if (p.lastSampledAt && Date.now() - p.lastSampledAt.getTime() < 12 * 60 * 60 * 1000)
            continue;

          const sampled = await sampleRecentPosts({
            x,
            prospectId: p.id,
            xUserId: p.xUserId,
            handle: p.handle,
            take: refreshPostsPerProspect,
          });
          refreshedPostReads += sampled.postsReturned;
          refreshedProspects += 1;
          refreshedProspectIds.push(p.id);
        }
      }

      // Sampling: pick a few newly discovered authors and fetch 5 posts each until budget.
      const samplePerProspect = 5;
      const maxProspectsToSample = Math.floor(samplingBudget / samplePerProspect);

      let sampledPostReads = 0;
      let sampledProspects = 0;

      if (maxProspectsToSample > 0) {
        // Keep it simple: sample in discovery order, de-duped by userId.
        const seen = new Set<string>();
        for (const r of discovered) {
          for (const a of r.authors) {
            if (sampledProspects >= maxProspectsToSample) break;
            if (seen.has(a.xUserId)) continue;
            seen.add(a.xUserId);

            const prospect = await prisma.prospect.findUnique({
              where: { xUserId: a.xUserId },
              select: { id: true, handle: true },
            });
            if (!prospect) continue;

            const sampled = await sampleRecentPosts({
              x,
              prospectId: prospect.id,
              xUserId: a.xUserId,
              handle: prospect.handle,
              take: samplePerProspect,
            });
            sampledPostReads += sampled.postsReturned;
            sampledProspects += 1;
          }
          if (sampledProspects >= maxProspectsToSample) break;
        }
      }

      const xPostReadsDelta =
        inboundPostReads + outboundPostReads + discoveryPostReads + refreshedPostReads + sampledPostReads;

      // Analyzer step (Phase 5): score a small number of new prospects with enough samples.
      const modelExtract = getModelExtract();
      const maxAnalyzeNew = 5;
      const maxAnalyzeRefresh = 2;
      let analyzed = 0;
      let analyzedNew = 0;
      let analyzedRefresh = 0;
      let analyzerInputTokens = 0;
      let analyzerOutputTokens = 0;
      const analyzerEnabled = hasOpenAiKey();
      const openai = analyzerEnabled ? getOpenAiClient() : null;

      const discoveredUserIds = Array.from(
        new Set(discovered.flatMap((d) => d.authors.map((a) => a.xUserId))),
      );

      const newCandidates = await prisma.prospect.findMany({
        where: {
          status: ProspectStatus.new,
          overallScore: null,
          xUserId: { in: discoveredUserIds },
        },
        orderBy: [{ followers: "desc" }, { updatedAt: "desc" }],
        take: 25,
        select: {
          id: true,
          xUserId: true,
          handle: true,
          name: true,
          bio: true,
          url: true,
          location: true,
          followers: true,
          verified: true,
        },
      });

      const refreshCandidates =
        refreshedProspectIds.length > 0
          ? await prisma.prospect.findMany({
              where: {
                id: { in: refreshedProspectIds },
                overallScore: { not: null },
              },
              orderBy: [{ overallScore: "desc" }, { updatedAt: "desc" }],
              take: maxAnalyzeRefresh,
              select: {
                id: true,
                xUserId: true,
                handle: true,
                name: true,
                bio: true,
                url: true,
                location: true,
                followers: true,
                verified: true,
              },
            })
          : [];

      const analysisCandidates = [...newCandidates, ...refreshCandidates];

      for (const p of analysisCandidates) {
        if (!openai) break;
        // Determine whether this is a "new" or "refresh" analysis.
        const isRefresh = refreshCandidates.some((c) => c.id === p.id);
        if (!isRefresh && analyzedNew >= maxAnalyzeNew) continue;
        if (isRefresh && analyzedRefresh >= maxAnalyzeRefresh) continue;

        const posts = await prisma.postSample.findMany({
          where: { prospectId: p.id },
          orderBy: { sampledAt: "desc" },
          take: 5,
          select: { text: true, likes: true, replies: true, reposts: true, quotes: true },
        });
        if (posts.length < 5) continue;

        const input: AnalyzerInput = {
          prospect: {
            handle: p.handle,
            name: p.name,
            bio: p.bio,
            url: p.url,
            location: p.location,
            followers: p.followers,
            verified: p.verified,
          },
          posts,
        };
        const inputsHash = computeInputsHash(input);

        const existingScore = await prisma.scoreHistory.findUnique({
          where: { prospectId_inputsHash: { prospectId: p.id, inputsHash } },
          select: { id: true },
        });
        if (existingScore) continue;

        const analyzedRes = await runAnalyzer({
          client: openai,
          model: modelExtract,
          input,
        });

        analyzerInputTokens += analyzedRes.usage?.inputTokens ?? 0;
        analyzerOutputTokens += analyzedRes.usage?.outputTokens ?? 0;

        const performanceScore = analyzedRes.output.performance_score;
        const acceptanceScore = analyzedRes.output.acceptance_score;
        const overallScore = Math.round((performanceScore * acceptanceScore) / 100);
        const primarySport = pickPrimarySport(analyzedRes.output.features);

        await prisma.scoreHistory.create({
          data: {
            prospectId: p.id,
            inputsHash,
            features: analyzedRes.output.features as any,
            performanceScore,
            acceptanceScore,
            overallScore,
            tier: analyzedRes.output.tier,
            rationale: analyzedRes.output.rationale as any,
          },
        });

        await prisma.prospect.update({
          where: { id: p.id },
          data: {
            performanceScore,
            acceptanceScore,
            overallScore,
            tier: analyzedRes.output.tier,
            rationale: analyzedRes.output.rationale as any,
            usFocusConfidence: analyzedRes.output.features.us_focus,
            primarySport,
            lastAnalyzedAt: new Date(),
          },
        });

        analyzed += 1;
        if (isRefresh) analyzedRefresh += 1;
        else analyzedNew += 1;
      }

      // Queue selection (Phase 6): deterministic daily queue using stored scores.
      const queueDay = startOfDayApp(new Date());
      const alreadyQueuedToday = await prisma.prospect.count({
        where: { status: ProspectStatus.queued, queuedDay: queueDay },
      });

      const targetQueue = settings.queueValueCount + settings.queueAcceptanceCount + settings.queueExplorationCount;
      const needed = Math.max(0, Math.min(20, targetQueue) - alreadyQueuedToday);

      let queuedNow = 0;
      let queueReasons: Record<string, number> = { value: 0, acceptance: 0, exploration: 0 };

      if (needed > 0) {
        const eligible = await prisma.prospect.findMany({
          where: {
            status: ProspectStatus.new,
            overallScore: { not: null },
            queuedDay: null,
          },
          orderBy: [{ overallScore: "desc" }, { updatedAt: "desc" }],
          take: 300,
        });

        const queue = buildDailyQueue({
          candidates: eligible,
          policy: {
            valueCount: Math.min(settings.queueValueCount, needed),
            acceptanceCount: Math.min(settings.queueAcceptanceCount, needed),
            explorationCount: Math.min(settings.queueExplorationCount, needed),
            acceptanceMinForValue: 45,
            performanceMinForAcceptance: 50,
            performanceMinForExploration: 45,
            maxPerSport: 6,
          },
          seed: queueDay.getTime(),
        }).slice(0, needed);

        for (const item of queue) {
          await prisma.prospect.update({
            where: { id: item.prospect.id },
            data: {
              status: ProspectStatus.queued,
              queuedAt: new Date(),
              queuedDay: queueDay,
            },
          });
          queuedNow += 1;
          queueReasons[item.reason] = (queueReasons[item.reason] ?? 0) + 1;
        }
      }

      // Writer step (Phase 6): generate DM/email drafts for today's queued prospects.
      const writerEnabled = analyzerEnabled;
      const modelWrite = getModelWrite();
      let drafted = 0;
      let writerInputTokens = 0;
      let writerOutputTokens = 0;

      if (writerEnabled && openai) {
        const queuedForToday = await prisma.prospect.findMany({
          where: {
            status: ProspectStatus.queued,
            queuedDay: queueDay,
            OR: [{ dmDraft: null }, { emailBody: null }, { emailSubject: null }],
          },
          orderBy: [{ overallScore: "desc" }, { updatedAt: "desc" }],
          take: 20,
          select: {
            id: true,
            handle: true,
            name: true,
            bio: true,
            url: true,
            location: true,
            followers: true,
            tier: true,
            primarySport: true,
            rationale: true,
          },
        });

        for (const p of queuedForToday) {
          const rationale =
            Array.isArray(p.rationale)
              ? (p.rationale as unknown[])
                  .filter((x) => typeof x === "string")
                  .slice(0, 6)
              : null;

          const draftRes = await runWriter({
            client: openai,
            model: modelWrite,
            input: {
              prospect: {
                handle: p.handle,
                name: p.name,
                bio: p.bio,
                url: p.url,
                location: p.location,
                followers: p.followers,
                tier: p.tier,
                primarySport: p.primarySport,
                rationale: rationale as string[] | null,
              },
              offer: { revsharePercent: "15-20%" },
              disclaimerText: settings.disclaimerText ?? null,
            },
          });

          writerInputTokens += draftRes.usage?.inputTokens ?? 0;
          writerOutputTokens += draftRes.usage?.outputTokens ?? 0;

          await prisma.prospect.update({
            where: { id: p.id },
            data: {
              dmDraft: draftRes.output.dm_text,
              emailSubject: draftRes.output.email_subject,
              emailBody: draftRes.output.email_body,
              draftedAt: new Date(),
            },
          });

          drafted += 1;
        }
      }

      await incrementTodayUsage({
        xPostReads: xPostReadsDelta,
        xUserLookups: 0,
        llmTokensByModel: {
          ...(analyzerInputTokens || analyzerOutputTokens
            ? {
                [modelExtract]: analyzerInputTokens + analyzerOutputTokens,
              }
            : {}),
          ...(writerInputTokens || writerOutputTokens
            ? {
                [modelWrite]: writerInputTokens + writerOutputTokens,
              }
            : {}),
        },
      });

      await prisma.workerRun.update({
        where: { id: run.id },
        data: {
          xPostReadsDelta,
          xUserLookupsDelta: 0,
          status: WorkerRunStatus.success,
          finishedAt: new Date(),
          stats: {
            phase: 6,
            xAutoPost,
            xInbound,
            xOutbound,
            runIndex,
            queryIds: queries.map((q) => q.id),
            querySelection: adaptive.debug,
            budgets: {
              remainingThisRunInitial,
              inboundPostReads,
              outboundPostReads,
              remainingThisRunAfterInboundOutbound: remainingThisRun,
              discoveryTargetPerQuery: perQuery,
              refreshBudget,
              samplingBudget,
              samplePerProspect,
              maxProspectsToRefresh,
              maxProspectsToSample,
            },
            discovery: {
              postReads: discoveryPostReads,
              uniqueAuthors: upsertStats.uniqueAuthors,
              created: upsertStats.created,
              updated: upsertStats.updated,
            },
            refresh: {
              prospectsRefreshed: refreshedProspects,
              postReads: refreshedPostReads,
            },
            sampling: {
              prospectsSampled: sampledProspects,
              postReads: sampledPostReads,
            },
            analyzer: {
              enabled: analyzerEnabled,
              model: modelExtract,
              prospectsAnalyzed: analyzed,
              prospectsAnalyzedNew: analyzedNew,
              prospectsAnalyzedRefresh: analyzedRefresh,
              inputTokens: analyzerInputTokens,
              outputTokens: analyzerOutputTokens,
            },
            queue: {
              queueDay: queueDay.toISOString().slice(0, 10),
              alreadyQueuedToday,
              targetQueue,
              needed,
              queuedNow,
              reasons: queueReasons,
            },
            writer: {
              enabled: writerEnabled,
              model: modelWrite,
              drafted,
              inputTokens: writerInputTokens,
              outputTokens: writerOutputTokens,
            },
          },
        },
      });
      return { status: "success" as const, runId: run.id };
    }

    await prisma.workerRun.update({
      where: { id: run.id },
      data: {
        status: WorkerRunStatus.success,
        finishedAt: new Date(),
        stats: { phase: 4, dryRun: true, note: "dry run (no X/LLM)", xAutoPost, xInbound, xOutbound },
      },
    });

    return { status: "success" as const, runId: run.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    try {
      await prisma.workerRun.update({
        where: { id: run.id },
        data: {
          status: WorkerRunStatus.error,
          finishedAt: new Date(),
          errorMessage: message,
        },
      });
    } catch {
      // ignore: if DB is unhealthy, we may not be able to persist errors
    }
    throw err;
  }
}
