import { prisma } from "@el-dorado/db";
import { ProspectStatus } from "@el-dorado/db";
import { XClient } from "../x/client";
import type { XRecentSearchResponse, XUser, XTweet } from "../x/types";
import type { DiscoveryQuery } from "../discovery/queries";

export type DiscoveryResult = {
  queryId: string;
  postsReturned: number;
  authors: Array<{
    sourceQueryId: string;
    xUserId: string;
    handle: string;
    name?: string;
    bio?: string;
    url?: string;
    location?: string;
    followers?: number;
    verified?: boolean;
    discovery: {
      postId: string;
      text: string;
      createdAt?: string;
      replies?: number;
      likes?: number;
      reposts?: number;
      quotes?: number;
    };
  }>;
};

function getMetricNumber(n: unknown): number | undefined {
  if (typeof n !== "number") return undefined;
  if (!Number.isFinite(n)) return undefined;
  return n;
}

function tweetToDiscovery(tweet: XTweet) {
  const m = tweet.public_metrics ?? {};
  const reposts = getMetricNumber(m.repost_count ?? (m as any).retweet_count);
  return {
    postId: tweet.id,
    text: tweet.text,
    createdAt: tweet.created_at,
    replies: getMetricNumber(m.reply_count),
    likes: getMetricNumber(m.like_count),
    reposts,
    quotes: getMetricNumber(m.quote_count),
  };
}

function userToProspect(user: XUser) {
  return {
    xUserId: user.id,
    handle: user.username,
    name: user.name,
    bio: user.description,
    url: user.url,
    location: user.location,
    followers: user.public_metrics?.followers_count,
    verified: user.verified,
  };
}

export async function discoverAuthorsFromQueries(args: {
  x: XClient;
  queries: DiscoveryQuery[];
  maxResultsPerQuery: number;
}): Promise<DiscoveryResult[]> {
  const results: DiscoveryResult[] = [];

  for (const q of args.queries) {
    const res = await args.x.getJson<XRecentSearchResponse>("tweets/search/recent", {
      query: q.query,
      max_results: args.maxResultsPerQuery,
      "tweet.fields": ["author_id", "created_at", "public_metrics"].join(","),
      expansions: "author_id",
      "user.fields": ["username", "name", "description", "location", "url", "verified", "public_metrics"].join(","),
    });

    const tweets = res.data.data ?? [];
    const users = res.data.includes?.users ?? [];
    const byUserId = new Map<string, XUser>(users.map((u) => [u.id, u]));

    const authors: DiscoveryResult["authors"] = [];
    for (const tweet of tweets) {
      const userId = tweet.author_id;
      if (!userId) continue;
      const user = byUserId.get(userId);
      if (!user) continue;

      authors.push({
        sourceQueryId: q.id,
        ...userToProspect(user),
        discovery: tweetToDiscovery(tweet),
      });
    }

    results.push({
      queryId: q.id,
      postsReturned: tweets.length,
      authors,
    });
  }

  return results;
}

export async function upsertDiscoveredProspects(args: {
  discovered: DiscoveryResult[];
}) {
  const unique = new Map<string, DiscoveryResult["authors"][number]>();
  for (const r of args.discovered) {
    for (const a of r.authors) {
      if (!unique.has(a.xUserId)) unique.set(a.xUserId, a);
    }
  }

  let created = 0;
  let updated = 0;

  for (const a of unique.values()) {
    const existing = await prisma.prospect.findUnique({
      where: { xUserId: a.xUserId },
      select: { id: true, firstDiscoveredAt: true, firstDiscoveredQueryId: true },
    });

    if (!existing) {
      await prisma.prospect.create({
        data: {
          xUserId: a.xUserId,
          handle: a.handle,
          name: a.name ?? null,
          bio: a.bio ?? null,
          url: a.url ?? null,
          location: a.location ?? null,
          followers: a.followers ?? null,
          verified: a.verified ?? null,
          status: ProspectStatus.new,
          firstDiscoveredAt: new Date(),
          firstDiscoveredQueryId: a.sourceQueryId,
        },
      });
      created += 1;
    } else {
      await prisma.prospect.update({
        where: { xUserId: a.xUserId },
        data: {
          handle: a.handle,
          name: a.name ?? null,
          bio: a.bio ?? null,
          url: a.url ?? null,
          location: a.location ?? null,
          followers: a.followers ?? null,
          verified: a.verified ?? null,
          ...(existing.firstDiscoveredAt == null
            ? {
                firstDiscoveredAt: new Date(),
                firstDiscoveredQueryId: a.sourceQueryId,
              }
            : {}),
        },
      });
      updated += 1;
    }
  }

  return { uniqueAuthors: unique.size, created, updated };
}
