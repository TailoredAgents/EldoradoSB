type CreateTweetResponse = {
  data?: {
    id?: string;
    text?: string;
  };
};

function getApiBaseUrl(): string {
  return process.env.X_API_BASE_URL ?? "https://api.x.com/2";
}

export async function postTweet(args: { accessToken: string; text: string }): Promise<{ id?: string }> {
  const res = await fetch(`${getApiBaseUrl()}/tweets`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${args.accessToken}`,
      "content-type": "application/json",
      "user-agent": "ElDoradoSBOutreachAgent/1.0",
    },
    body: JSON.stringify({ text: args.text }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`X create tweet failed (${res.status}): ${text || res.statusText}`);
  }

  const json = (await res.json()) as CreateTweetResponse;
  return { id: json.data?.id };
}

export async function replyToTweet(args: {
  accessToken: string;
  text: string;
  inReplyToTweetId: string;
}): Promise<{ id?: string }> {
  const res = await fetch(`${getApiBaseUrl()}/tweets`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${args.accessToken}`,
      "content-type": "application/json",
      "user-agent": "ElDoradoSBOutreachAgent/1.0",
    },
    body: JSON.stringify({
      text: args.text,
      reply: { in_reply_to_tweet_id: args.inReplyToTweetId },
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`X reply failed (${res.status}): ${text || res.statusText}`);
  }

  const json = (await res.json()) as CreateTweetResponse;
  return { id: json.data?.id };
}
