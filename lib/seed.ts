import { db } from './db';

// Sample work entries for development
const SEED_ENTRIES = [
  // Today
  { text: 'Fixed the login bug that was causing session timeouts', daysAgo: 0, hour: 10 },
  { text: 'Code review for Sarah\'s PR on the payment flow', daysAgo: 0, hour: 14 },
  { text: 'Shipped the dark mode toggle to production', daysAgo: 0, hour: 16 },

  // Yesterday
  { text: 'Debugging memory leak in the dashboard component', daysAgo: 1, hour: 9 },
  { text: 'Paired with Jake on the API rate limiting implementation', daysAgo: 1, hour: 11 },
  { text: 'Wrote unit tests for the user authentication module', daysAgo: 1, hour: 15 },

  // 2 days ago
  { text: 'Sprint planning meeting - picked up the notification system epic', daysAgo: 2, hour: 10 },
  { text: 'Refactored the database queries for better performance', daysAgo: 2, hour: 14 },

  // 3 days ago
  { text: 'Investigated the slow API response times', daysAgo: 3, hour: 9 },
  { text: 'Added caching layer to the product listing endpoint', daysAgo: 3, hour: 13 },
  { text: 'Helped onboard new team member - walked through codebase', daysAgo: 3, hour: 16 },

  // 4 days ago
  { text: 'Fixed critical bug in checkout flow - users were getting charged twice', daysAgo: 4, hour: 10 },
  { text: 'Deployed hotfix to production', daysAgo: 4, hour: 11 },

  // 5 days ago
  { text: 'Started working on the new search feature', daysAgo: 5, hour: 9 },
  { text: 'Designed the database schema for search indexing', daysAgo: 5, hour: 14 },

  // 6 days ago
  { text: 'Weekly team sync - demoed the dark mode feature', daysAgo: 6, hour: 10 },
  { text: 'Reviewed and merged 3 PRs', daysAgo: 6, hour: 15 },

  // Week 2
  { text: 'Implemented elasticsearch integration', daysAgo: 8, hour: 10 },
  { text: 'Fixed flaky tests in CI pipeline', daysAgo: 8, hour: 14 },
  { text: 'Wrote documentation for the new API endpoints', daysAgo: 9, hour: 11 },
  { text: 'Performance optimization - reduced page load by 40%', daysAgo: 10, hour: 15 },
  { text: 'Mentored junior dev on React best practices', daysAgo: 11, hour: 14 },
  { text: '1:1 with manager - discussed career growth', daysAgo: 12, hour: 10 },

  // Week 3
  { text: 'Launched the beta version of mobile app', daysAgo: 15, hour: 16 },
  { text: 'Fixed accessibility issues flagged in audit', daysAgo: 16, hour: 11 },
  { text: 'Migrated legacy code to TypeScript', daysAgo: 17, hour: 14 },
  { text: 'Set up monitoring and alerting for production', daysAgo: 18, hour: 10 },

  // Week 4
  { text: 'Completed the user analytics dashboard', daysAgo: 22, hour: 15 },
  { text: 'Bug bash - found and logged 12 issues', daysAgo: 23, hour: 11 },
  { text: 'Shipped email notification system', daysAgo: 24, hour: 16 },
  { text: 'Optimized database indexes - 3x query speedup', daysAgo: 25, hour: 14 },

  // Month 2
  { text: 'Led the technical design review for payments v2', daysAgo: 35, hour: 10 },
  { text: 'Implemented webhook system for third-party integrations', daysAgo: 38, hour: 14 },
  { text: 'Resolved security vulnerability in auth flow', daysAgo: 42, hour: 11 },
  { text: 'Gave tech talk on caching strategies', daysAgo: 45, hour: 15 },

  // Month 3
  { text: 'Shipped major feature - team collaboration tools', daysAgo: 60, hour: 16 },
  { text: 'Reduced AWS costs by 25% through optimization', daysAgo: 65, hour: 10 },
  { text: 'Interviewed 3 engineering candidates', daysAgo: 70, hour: 14 },
  { text: 'Completed on-call rotation - handled 2 incidents', daysAgo: 75, hour: 9 },
];

function generateId(): string {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

function getTimestamp(daysAgo: number, hour: number): number {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  date.setHours(hour, Math.floor(Math.random() * 60), 0, 0);
  return date.getTime();
}

export async function seedDatabase(): Promise<number> {
  // Check if already seeded
  const existingCount = await db.entries.count();
  if (existingCount > 0) {
    console.log('WorthKeeping: Database already has entries, skipping seed');
    return existingCount;
  }

  console.log('WorthKeeping: Seeding database with sample entries...');

  const entries = SEED_ENTRIES.map((entry) => ({
    id: generateId(),
    text: entry.text,
    timestamp: getTimestamp(entry.daysAgo, entry.hour),
  }));

  await db.entries.bulkAdd(entries);

  console.log(`WorthKeeping: Seeded ${entries.length} entries`);
  return entries.length;
}

export async function clearDatabase(): Promise<void> {
  await db.entries.clear();
  await db.settings.clear();
  console.log('WorthKeeping: Database cleared');
}

// Auto-seed in development
export async function autoSeedIfDev(): Promise<void> {
  if (import.meta.env.DEV) {
    const count = await seedDatabase();
    console.log('WorthKeeping: Dev seed complete, entries:', count);
  }
}

// Force reseed (clears existing data)
export async function forceReseed(): Promise<number> {
  await clearDatabase();
  const entries = SEED_ENTRIES.map((entry) => ({
    id: generateId(),
    text: entry.text,
    timestamp: getTimestamp(entry.daysAgo, entry.hour),
  }));
  await db.entries.bulkAdd(entries);
  console.log(`WorthKeeping: Force reseeded ${entries.length} entries`);
  return entries.length;
}
