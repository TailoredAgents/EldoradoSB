export type XPublicMetrics = {
  like_count?: number;
  reply_count?: number;
  repost_count?: number;
  retweet_count?: number; // older naming in some payloads
  quote_count?: number;
};

export type XTweet = {
  id: string;
  text: string;
  author_id?: string;
  created_at?: string;
  lang?: string;
  public_metrics?: XPublicMetrics;
};

export type XUserMetrics = {
  followers_count?: number;
};

export type XUser = {
  id: string;
  username: string;
  name?: string;
  description?: string;
  location?: string;
  url?: string;
  verified?: boolean;
  public_metrics?: XUserMetrics;
};

export type XRecentSearchResponse = {
  data?: XTweet[];
  includes?: { users?: XUser[] };
  meta?: { result_count?: number; next_token?: string };
};

export type XUserTweetsResponse = {
  data?: XTweet[];
  meta?: { result_count?: number; next_token?: string };
};

