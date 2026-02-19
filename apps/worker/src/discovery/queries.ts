export type DiscoveryQuery = {
  id: string;
  label: string;
  query: string;
};

export const GENERAL_QUERIES: DiscoveryQuery[] = [
  { id: "gen_1", label: "POTD/best bet", query: '(POTD OR "pick of the day" OR "best bet") -is:retweet lang:en' },
  { id: "gen_2", label: "Parlay/SGP", query: '(parlay OR teaser OR "same game parlay" OR SGP) -is:retweet lang:en' },
  { id: "gen_3", label: "Props", query: '(props OR "player prop" OR "shot prop" OR "points prop") -is:retweet lang:en' },
  { id: "gen_4", label: "CLV/ROI/units", query: '("closing line" OR CLV OR ROI OR units) -is:retweet lang:en' },
  { id: "gen_5", label: "Tail/fade", query: "(tail OR tailing OR fade OR fading) -is:retweet lang:en" },
  { id: "gen_6", label: "Live/2H", query: '("live bet" OR "live betting" OR 2H OR "second half") -is:retweet lang:en' },
  { id: "gen_7", label: "Model/edge", query: '(model OR sim OR projection OR edge) (odds OR line) -is:retweet lang:en' },
  { id: "gen_8", label: "Slip/ticket", query: '("bet slip" OR ticket OR cashed) (parlay OR props OR ML) -is:retweet lang:en' },
];

export const SPORT_QUERIES: DiscoveryQuery[] = [
  { id: "nba_1", label: "NBA", query: "(NBA) (props OR parlay OR POTD OR units) -is:retweet lang:en" },
  { id: "nfl_1", label: "NFL", query: "(NFL) (spread OR total OR ML OR parlay OR POTD) -is:retweet lang:en" },
  { id: "mlb_1", label: "MLB", query: '(MLB) (NRFI OR YRFI OR "run line" OR ML OR POTD) -is:retweet lang:en' },
  { id: "nhl_1", label: "NHL", query: '(NHL) ("puck line" OR ML OR parlay OR POTD) -is:retweet lang:en' },
  { id: "soc_1", label: "Soccer", query: '(EPL OR UCL OR MLS OR soccer) (BTTS OR "Asian handicap" OR POTD) -is:retweet lang:en' },
  { id: "golf_1", label: "Golf", query: '(PGA OR golf) (outright OR "top 10" OR "top 20") -is:retweet lang:en' },
  { id: "ten_1", label: "Tennis", query: "(ATP OR WTA OR tennis) (sets OR games OR ML OR POTD) -is:retweet lang:en" },
];

export function selectQueriesForRun(runIndex: number): DiscoveryQuery[] {
  const gen = GENERAL_QUERIES[runIndex % GENERAL_QUERIES.length]!;
  const sport = SPORT_QUERIES[runIndex % SPORT_QUERIES.length]!;
  return [gen, sport];
}
