import Dexie, { type EntityTable } from 'dexie';

// Core data model - minimal, no structure imposed on user
export interface MemoryEntry {
  id: string;
  text: string;
  timestamp: number;
  url?: string;
  title?: string;
  embedding?: number[]; // 384-dimensional vector from MiniLM
}

// GitHub PR data model
export interface GitHubPR {
  id: string; // PR node_id from GitHub
  number: number;
  title: string;
  body: string; // PR description (main content for LLM)
  url: string;
  repo: string; // owner/repo
  state: string; // open, closed, merged
  mergedAt: number | null;
  createdAt: number;
  additions: number;
  deletions: number;
  fetchedAt: number; // When we fetched this PR
}

// Settings storage
export interface Settings {
  key: string;
  value: string;
}

// Database singleton
const db = new Dexie('WorthKeepingDB') as Dexie & {
  entries: EntityTable<MemoryEntry, 'id'>;
  settings: EntityTable<Settings, 'key'>;
  githubPRs: EntityTable<GitHubPR, 'id'>;
};

// Schema - indexed for time-based queries
// Version 2 adds embedding field and settings table
// Version 3 adds GitHub PRs table
db.version(1).stores({
  entries: 'id, timestamp',
});

db.version(2).stores({
  entries: 'id, timestamp',
  settings: 'key',
});

db.version(3).stores({
  entries: 'id, timestamp',
  settings: 'key',
  githubPRs: 'id, repo, createdAt, mergedAt',
});

export { db };

// Helper to generate unique IDs
export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

// Save a new memory entry
export async function saveEntry(text: string, context?: { url?: string; title?: string }): Promise<MemoryEntry> {
  const entry: MemoryEntry = {
    id: generateId(),
    text: text.trim(),
    timestamp: Date.now(),
    url: context?.url,
    title: context?.title,
  };

  await db.entries.add(entry);
  return entry;
}

// Get entries for a time range
export async function getEntries(options?: {
  startTime?: number;
  endTime?: number;
  limit?: number;
}): Promise<MemoryEntry[]> {
  let query = db.entries.orderBy('timestamp').reverse();

  if (options?.startTime !== undefined) {
    query = db.entries
      .where('timestamp')
      .between(options.startTime, options.endTime ?? Date.now(), true, true)
      .reverse();
  }

  if (options?.limit) {
    return query.limit(options.limit).toArray();
  }

  return query.toArray();
}

// Get entries grouped by day
export async function getEntriesGroupedByDay(): Promise<Map<string, MemoryEntry[]>> {
  const entries = await getEntries();
  const grouped = new Map<string, MemoryEntry[]>();

  for (const entry of entries) {
    const dateKey = new Date(entry.timestamp).toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    if (!grouped.has(dateKey)) {
      grouped.set(dateKey, []);
    }
    grouped.get(dateKey)!.push(entry);
  }

  return grouped;
}

// Delete an entry
export async function deleteEntry(id: string): Promise<void> {
  await db.entries.delete(id);
}

// Get today's entries
export async function getTodayEntries(): Promise<MemoryEntry[]> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return getEntries({ startTime: today.getTime() });
}

// Get this week's entries
export async function getThisWeekEntries(): Promise<MemoryEntry[]> {
  const now = new Date();
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - now.getDay());
  startOfWeek.setHours(0, 0, 0, 0);

  return getEntries({ startTime: startOfWeek.getTime() });
}

// Update entry with embedding
export async function updateEntryEmbedding(id: string, embedding: number[]): Promise<void> {
  await db.entries.update(id, { embedding });
}

// Get entries without embeddings (for background processing)
export async function getEntriesWithoutEmbeddings(): Promise<MemoryEntry[]> {
  return db.entries.filter((entry) => !entry.embedding).toArray();
}

// Get all entries with embeddings (for semantic search)
export async function getEntriesWithEmbeddings(): Promise<MemoryEntry[]> {
  return db.entries.filter((entry) => !!entry.embedding).toArray();
}

// Settings helpers
export async function getSetting(key: string): Promise<string | null> {
  const setting = await db.settings.get(key);
  return setting?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await db.settings.put({ key, value });
}

export async function deleteSetting(key: string): Promise<void> {
  await db.settings.delete(key);
}

// GitHub PR helpers

// Save or update a GitHub PR (upsert)
export async function upsertGitHubPR(pr: GitHubPR): Promise<void> {
  await db.githubPRs.put(pr);
}

// Save multiple GitHub PRs (bulk upsert)
export async function upsertGitHubPRs(prs: GitHubPR[]): Promise<void> {
  await db.githubPRs.bulkPut(prs);
}

// Get all GitHub PRs
export async function getGitHubPRs(): Promise<GitHubPR[]> {
  return db.githubPRs.orderBy('createdAt').reverse().toArray();
}

// Get GitHub PRs in a time range
export async function getGitHubPRsInRange(startTime: number, endTime: number): Promise<GitHubPR[]> {
  return db.githubPRs
    .where('createdAt')
    .between(startTime, endTime, true, true)
    .reverse()
    .toArray();
}

// Get GitHub PR count
export async function getGitHubPRCount(): Promise<number> {
  return db.githubPRs.count();
}

// Delete all GitHub PRs (for clearing data)
export async function clearGitHubPRs(): Promise<void> {
  await db.githubPRs.clear();
}
