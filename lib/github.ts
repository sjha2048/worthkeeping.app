import {
  getSetting,
  setSetting,
  deleteSetting,
  upsertGitHubPRs,
  getGitHubPRCount,
  getGitHubPRsInRange,
  type GitHubPR,
} from './db';

// Settings keys for GitHub
const GITHUB_SETTINGS = {
  pat: 'github_pat',
  lastSync: 'github_last_sync',
};

// GitHub API base URL
const GITHUB_API = 'https://api.github.com';

// PAT Management

export async function saveGitHubPAT(pat: string): Promise<void> {
  await setSetting(GITHUB_SETTINGS.pat, pat);
}

export async function getGitHubPAT(): Promise<string | null> {
  return getSetting(GITHUB_SETTINGS.pat);
}

export async function clearGitHubPAT(): Promise<void> {
  await deleteSetting(GITHUB_SETTINGS.pat);
  await deleteSetting(GITHUB_SETTINGS.lastSync);
}

export async function getLastSyncTimestamp(): Promise<number | null> {
  const value = await getSetting(GITHUB_SETTINGS.lastSync);
  return value ? parseInt(value, 10) : null;
}

async function setLastSyncTimestamp(timestamp: number): Promise<void> {
  await setSetting(GITHUB_SETTINGS.lastSync, timestamp.toString());
}

