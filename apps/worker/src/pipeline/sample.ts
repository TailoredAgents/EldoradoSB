import { prisma } from "@el-dorado/db";
import { XClient } from "../x/client";
import type { XUserTweetsResponse, XTweet } from "../x/types";

function getMetricNumber(n: unknown): number | undefined {
  if (typeof n !== "number") return undefined;
  if (!Number.isFinite(n)) return undefined;
  return n;
}

function tweetToSample(tweet: XTweet, handle: string) {
  const m = tweet.public_metrics ?? {};
  const reposts = getMetricNumber(m.repost_count ?? (m as any).retweet_count);
  return {
    postId: tweet.id,
    postedAt: tweet.created_at ? new Date(tweet.created_at) : null,
    text: tweet.text,
    permalink: `https://x.com/${handle}/status/${tweet.id}`,
    likes: getMetricNumber(m.like_count) ?? null,
    replies: getMetricNumber(m.reply_count) ?? null,
    reposts: reposts ?? null,
    quotes: getMetricNumber(m.quote_count) ?? null,
  };
}

export async function sampleRecentPosts(args: {
  x: XClient;
  prospectId: string;
  xUserId: string;
  handle: string;
  take: number;
}) {
  const res = await args.x.getJson<XUserTweetsResponse>(`users/${args.xUserId}/tweets`, {
    max_results: Math.min(Math.max(args.take, 5), 100),
    exclude: "retweets",
    "tweet.fields": ["created_at", "public_metrics"].join(","),
  });

  const tweets = res.data.data ?? [];
  const samples = tweets.map((t) => tweetToSample(t, args.handle));

  await prisma.postSample.createMany({
    data: samples.map((s) => ({
      ...s,
      prospectId: args.prospectId,
    })),
    skipDuplicates: true,
  });

  if (tweets.length > 0) {
    await prisma.prospect.update({
      where: { id: args.prospectId },
      data: { lastSampledAt: new Date() },
    });
  }

  return { postsReturned: tweets.length, insertedAttempted: samples.length };
}
