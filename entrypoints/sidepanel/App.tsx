import { createSignal, For, Show, onMount, createMemo } from 'solid-js';
import { db, type MemoryEntry, deleteEntry } from '../../lib/db';
import { liveQuery } from 'dexie';
import { semanticSearch, processUnembeddedEntries, preloadModel } from '../../lib/embeddings';
import {
  getAIConfig,
  saveAIConfig,
  clearAIConfig,
  testAPIKey,
  buildReviewPrompt,
  streamAI,
  type AIProvider,
} from '../../lib/ai';
import {
  getGitHubPAT,
  saveGitHubPAT,
  clearGitHubPAT,
  validateGitHubPAT,
  getGitHubSyncStatus,
  getPRsForTimeRange,
  type SyncStatus,
} from '../../lib/github';
import { exportPRsToCSV, downloadCSV, generateExportFilename } from '../../lib/export';
import {
  computeLocalInsights,
  parseTimeFromQuery,
  extractKeywords,
} from '../../lib/insights';
import { autoSeedIfDev, forceReseed, clearDatabase } from '../../lib/seed';
import { marked } from 'marked';

// Configure marked for safe rendering
marked.setOptions({
  breaks: true,
  gfm: true,
});

type ViewType = 'insights' | 'history' | 'search' | 'review' | 'settings';
type TabType = 'today' | 'week' | 'all';
type TimeRange = 'week' | 'month' | 'quarter' | 'year' | 'all';

// Chat message type
interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  entriesUsed?: number;
  prsUsed?: number;
}

