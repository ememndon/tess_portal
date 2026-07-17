/** A posting as an adapter returns it, before normalization or dedup. */
export type RawPosting = {
  /** stable id from the source: ATS job id, RSS guid, or a hash */
  externalId: string;
  title: string;
  companyName: string;
  location: string | null;
  countryCode: string | null;
  remote: string | null;
  url: string;
  description: string;
  salaryRaw: string | null;
  postedAt: Date | null;
  source: string;
  market: string | null;
};

/** One configured source row. */
export type SourceConfig = {
  id: string;
  countryCode: string;
  name: string;
  type: "ats" | "rss" | "crawl";
  config: Record<string, unknown>;
  proxyEnabled: boolean;
  enabled: boolean;
};

export type FetchContext = {
  /** proxy URL with credentials, present only when the source toggled it on */
  proxyUrl: string | null;
  log: (msg: string, extra?: Record<string, unknown>) => void;
};
