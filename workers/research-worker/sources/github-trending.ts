import { researchConfig } from "../config";
import { RawSignal, ResearchSource } from "../types";
import { fetchWithRetry } from "../utils/fetch-with-retry";

type GitHubRepo = {
  full_name: string;
  html_url: string;
  description: string | null;
  stargazers_count: number;
  language: string | null;
  topics?: string[];
  updated_at?: string;
};

type GitHubSearchResponse = {
  items?: GitHubRepo[];
};

function githubHeaders(): HeadersInit {
  const token = process.env.GITHUB_TOKEN || process.env.GITHUB_ACCESS_TOKEN;
  const headers: HeadersInit = {
    Accept: "application/vnd.github+json",
    "User-Agent": "AutoBlogResearchBot/1.0",
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

export async function fetchGitHubTrendingSignals(): Promise<RawSignal[]> {
  const signals: RawSignal[] = [];

  for (const query of researchConfig.githubQueries) {
    const params = new URLSearchParams({
      q: query,
      sort: "stars",
      order: "desc",
      per_page: String(Math.min(20, researchConfig.maxSignalsPerSource)),
    });

    const res = await fetchWithRetry(`https://api.github.com/search/repositories?${params.toString()}`, {
      headers: githubHeaders(),
    });

    if (!res.ok) {
      throw new Error(`GitHub Trending fetch failed: ${res.status} ${res.statusText}`);
    }

    const data = (await res.json()) as GitHubSearchResponse;
    for (const repo of data.items ?? []) {
      signals.push({
        source: "github_trending",
        title: `${repo.full_name}${repo.description ? `: ${repo.description}` : ""}`,
        url: repo.html_url,
        description: repo.description ?? undefined,
        publishedAt: repo.updated_at ? new Date(repo.updated_at) : undefined,
        engagement: repo.stargazers_count,
        tags: [repo.language, ...(repo.topics ?? [])].filter(Boolean) as string[],
        raw: repo,
      });
    }
  }

  const byUrl = new Map<string, RawSignal>();
  for (const signal of signals) {
    if (signal.url && !byUrl.has(signal.url)) byUrl.set(signal.url, signal);
  }

  return Array.from(byUrl.values()).slice(0, researchConfig.maxSignalsPerSource);
}

export const githubTrendingSource: ResearchSource = {
  name: "github_trending",
  fetchSignals: fetchGitHubTrendingSignals,
};