export default function App() {
  // View state - start with insights
  const [view, setView] = createSignal<ViewType>('insights');

  // History state
  const [activeTab, setActiveTab] = createSignal<TabType>('today');
  const [entries, setEntries] = createSignal<MemoryEntry[]>([]);
  const [groupedEntries, setGroupedEntries] = createSignal<Map<string, MemoryEntry[]>>(new Map());

  // Search state
  const [searchQuery, setSearchQuery] = createSignal('');
  const [searchResults, setSearchResults] = createSignal<Array<{ entry: MemoryEntry; score: number }>>([]);
  const [isSearching, setIsSearching] = createSignal(false);
  const [modelStatus, setModelStatus] = createSignal<'loading' | 'ready' | 'idle'>('idle');
  const [searchTimeFilter, setSearchTimeFilter] = createSignal<string | null>(null);

  // Chat/Review state
  const [chatMessages, setChatMessages] = createSignal<ChatMessage[]>([]);
  const [chatInput, setChatInput] = createSignal('');
  const [chatTimeRange, setChatTimeRange] = createSignal<TimeRange>('all');
  const [isStreaming, setIsStreaming] = createSignal(false);

  // Settings state
  const [aiProvider, setAIProvider] = createSignal<AIProvider>('openai');
  const [apiKey, setApiKey] = createSignal('');
  const [baseURL, setBaseURL] = createSignal('');
  const [modelName, setModelName] = createSignal('');
  const [isConfigured, setIsConfigured] = createSignal(false);
  const [isTesting, setIsTesting] = createSignal(false);
  const [testResult, setTestResult] = createSignal<'success' | 'error' | null>(null);

  // GitHub state
  const [githubPAT, setGithubPAT] = createSignal('');
  const [isGitHubConfigured, setIsGitHubConfigured] = createSignal(false);
  const [githubUsername, setGithubUsername] = createSignal('');
  const [syncStatus, setSyncStatus] = createSignal<SyncStatus | null>(null);
  const [isSyncing, setIsSyncing] = createSignal(false);
  const [isTestingGitHub, setIsTestingGitHub] = createSignal(false);
  const [gitHubTestResult, setGitHubTestResult] = createSignal<'success' | 'error' | null>(null);
  const [gitHubTestError, setGitHubTestError] = createSignal<string | null>(null);

  // Review view GitHub toggle
  const [includeGitHubPRs, setIncludeGitHubPRs] = createSignal(false);

  // Computed insights
  const insights = createMemo(() => computeLocalInsights(entries()));

  // Dynamic search suggestions based on entries
  const searchSuggestions = createMemo(() => {
    const keywords = extractKeywords(entries(), 6);
    return keywords.length > 0 ? keywords : ['bug', 'shipped', 'review', 'meeting'];
  });

  // Load settings and start embedding on mount
  onMount(async () => {
    // Expose debug helpers in dev
    if (import.meta.env.DEV) {
      (window as any).wkDebug = {
        forceReseed,
        clearDatabase,
        getEntries: () => db.entries.toArray(),
        getCount: () => db.entries.count(),
      };
      console.log('WorthKeeping: Debug helpers available at window.wkDebug');
    }

    // Seed dev data if needed
    await autoSeedIfDev();

    // Subscribe to entries
    const subscription = liveQuery(() => db.entries.orderBy('timestamp').reverse().toArray()).subscribe({
      next: (result) => {
        setEntries(result);
        updateGroupedEntries(result);
      },
      error: (err) => console.error('Dexie subscription error:', err),
    });

    // Load AI config
    const config = await getAIConfig();
    if (config) {
      setAIProvider(config.provider);
      setApiKey(config.apiKey);
      if (config.baseURL) setBaseURL(config.baseURL);
      if (config.model) setModelName(config.model);
      setIsConfigured(true);
    }

    // Start loading embeddings model in background
    setModelStatus('loading');
    preloadModel().then(() => {
      setModelStatus('ready');
      processUnembeddedEntries();
    });

    // Load GitHub config and trigger auto-sync
    const pat = await getGitHubPAT();
    if (pat) {
      setIsGitHubConfigured(true);
      setGithubPAT(pat);

      // Get sync status
      const status = await getGitHubSyncStatus();
      setSyncStatus(status);

      // Auto-sync in background (non-blocking)
      triggerGitHubSync();
    }

    return () => subscription.unsubscribe();
  });

  // History helpers
  const updateGroupedEntries = (allEntries: MemoryEntry[]) => {
    const grouped = new Map<string, MemoryEntry[]>();
    for (const entry of allEntries) {
      const dateKey = formatDateKey(new Date(entry.timestamp));
      if (!grouped.has(dateKey)) grouped.set(dateKey, []);
      grouped.get(dateKey)!.push(entry);
    }
    setGroupedEntries(grouped);
  };

  const formatDateKey = (date: Date): string => {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (isSameDay(date, today)) return 'Today';
    if (isSameDay(date, yesterday)) return 'Yesterday';
    return date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  };

  const isSameDay = (d1: Date, d2: Date): boolean =>
    d1.getFullYear() === d2.getFullYear() && d1.getMonth() === d2.getMonth() && d1.getDate() === d2.getDate();

  const getFilteredEntries = (): Map<string, MemoryEntry[]> => {
    const all = groupedEntries();
    const tab = activeTab();
    if (tab === 'all') return all;

    const now = new Date();
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay());
    startOfWeek.setHours(0, 0, 0, 0);
    const cutoff = tab === 'today' ? startOfToday.getTime() : startOfWeek.getTime();

    const filtered = new Map<string, MemoryEntry[]>();
    for (const [key, dayEntries] of all) {
      const filteredDayEntries = dayEntries.filter((e) => e.timestamp >= cutoff);
      if (filteredDayEntries.length > 0) filtered.set(key, filteredDayEntries);
    }
    return filtered;
  };

  const formatTime = (timestamp: number): string =>
    new Date(timestamp).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

  const handleDelete = async (id: string) => await deleteEntry(id);

  // Search handlers with time parsing
  const handleSearch = async () => {
    const query = searchQuery().trim();
    if (!query) return;

    setIsSearching(true);
    setSearchTimeFilter(null);

    try {
      // Parse time from query
      const timeQuery = parseTimeFromQuery(query);

      let searchOptions: { limit?: number; minScore?: number; startTime?: number; endTime?: number } = {
        limit: 20,
        minScore: 0.2,
      };

      if (timeQuery) {
        searchOptions.startTime = timeQuery.startTime;
        searchOptions.endTime = timeQuery.endTime;
        setSearchTimeFilter(timeQuery.label || null);
      }

      // Try semantic search
      let results = await semanticSearch(query, searchOptions);

      // Fallback: if no results, do simple text search
      if (results.length === 0) {
        const lowerQuery = query.toLowerCase();
        let allEntries = entries();

        // Filter by time if specified
        if (timeQuery?.startTime) {
          allEntries = allEntries.filter(
            (e) => e.timestamp >= timeQuery.startTime! && (!timeQuery.endTime || e.timestamp <= timeQuery.endTime)
          );
        }

        // Simple text match
        const textMatches = allEntries
          .filter((e) => e.text.toLowerCase().includes(lowerQuery))
          .slice(0, 20)
          .map((entry) => ({ entry, score: 0.5 }));

        results = textMatches;
      }

      setSearchResults(results);
    } catch (err) {
      console.error('Search error:', err);
    }
    setIsSearching(false);
  };

  // Chat handlers
  const handleSendChat = async (question: string) => {
    if (!question.trim() || isStreaming()) return;

    if (!isConfigured()) {
      setView('settings');
      return;
    }

    // Add user message
    setChatMessages((prev) => [...prev, { role: 'user', content: question }]);
    setChatInput('');
    setIsStreaming(true);

    try {
      // Build prompt with relevant entries and optionally GitHub PRs
      const { prompt, entriesUsed, prsUsed } = await buildReviewPrompt(
        question,
        chatTimeRange(),
        includeGitHubPRs()
      );

      if (entriesUsed === 0 && prsUsed === 0) {
        setChatMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: includeGitHubPRs()
              ? 'No entries or PRs found for this time period. Try capturing memories with Cmd+Shift+L or sync your GitHub PRs in Settings.'
              : 'No relevant entries found for this time period. Try capturing more memories with Cmd+Shift+L.',
            entriesUsed: 0,
            prsUsed: 0,
          },
        ]);
        setIsStreaming(false);
        return;
      }

      // Add empty assistant message that we'll stream into
      setChatMessages((prev) => [...prev, { role: 'assistant', content: '', entriesUsed, prsUsed }]);

      // Stream the response
      let fullContent = '';
      for await (const chunk of streamAI(prompt)) {
        fullContent += chunk;
        setChatMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = { role: 'assistant', content: fullContent, entriesUsed, prsUsed };
          return updated;
        });
      }
    } catch (err: any) {
      setChatMessages((prev) => [
        ...prev.slice(0, -1), // Remove empty streaming message if exists
        { role: 'assistant', content: `Error: ${err.message}` },
      ]);
    }

    setIsStreaming(false);
  };

  // Quick prompt chips
  const quickPrompts = [
    { label: 'Accomplishments', question: 'What were my key accomplishments?' },
    { label: 'Challenges', question: 'What challenges did I overcome?' },
    { label: 'Learnings', question: 'What did I learn?' },
    { label: 'Impact', question: 'What impact did my work have?' },
    { label: 'Summary', question: 'Give me a summary of my work' },
  ];

  // Settings handlers
  const handleSaveSettings = async () => {
    setIsTesting(true);
    setTestResult(null);

    const provider = aiProvider();
    const isOpenAICompatible = provider === 'openai-compatible';
    const url = isOpenAICompatible ? baseURL() : undefined;
    const model = modelName() || undefined;

    const success = await testAPIKey(provider, apiKey(), url, model);

    if (success) {
      await saveAIConfig({
        provider,
        apiKey: apiKey(),
        baseURL: url,
        model,
      });
      setIsConfigured(true);
      setTestResult('success');
    } else {
      setTestResult('error');
    }

    setIsTesting(false);
  };

  const handleClearSettings = async () => {
    await clearAIConfig();
    setApiKey('');
    setBaseURL('');
    setModelName('');
    setIsConfigured(false);
    setTestResult(null);
  };

  // GitHub handlers
  const handleSaveGitHubPAT = async () => {
    setIsTestingGitHub(true);
    setGitHubTestResult(null);
    setGitHubTestError(null);

    const result = await validateGitHubPAT(githubPAT());

    if (result.valid) {
      await saveGitHubPAT(githubPAT());
      setIsGitHubConfigured(true);
      setGithubUsername(result.username || '');
      setGitHubTestResult('success');

      // Trigger initial sync
      triggerGitHubSync();
    } else {
      setGitHubTestResult('error');
      setGitHubTestError(result.error || 'Invalid token');
    }

    setIsTestingGitHub(false);
  };

  const handleClearGitHubPAT = async () => {
    await clearGitHubPAT();
    setGithubPAT('');
    setIsGitHubConfigured(false);
    setGithubUsername('');
    setSyncStatus(null);
    setGitHubTestResult(null);
    setGitHubTestError(null);
    setIncludeGitHubPRs(false);
  };

  const triggerGitHubSync = async () => {
    if (isSyncing()) return;

    setIsSyncing(true);

    try {
      const response = await browser.runtime.sendMessage({ type: 'SYNC_GITHUB_PRS' });

      if (response.success) {
        // Refresh sync status
        const status = await getGitHubSyncStatus();
        setSyncStatus(status);
      } else if (response.error) {
        console.error('GitHub sync error:', response.error);
      }
    } catch (err) {
      console.error('Failed to sync GitHub PRs:', err);
    }

    setIsSyncing(false);
  };

  const formatLastSync = (timestamp: number | null): string => {
    if (!timestamp) return 'Never';
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - timestamp;
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;

    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;

    return date.toLocaleDateString();
  };

  // Export PRs to CSV
  const handleExportPRs = async () => {
    try {
      const prs = await getPRsForTimeRange(chatTimeRange());
      if (prs.length === 0) {
        alert('No PRs to export for the selected time range.');
        return;
      }
      const csv = exportPRsToCSV(prs);
      const filename = generateExportFilename(`github-prs-${chatTimeRange()}`);
      downloadCSV(csv, filename);
    } catch (err) {
      console.error('Failed to export PRs:', err);
      alert('Failed to export PRs. Please try again.');
    }
  };

  const filteredGroups = () => Array.from(getFilteredEntries().entries());
  const isEmpty = () => filteredGroups().length === 0;

  // Entry card component
  const EntryCard = (props: { entry: MemoryEntry; showScore?: number }) => {
    return (
      <div class="entry">
        <div class="entry-text">{props.entry.text}</div>
        <div class="entry-meta">
          <span class="entry-time">{formatTime(props.entry.timestamp)}</span>
          <Show when={props.showScore !== undefined}>
            <span class="entry-dot" />
            <span class="score">{Math.round(props.showScore! * 100)}% match</span>
          </Show>
        </div>
        <div class="entry-actions">
          <button class="delete-btn" onClick={() => handleDelete(props.entry.id)} title="Delete">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
            </svg>
          </button>
        </div>
      </div>
    );
  };

  return (
    <div class="container">
      <header class="header">
        <div class="header-top">
          <h1>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
            </svg>
            WorthKeeping
          </h1>
          <button
            class="settings-btn"
            onClick={() => setView(view() === 'settings' ? 'insights' : 'settings')}
            title="Settings"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </button>
        </div>

        <Show when={view() !== 'settings'}>
          <div class="view-tabs">
            <button class={`view-tab ${view() === 'insights' ? 'active' : ''}`} onClick={() => setView('insights')}>
              Insights
            </button>
            <button class={`view-tab ${view() === 'history' ? 'active' : ''}`} onClick={() => setView('history')}>
              History
            </button>
            <button class={`view-tab ${view() === 'search' ? 'active' : ''}`} onClick={() => setView('search')}>
              Search
            </button>
            <button class={`view-tab ${view() === 'review' ? 'active' : ''}`} onClick={() => setView('review')}>
              Chat
            </button>
          </div>
        </Show>
      </header>

      <Show when={view() === 'insights'}>
        <Show
          when={entries().length > 0}
          fallback={
            <div class="empty-state">
              <div class="empty-state-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
                </svg>
              </div>
              <h3>No memories yet</h3>
              <p>
                Press <kbd>Cmd</kbd> + <kbd>Shift</kbd> + <kbd>L</kbd> to capture what you just did
              </p>
            </div>
          }
        >
          <Show when={insights().todayCount === 0}>
            <div class="insight-card capture-prompt-card">
              <p class="capture-prompt-text">What did you accomplish today?</p>
              <div class="capture-prompt-hint">
                Or press <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>L</kbd> anywhere
              </div>
            </div>
          </Show>

          <div class="insight-card review-ready-card">
            <div class="review-ready-header">
              <span class="review-ready-count">{entries().length}</span>
              <span class="review-ready-label">memories captured</span>
            </div>
            <Show when={insights().keywords.length > 0}>
              <p class="review-ready-themes">
                Themes: {insights().keywords.slice(0, 5).join(', ')}
              </p>
            </Show>
            <button class="review-ready-cta" onClick={() => setView('review')}>
              Generate review summary
            </button>
          </div>

          <div class="quick-actions">
            <button class="quick-action" onClick={() => setView('review')}>
              <span class="quick-action-icon">💬</span>
              <span class="quick-action-label">Ask AI</span>
            </button>
            <button class="quick-action" onClick={() => setView('search')}>
              <span class="quick-action-icon">🔍</span>
              <span class="quick-action-label">Search</span>
            </button>
            <button class="quick-action" onClick={() => setView('history')}>
              <span class="quick-action-icon">📋</span>
              <span class="quick-action-label">History</span>
            </button>
          </div>

          <div class="insight-card">
            <div class="insight-header">
              <h3 class="insight-title">This week</h3>
              <span class="insight-count">{insights().weekCount} entries</span>
            </div>
            <Show
              when={insights().weekCount > 0}
              fallback={<p class="insight-empty">No entries this week yet</p>}
            >
              <div class="entries">
                <For each={entries().filter(e => {
                  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
                  return e.timestamp > weekAgo;
                }).slice(0, 3)}>
                  {(entry) => <EntryCard entry={entry} />}
                </For>
              </div>
            </Show>
          </div>
        </Show>
      </Show>

      <Show when={view() === 'history'}>
        <Show when={entries().length > 0}>
          <div class="stats">
            <div class="stat">
              <div class="stat-value">{insights().todayCount}</div>
              <div class="stat-label">Today</div>
            </div>
            <div class="stat">
              <div class="stat-value">{insights().weekCount}</div>
              <div class="stat-label">This Week</div>
            </div>
            <div class="stat">
              <div class="stat-value">{entries().length}</div>
              <div class="stat-label">Total</div>
            </div>
          </div>
        </Show>

        <div class="tabs">
          <button class={`tab ${activeTab() === 'today' ? 'active' : ''}`} onClick={() => setActiveTab('today')}>
            Today
          </button>
          <button class={`tab ${activeTab() === 'week' ? 'active' : ''}`} onClick={() => setActiveTab('week')}>
            This Week
          </button>
          <button class={`tab ${activeTab() === 'all' ? 'active' : ''}`} onClick={() => setActiveTab('all')}>
            All
          </button>
        </div>

        <Show
          when={!isEmpty()}
          fallback={
            <div class="empty-state">
              <div class="empty-state-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
                </svg>
              </div>
              <h3>No memories yet</h3>
              <p>
                Press <kbd>Cmd</kbd> + <kbd>Shift</kbd> + <kbd>L</kbd> to capture what you just did
              </p>
            </div>
          }
        >
          <For each={filteredGroups()}>
            {([dateKey, dayEntries]) => (
              <div class="day-group">
                <div class={`day-header ${dateKey === 'Today' ? 'today' : ''}`}>{dateKey}</div>
                <div class="entries">
                  <For each={dayEntries}>{(entry) => <EntryCard entry={entry} />}</For>
                </div>
              </div>
            )}
          </For>
        </Show>
      </Show>

      <Show when={view() === 'search'}>
        <div class="search-section">
          <div class="search-box">
            <input
              type="text"
              class="search-input"
              placeholder='Search your memories...'
              value={searchQuery()}
              onInput={(e) => setSearchQuery(e.currentTarget.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            />
            <button
              class="search-btn"
              onClick={handleSearch}
              disabled={isSearching() || modelStatus() === 'loading'}
            >
              {isSearching() ? '...' : 'Go'}
            </button>
          </div>

          <Show when={modelStatus() === 'loading'}>
            <p class="model-status">Loading AI model for semantic search...</p>
          </Show>

          <div class="search-hints">
            <For each={searchSuggestions()}>
              {(keyword) => (
                <span
                  class="search-hint"
                  onClick={() => {
                    setSearchQuery(keyword);
                    handleSearch();
                  }}
                >
                  {keyword}
                </span>
              )}
            </For>
          </div>

          <Show when={searchTimeFilter()}>
            <div class="search-filter-badge">
              Filtering: {searchTimeFilter()}
              <button onClick={() => setSearchTimeFilter(null)}>×</button>
            </div>
          </Show>

          <Show when={searchResults().length > 0}>
            <div class="search-results">
              <p class="results-count">{searchResults().length} results</p>
              <div class="entries">
                <For each={searchResults()}>
                  {(result) => <EntryCard entry={result.entry} showScore={result.score} />}
                </For>
              </div>
            </div>
          </Show>

          <Show when={searchResults().length === 0 && searchQuery() && !isSearching()}>
            <div class="empty-state">
              <p>No results found. Try different keywords or time filters.</p>
            </div>
          </Show>
        </div>
      </Show>

      <Show when={view() === 'review'}>
        <div class="chat-section">
          <Show when={!isConfigured()}>
            <div class="warning-box">
              <p>Add your API key in Settings to chat with your memories</p>
              <button class="link-btn" onClick={() => setView('settings')}>
                Go to Settings
              </button>
            </div>
          </Show>

          <div class="chat-time-selector">
            <span class="chat-time-label">Looking at:</span>
            <select
              value={chatTimeRange()}
              onChange={(e) => setChatTimeRange(e.currentTarget.value as TimeRange)}
              class="chat-time-select"
            >
              <option value="week">This Week</option>
              <option value="month">This Month</option>
              <option value="quarter">This Quarter</option>
              <option value="year">This Year</option>
              <option value="all">All Time</option>
            </select>
          </div>

          <Show when={isGitHubConfigured()}>
            <div class="github-toggle">
              <label class="toggle-label">
                <input
                  type="checkbox"
                  checked={includeGitHubPRs()}
                  onChange={(e) => setIncludeGitHubPRs(e.currentTarget.checked)}
                />
                <span class="toggle-text">Include GitHub PRs</span>
                <Show when={includeGitHubPRs() && syncStatus()?.prCount}>
                  <span class="toggle-badge">{syncStatus()?.prCount} PRs</span>
                </Show>
              </label>
            </div>
          </Show>

          <div class="chat-messages">
            <Show when={chatMessages().length === 0}>
              <div class="chat-empty">
                <p>Ask questions about your work</p>
              </div>
            </Show>

            <For each={chatMessages()}>
              {(msg) => (
                <div class={`chat-message ${msg.role}`}>
                  <Show when={msg.role === 'assistant'}>
                    <div
                      class="chat-content markdown"
                      innerHTML={marked.parse(msg.content) as string}
                    />
                    <Show when={(msg.entriesUsed && msg.entriesUsed > 0) || (msg.prsUsed && msg.prsUsed > 0)}>
                      <div class="chat-meta">
                        Based on{' '}
                        {msg.entriesUsed ? `${msg.entriesUsed} entries` : ''}
                        {msg.entriesUsed && msg.prsUsed ? ' + ' : ''}
                        {msg.prsUsed ? `${msg.prsUsed} PRs` : ''}
                      </div>
                    </Show>
                    <Show when={msg.content}>
                      <button
                        class="copy-btn-small"
                        onClick={() => navigator.clipboard.writeText(msg.content)}
                      >
                        Copy
                      </button>
                    </Show>
                  </Show>
                  <Show when={msg.role === 'user'}>
                    <div class="chat-content">{msg.content}</div>
                  </Show>
                </div>
              )}
            </For>

            <Show when={isStreaming()}>
              <div class="chat-streaming">Thinking...</div>
            </Show>
          </div>

          <Show when={chatMessages().length === 0}>
            <div class="quick-prompts">
              <For each={quickPrompts}>
                {(prompt) => (
                  <button
                    class="quick-prompt-chip"
                    onClick={() => handleSendChat(prompt.question)}
                    disabled={isStreaming() || !isConfigured()}
                  >
                    {prompt.label}
                  </button>
                )}
              </For>
            </div>
          </Show>

          <div class="chat-input-container">
            <input
              type="text"
              class="chat-input"
              placeholder="Ask about your work..."
              value={chatInput()}
              onInput={(e) => setChatInput(e.currentTarget.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSendChat(chatInput())}
              disabled={isStreaming() || !isConfigured()}
            />
            <button
              class="chat-send-btn"
              onClick={() => handleSendChat(chatInput())}
              disabled={isStreaming() || !chatInput().trim() || !isConfigured()}
            >
              Send
            </button>
          </div>

          <div class="chat-footer-actions">
            <Show when={chatMessages().length > 0}>
              <button class="clear-chat-btn" onClick={() => setChatMessages([])}>
                Clear chat
              </button>
            </Show>
            <Show when={isGitHubConfigured() && includeGitHubPRs()}>
              <button class="export-btn" onClick={handleExportPRs}>
                Export PRs (CSV)
              </button>
            </Show>
          </div>
        </div>
      </Show>

      <Show when={view() === 'settings'}>
        <div class="settings-section">
          <h2>Settings</h2>

          <div class="settings-card">
            <h3>AI Provider</h3>
            <p class="settings-desc">Add your API key to enable AI-powered summaries</p>

            <div class="form-group">
              <label>Provider</label>
              <select
                value={aiProvider()}
                onChange={(e) => setAIProvider(e.currentTarget.value as AIProvider)}
              >
                <option value="openai">OpenAI</option>
                <option value="anthropic">Anthropic</option>
                <option value="google">Google Gemini</option>
                <option value="openai-compatible">OpenAI Compatible (LiteLLM, Ollama)</option>
              </select>
            </div>

            <Show when={aiProvider() === 'openai-compatible'}>
              <div class="form-group">
                <label>Base URL</label>
                <input
                  type="text"
                  value={baseURL()}
                  onInput={(e) => setBaseURL(e.currentTarget.value)}
                  placeholder="http://localhost:4000/v1"
                />
              </div>

              <div class="form-group">
                <label>Model Name</label>
                <input
                  type="text"
                  value={modelName()}
                  onInput={(e) => setModelName(e.currentTarget.value)}
                  placeholder="gpt-4o-mini"
                />
              </div>
            </Show>

            <div class="form-group">
              <label>API Key</label>
              <input
                type="password"
                value={apiKey()}
                onInput={(e) => setApiKey(e.currentTarget.value)}
                placeholder={aiProvider() === 'openai-compatible' ? 'Your LiteLLM/proxy API key' : `Enter your ${aiProvider() === 'google' ? 'Google AI' : aiProvider()} API key`}
              />
            </div>

            <Show when={testResult() === 'success'}>
              <p class="success-msg">API key verified successfully</p>
            </Show>

            <Show when={testResult() === 'error'}>
              <p class="error-msg">Invalid API key. Please check and try again.</p>
            </Show>

            <div class="settings-actions">
              <button
                class="primary-btn"
                onClick={handleSaveSettings}
                disabled={isTesting() || !apiKey() || (aiProvider() === 'openai-compatible' && !baseURL())}
              >
                {isTesting() ? 'Testing...' : 'Save & Test'}
              </button>

              <Show when={isConfigured()}>
                <button class="danger-btn" onClick={handleClearSettings}>
                  Remove Key
                </button>
              </Show>
            </div>
          </div>

          <div class="settings-card">
            <h3>Embedding Status</h3>
            <p class="settings-desc">Local AI model for semantic search</p>
            <p class="model-status-text">
              Status:{' '}
              {modelStatus() === 'loading'
                ? 'Loading...'
                : modelStatus() === 'ready'
                  ? 'Ready'
                  : 'Not loaded'}
            </p>
            <p class="settings-desc">
              {entries().filter((e) => e.embedding).length} / {entries().length} entries embedded
            </p>
          </div>

          <div class="settings-card">
            <h3>GitHub Integration</h3>
            <p class="settings-desc">Import your PRs to include in performance reviews</p>

            <Show when={!isGitHubConfigured()}>
              <div class="form-group">
                <label>Personal Access Token</label>
                <input
                  type="password"
                  value={githubPAT()}
                  onInput={(e) => setGithubPAT(e.currentTarget.value)}
                  placeholder="ghp_xxxxxxxxxxxx"
                />
                <p class="settings-hint">
                  Create a token at GitHub Settings &gt; Developer settings &gt; Personal access tokens.
                  Needs <code>repo</code> scope for private repos.
                </p>
              </div>

              <Show when={gitHubTestResult() === 'error'}>
                <p class="error-msg">{gitHubTestError() || 'Invalid token'}</p>
              </Show>

              <div class="settings-actions">
                <button
                  class="primary-btn"
                  onClick={handleSaveGitHubPAT}
                  disabled={isTestingGitHub() || !githubPAT()}
                >
                  {isTestingGitHub() ? 'Testing...' : 'Save & Test'}
                </button>
              </div>
            </Show>

            <Show when={isGitHubConfigured()}>
              <div class="github-status">
                <div class="github-status-row">
                  <span class="github-status-label">Status:</span>
                  <span class="github-status-value success">Connected</span>
                </div>
                <Show when={githubUsername()}>
                  <div class="github-status-row">
                    <span class="github-status-label">User:</span>
                    <span class="github-status-value">@{githubUsername()}</span>
                  </div>
                </Show>
                <div class="github-status-row">
                  <span class="github-status-label">PRs synced:</span>
                  <span class="github-status-value">{syncStatus()?.prCount || 0}</span>
                </div>
                <div class="github-status-row">
                  <span class="github-status-label">Last sync:</span>
                  <span class="github-status-value">{formatLastSync(syncStatus()?.lastSync || null)}</span>
                </div>
              </div>

              <div class="settings-actions">
                <button
                  class="secondary-btn"
                  onClick={triggerGitHubSync}
                  disabled={isSyncing()}
                >
                  {isSyncing() ? 'Syncing...' : 'Sync Now'}
                </button>
                <button class="danger-btn" onClick={handleClearGitHubPAT}>
                  Disconnect
                </button>
              </div>
            </Show>
          </div>

          <button class="back-btn" onClick={() => setView('insights')}>
            Back to Insights
          </button>
        </div>
      </Show>
    </div>
  );
}