// Validate PAT by calling /user endpoint
export async function validateGitHubPAT(pat: string): Promise<{ valid: boolean; username?: string; error?: string }> {
  try {
    const response = await fetch(`${GITHUB_API}/user`, {
      headers: {
        Authorization: `Bearer ${pat}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });

    if (response.ok) {
      const user = await response.json();
      return { valid: true, username: user.login };
    }

    if (response.status === 401) {
      return { valid: false, error: 'Invalid or expired token' };
    }

    return { valid: false, error: `GitHub API error: ${response.status}` };
  } catch (err) {
    return { valid: false, error: `Network error: ${err instanceof Error ? err.message : 'Unknown'}` };
  }
}

// GitHub Search API response types
interface GitHubSearchResponse {
  total_count: number;
  incomplete_results: boolean;
  items: GitHubSearchItem[];
}

interface GitHubSearchItem {
  node_id: string;
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  state: string;
  pull_request?: {
    merged_at: string | null;
  };
  created_at: string;
  updated_at: string;
  repository_url: string;
}

interface GitHubPRDetails {
  additions: number;
  deletions: number;
  merged_at: string | null;
}

// Fetch PR details to get additions/deletions
async function fetchPRDetails(pat: string, prUrl: string): Promise<GitHubPRDetails | null> {
  try {
    // Convert html_url to API URL
    // https://github.com/owner/repo/pull/123 -> https://api.github.com/repos/owner/repo/pulls/123
    const match = prUrl.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
    if (!match) return null;

    const [, owner, repo, number] = match;
    const response = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/pulls/${number}`, {
      headers: {
        Authorization: `Bearer ${pat}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });

    if (!response.ok) return null;

    const data = await response.json();
    return {
      additions: data.additions || 0,
      deletions: data.deletions || 0,
      merged_at: data.merged_at,
    };
  } catch {
    return null;
  }
}

// Extract repo name from repository_url
function extractRepoFromUrl(repositoryUrl: string): string {
  // https://api.github.com/repos/owner/repo -> owner/repo
  const match = repositoryUrl.match(/repos\/(.+)$/);
  return match ? match[1] : repositoryUrl;
}

// Fetch user's PRs using GitHub Search API
export async function fetchUserPRs(
  pat: string,
  options?: {
    since?: Date;
    page?: number;
    perPage?: number;
  }
): Promise<{ prs: GitHubPR[]; hasMore: boolean; totalCount: number }> {
  const page = options?.page ?? 1;
  const perPage = options?.perPage ?? 100;

  // Build search query
  let query = 'author:@me type:pr';
  if (options?.since) {
    const sinceStr = options.since.toISOString().split('T')[0];
    query += ` created:>=${sinceStr}`;
  }

  const url = new URL(`${GITHUB_API}/search/issues`);
  url.searchParams.set('q', query);
  url.searchParams.set('sort', 'created');
  url.searchParams.set('order', 'desc');
  url.searchParams.set('per_page', perPage.toString());
  url.searchParams.set('page', page.toString());

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${pat}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });

  if (!response.ok) {
    if (response.status === 403) {
      throw new Error('Rate limit exceeded. Please try again later.');
    }
    throw new Error(`GitHub API error: ${response.status}`);
  }

  const data: GitHubSearchResponse = await response.json();

  // Convert to our GitHubPR format
  const prs: GitHubPR[] = [];
  const now = Date.now();

  for (const item of data.items) {
    // Fetch PR details for additions/deletions
    const details = await fetchPRDetails(pat, item.html_url);

    const pr: GitHubPR = {
      id: item.node_id,
      number: item.number,
      title: item.title,
      body: item.body || '',
      url: item.html_url,
      repo: extractRepoFromUrl(item.repository_url),
      state: details?.merged_at ? 'merged' : item.state,
      mergedAt: details?.merged_at ? new Date(details.merged_at).getTime() : null,
      createdAt: new Date(item.created_at).getTime(),
      additions: details?.additions || 0,
      deletions: details?.deletions || 0,
      fetchedAt: now,
    };

    prs.push(pr);
  }

  const totalCount = data.total_count;
  const hasMore = page * perPage < totalCount;

  return { prs, hasMore, totalCount };
}

// Sync status type
export interface SyncStatus {
  lastSync: number | null;
  prCount: number;
  isSyncing: boolean;
  error?: string;
}

// Main sync function - fetches all PRs since last sync
export async function syncGitHubPRs(
  onProgress?: (message: string) => void
): Promise<{ success: boolean; newPRs: number; error?: string }> {
  const pat = await getGitHubPAT();
  if (!pat) {
    return { success: false, newPRs: 0, error: 'GitHub PAT not configured' };
  }

  try {
    const lastSync = await getLastSyncTimestamp();
    const since = lastSync ? new Date(lastSync) : undefined;

    onProgress?.(`Fetching PRs${since ? ` since ${since.toLocaleDateString()}` : ''}...`);

    let allPRs: GitHubPR[] = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      onProgress?.(`Fetching page ${page}...`);

      const result = await fetchUserPRs(pat, { since, page, perPage: 100 });
      allPRs = allPRs.concat(result.prs);
      hasMore = result.hasMore;
      page++;

      // Safety limit to avoid infinite loops
      if (page > 20) {
        console.warn('GitHub sync: Hit page limit (20)');
        break;
      }

      // Small delay to avoid rate limiting
      if (hasMore) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    if (allPRs.length > 0) {
      onProgress?.(`Saving ${allPRs.length} PRs...`);
      await upsertGitHubPRs(allPRs);
    }

    await setLastSyncTimestamp(Date.now());

    return { success: true, newPRs: allPRs.length };
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Unknown error';
    return { success: false, newPRs: 0, error };
  }
}

// Get current sync status
export async function getGitHubSyncStatus(): Promise<SyncStatus> {
  const lastSync = await getLastSyncTimestamp();
  const prCount = await getGitHubPRCount();

  return {
    lastSync,
    prCount,
    isSyncing: false,
  };
}

// Format PRs for LLM prompt
export function formatPRsForPrompt(prs: GitHubPR[]): string {
  if (prs.length === 0) return '';

  return prs
    .map((pr) => {
      const date = new Date(pr.createdAt).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
      const lines = pr.additions + pr.deletions;
      const mergedLabel = pr.mergedAt ? ' [MERGED]' : pr.state === 'open' ? ' [OPEN]' : '';

      let entry = `- [${date}] ${pr.title}${mergedLabel} (${pr.repo}, +${pr.additions}/-${pr.deletions})`;

      if (pr.body && pr.body.trim()) {
        // Truncate long descriptions
        const desc = pr.body.length > 500 ? pr.body.slice(0, 500) + '...' : pr.body;
        entry += `\n  Description: ${desc.replace(/\n/g, ' ')}`;
      }

      return entry;
    })
    .join('\n\n');
}

// Get PRs for a specific time range (used by buildReviewPrompt)
export async function getPRsForTimeRange(
  timeRange: 'week' | 'month' | 'quarter' | 'year' | 'all'
): Promise<GitHubPR[]> {
  const now = Date.now();
  let startTime: number;

  switch (timeRange) {
    case 'week':
      startTime = now - 7 * 24 * 60 * 60 * 1000;
      break;
    case 'month':
      startTime = now - 30 * 24 * 60 * 60 * 1000;
      break;
    case 'quarter':
      startTime = now - 90 * 24 * 60 * 60 * 1000;
      break;
    case 'year':
      startTime = now - 365 * 24 * 60 * 60 * 1000;
      break;
    case 'all':
      startTime = 0;
      break;
  }

  if (timeRange === 'all') {
    const { getGitHubPRs } = await import('./db');
    return getGitHubPRs();
  }

  return getGitHubPRsInRange(startTime, now);
}
