import { type MemoryEntry } from './db';

// Time range helpers
export interface TimeRange {
  start: Date;
  end: Date;
  label: string;
}

export function getTimeRanges(): Record<string, TimeRange> {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const startOfWeek = new Date(today);
  startOfWeek.setDate(today.getDate() - today.getDay());

  const startOfLastWeek = new Date(startOfWeek);
  startOfLastWeek.setDate(startOfLastWeek.getDate() - 7);

  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const startOfQuarter = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);

  return {
    today: { start: today, end: now, label: 'Today' },
    thisWeek: { start: startOfWeek, end: now, label: 'This Week' },
    lastWeek: { start: startOfLastWeek, end: startOfWeek, label: 'Last Week' },
    thisMonth: { start: startOfMonth, end: now, label: 'This Month' },
    thisQuarter: { start: startOfQuarter, end: now, label: 'This Quarter' },
  };
}

// Site/domain extraction
export function extractDomain(url?: string): string | null {
  if (!url) return null;
  try {
    const hostname = new URL(url).hostname;
    return hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

// Get favicon URL for a domain
export function getFaviconUrl(domain: string): string {
  return `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
}

// Site stats
export interface SiteStats {
  domain: string;
  count: number;
  percentage: number;
}

export function getSiteStats(entries: MemoryEntry[]): SiteStats[] {
  const siteCounts = new Map<string, number>();

  for (const entry of entries) {
    const domain = extractDomain(entry.url);
    if (domain) {
      siteCounts.set(domain, (siteCounts.get(domain) || 0) + 1);
    }
  }

  const total = entries.length;
  return Array.from(siteCounts.entries())
    .map(([domain, count]) => ({
      domain,
      count,
      percentage: Math.round((count / total) * 100),
    }))
    .sort((a, b) => b.count - a.count);
}

// Time of day stats
export type TimeOfDay = 'morning' | 'afternoon' | 'evening' | 'night';

export interface TimeOfDayStats {
  period: TimeOfDay;
  label: string;
  count: number;
  percentage: number;
}

function getTimeOfDay(date: Date): TimeOfDay {
  const hour = date.getHours();
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 21) return 'evening';
  return 'night';
}

export function getTimeOfDayStats(entries: MemoryEntry[]): TimeOfDayStats[] {
  const counts: Record<TimeOfDay, number> = {
    morning: 0,
    afternoon: 0,
    evening: 0,
    night: 0,
  };

  for (const entry of entries) {
    const tod = getTimeOfDay(new Date(entry.timestamp));
    counts[tod]++;
  }

  const total = entries.length || 1;
  const labels: Record<TimeOfDay, string> = {
    morning: 'Morning (5am-12pm)',
    afternoon: 'Afternoon (12pm-5pm)',
    evening: 'Evening (5pm-9pm)',
    night: 'Night (9pm-5am)',
  };

  return (['morning', 'afternoon', 'evening', 'night'] as TimeOfDay[]).map((period) => ({
    period,
    label: labels[period],
    count: counts[period],
    percentage: Math.round((counts[period] / total) * 100),
  }));
}

// Day of week stats
export interface DayOfWeekStats {
  day: number; // 0 = Sunday
  label: string;
  count: number;
}

export function getDayOfWeekStats(entries: MemoryEntry[]): DayOfWeekStats[] {
  const counts = [0, 0, 0, 0, 0, 0, 0];
  const labels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  for (const entry of entries) {
    const day = new Date(entry.timestamp).getDay();
    counts[day]++;
  }

  return counts.map((count, day) => ({
    day,
    label: labels[day],
    count,
  }));
}

// Streak calculation
export interface StreakInfo {
  current: number;
  longest: number;
  isActive: boolean; // true if captured something today
}

export function getStreakInfo(entries: MemoryEntry[]): StreakInfo {
  if (entries.length === 0) {
    return { current: 0, longest: 0, isActive: false };
  }

  // Get unique days with entries
  const daysWithEntries = new Set<string>();
  for (const entry of entries) {
    const date = new Date(entry.timestamp);
    const dateKey = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
    daysWithEntries.add(dateKey);
  }

  // Sort days
  const sortedDays = Array.from(daysWithEntries).sort().reverse();

  // Check if today has entries
  const today = new Date();
  const todayKey = `${today.getFullYear()}-${today.getMonth()}-${today.getDate()}`;
  const isActive = daysWithEntries.has(todayKey);

  // Calculate current streak
  let currentStreak = 0;
  let checkDate = new Date(today);

  // If no entry today, start from yesterday
  if (!isActive) {
    checkDate.setDate(checkDate.getDate() - 1);
  }

  while (true) {
    const key = `${checkDate.getFullYear()}-${checkDate.getMonth()}-${checkDate.getDate()}`;
    if (daysWithEntries.has(key)) {
      currentStreak++;
      checkDate.setDate(checkDate.getDate() - 1);
    } else {
      break;
    }
  }

  // Calculate longest streak
  let longestStreak = 0;
  let tempStreak = 0;
  let prevDate: Date | null = null;

  for (const dayKey of sortedDays.reverse()) {
    const [year, month, day] = dayKey.split('-').map(Number);
    const date = new Date(year, month, day);

    if (prevDate === null) {
      tempStreak = 1;
    } else {
      const diffDays = Math.round((prevDate.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
      if (diffDays === 1) {
        tempStreak++;
      } else {
        longestStreak = Math.max(longestStreak, tempStreak);
        tempStreak = 1;
      }
    }
    prevDate = date;
  }
  longestStreak = Math.max(longestStreak, tempStreak);

  return { current: currentStreak, longest: longestStreak, isActive };
}

// Trend comparison
export interface TrendInfo {
  current: number;
  previous: number;
  changePercent: number;
  direction: 'up' | 'down' | 'same';
}

export function getWeekOverWeekTrend(entries: MemoryEntry[]): TrendInfo {
  const ranges = getTimeRanges();

  const thisWeekCount = entries.filter(
    (e) => e.timestamp >= ranges.thisWeek.start.getTime()
  ).length;

  const lastWeekCount = entries.filter(
    (e) => e.timestamp >= ranges.lastWeek.start.getTime() &&
           e.timestamp < ranges.thisWeek.start.getTime()
  ).length;

  const changePercent = lastWeekCount === 0
    ? (thisWeekCount > 0 ? 100 : 0)
    : Math.round(((thisWeekCount - lastWeekCount) / lastWeekCount) * 100);

  return {
    current: thisWeekCount,
    previous: lastWeekCount,
    changePercent: Math.abs(changePercent),
    direction: changePercent > 0 ? 'up' : changePercent < 0 ? 'down' : 'same',
  };
}

// Keyword extraction (simple, no AI)
export function extractKeywords(entries: MemoryEntry[], topN = 10): string[] {
  const stopWords = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been',
    'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'dare', 'ought',
    'used', 'it', 'its', 'this', 'that', 'these', 'those', 'i', 'me', 'my',
    'we', 'our', 'you', 'your', 'he', 'she', 'they', 'them', 'their', 'what',
    'which', 'who', 'whom', 'where', 'when', 'why', 'how', 'all', 'each',
    'some', 'any', 'no', 'not', 'only', 'same', 'so', 'than', 'too', 'very',
    'just', 'also', 'now', 'here', 'there', 'then', 'once', 'about', 'into',
    'over', 'after', 'before', 'between', 'under', 'again', 'further', 'up',
    'down', 'out', 'off', 'through', 'during', 'above', 'below',
  ]);

  const wordCounts = new Map<string, number>();

  for (const entry of entries) {
    const words = entry.text.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !stopWords.has(w));

    for (const word of words) {
      wordCounts.set(word, (wordCounts.get(word) || 0) + 1);
    }
  }

  return Array.from(wordCounts.entries())
    .filter(([_, count]) => count >= 2) // Appears at least twice
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([word]) => word);
}

// Complete insights object
export interface LocalInsights {
  totalEntries: number;
  todayCount: number;
  weekCount: number;
  monthCount: number;
  sites: SiteStats[];
  timeOfDay: TimeOfDayStats[];
  dayOfWeek: DayOfWeekStats[];
  streak: StreakInfo;
  trend: TrendInfo;
  keywords: string[];
}

export function computeLocalInsights(entries: MemoryEntry[]): LocalInsights {
  const ranges = getTimeRanges();

  const todayEntries = entries.filter(
    (e) => e.timestamp >= ranges.today.start.getTime()
  );
  const weekEntries = entries.filter(
    (e) => e.timestamp >= ranges.thisWeek.start.getTime()
  );
  const monthEntries = entries.filter(
    (e) => e.timestamp >= ranges.thisMonth.start.getTime()
  );

  return {
    totalEntries: entries.length,
    todayCount: todayEntries.length,
    weekCount: weekEntries.length,
    monthCount: monthEntries.length,
    sites: getSiteStats(weekEntries),
    timeOfDay: getTimeOfDayStats(weekEntries),
    dayOfWeek: getDayOfWeekStats(monthEntries),
    streak: getStreakInfo(entries),
    trend: getWeekOverWeekTrend(entries),
    keywords: extractKeywords(weekEntries),
  };
}

// Time parsing for queries
export interface ParsedTimeQuery {
  startTime?: number;
  endTime?: number;
  label?: string;
}

export function parseTimeFromQuery(query: string): ParsedTimeQuery | null {
  const now = new Date();
  const lowerQuery = query.toLowerCase();

  // Today
  if (/\btoday\b/.test(lowerQuery)) {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return { startTime: start.getTime(), endTime: now.getTime(), label: 'today' };
  }

  // Yesterday
  if (/\byesterday\b/.test(lowerQuery)) {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return { startTime: start.getTime(), endTime: end.getTime(), label: 'yesterday' };
  }

  // This week
  if (/\bthis week\b/.test(lowerQuery)) {
    const start = new Date(now);
    start.setDate(now.getDate() - now.getDay());
    start.setHours(0, 0, 0, 0);
    return { startTime: start.getTime(), endTime: now.getTime(), label: 'this week' };
  }

  // Last week
  if (/\blast week\b/.test(lowerQuery)) {
    const end = new Date(now);
    end.setDate(now.getDate() - now.getDay());
    end.setHours(0, 0, 0, 0);
    const start = new Date(end);
    start.setDate(start.getDate() - 7);
    return { startTime: start.getTime(), endTime: end.getTime(), label: 'last week' };
  }

  // This month
  if (/\bthis month\b/.test(lowerQuery)) {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    return { startTime: start.getTime(), endTime: now.getTime(), label: 'this month' };
  }

  // Last month
  if (/\blast month\b/.test(lowerQuery)) {
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const end = new Date(now.getFullYear(), now.getMonth(), 1);
    return { startTime: start.getTime(), endTime: end.getTime(), label: 'last month' };
  }

  // This quarter / this Q
  if (/\b(this quarter|this q|q[1-4]\b)/i.test(lowerQuery)) {
    const quarterMatch = lowerQuery.match(/\bq([1-4])\b/);
    let quarterNum: number;

    if (quarterMatch) {
      quarterNum = parseInt(quarterMatch[1]) - 1;
    } else {
      quarterNum = Math.floor(now.getMonth() / 3);
    }

    const start = new Date(now.getFullYear(), quarterNum * 3, 1);
    const end = new Date(now.getFullYear(), (quarterNum + 1) * 3, 1);
    return {
      startTime: start.getTime(),
      endTime: Math.min(end.getTime(), now.getTime()),
      label: `Q${quarterNum + 1}`
    };
  }

  // Last quarter
  if (/\blast quarter\b/.test(lowerQuery)) {
    const currentQuarter = Math.floor(now.getMonth() / 3);
    const lastQuarter = currentQuarter === 0 ? 3 : currentQuarter - 1;
    const year = currentQuarter === 0 ? now.getFullYear() - 1 : now.getFullYear();

    const start = new Date(year, lastQuarter * 3, 1);
    const end = new Date(year, (lastQuarter + 1) * 3, 1);
    return { startTime: start.getTime(), endTime: end.getTime(), label: 'last quarter' };
  }

  // Month names (January, Feb, etc.)
  const monthNames = [
    'january', 'february', 'march', 'april', 'may', 'june',
    'july', 'august', 'september', 'october', 'november', 'december',
    'jan', 'feb', 'mar', 'apr', 'may', 'jun',
    'jul', 'aug', 'sep', 'oct', 'nov', 'dec'
  ];

  for (let i = 0; i < monthNames.length; i++) {
    const regex = new RegExp(`\\b${monthNames[i]}\\b`, 'i');
    if (regex.test(lowerQuery)) {
      const monthIndex = i % 12;
      // Assume current year, or last year if month is in future
      let year = now.getFullYear();
      if (monthIndex > now.getMonth()) {
        year--;
      }
      const start = new Date(year, monthIndex, 1);
      const end = new Date(year, monthIndex + 1, 1);
      return {
        startTime: start.getTime(),
        endTime: Math.min(end.getTime(), now.getTime()),
        label: monthNames[i]
      };
    }
  }

  // "last N days/weeks"
  const lastNMatch = lowerQuery.match(/last (\d+) (day|week|month)s?/);
  if (lastNMatch) {
    const n = parseInt(lastNMatch[1]);
    const unit = lastNMatch[2];
    const start = new Date(now);

    if (unit === 'day') {
      start.setDate(start.getDate() - n);
    } else if (unit === 'week') {
      start.setDate(start.getDate() - n * 7);
    } else if (unit === 'month') {
      start.setMonth(start.getMonth() - n);
    }

    return { startTime: start.getTime(), endTime: now.getTime(), label: `last ${n} ${unit}s` };
  }

  return null;
}

// Parse site from query
export function parseSiteFromQuery(query: string): string | null {
  const lowerQuery = query.toLowerCase();

  // "on github" / "in github" / "from github"
  const siteMatch = lowerQuery.match(/(?:on|in|from|at)\s+(\w+(?:\.\w+)?)/);
  if (siteMatch) {
    const site = siteMatch[1];
    // Add .com if no TLD
    if (!site.includes('.')) {
      return `${site}.com`;
    }
    return site;
  }

  return null;
}
