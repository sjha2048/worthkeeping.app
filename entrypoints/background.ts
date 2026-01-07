import {
  canShowNudge,
  recordNudgeShown,
  recordNudgeAccepted,
  recordNudgeDismissed,
  recordTabClosed,
  resetTabCloseCounter,
  startSession,
  isLongSession,
  getRandomNudgeMessage,
} from '../lib/nudge';
import { saveEntry } from '../lib/db';
import { syncGitHubPRs, getGitHubSyncStatus, type SyncStatus } from '../lib/github';

export default defineBackground(() => {
  console.log('WorthKeeping: Background script starting...');

  // Initialize session tracking
  startSession();

  // Track when browser window gains focus (user returns after being away)
  let lastActiveTime = Date.now();
  let windowFocusCheckInterval: ReturnType<typeof setInterval> | null = null;

  // Helper to send message to active tab
  async function sendToActiveTab(message: Record<string, unknown>): Promise<boolean> {
    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });

      if (!tab?.id) return false;

      // Can't inject into chrome:// pages
      if (tab.url?.startsWith('chrome://') || tab.url?.startsWith('chrome-extension://')) {
        console.log('WorthKeeping: Cannot inject into chrome:// pages');
        return false;
      }

      try {
        await browser.tabs.sendMessage(tab.id, message);
        return true;
      } catch (err) {
        // Content script not loaded - inject it first
        console.log('WorthKeeping: Content script not found, injecting...');
        try {
          await browser.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['/content-scripts/content.js'],
          });
          // Wait a moment for script to initialize
          await new Promise((resolve) => setTimeout(resolve, 100));
          // Retry sending message
          await browser.tabs.sendMessage(tab.id, message);
          return true;
        } catch (injectErr) {
          console.log('WorthKeeping: Failed to inject content script:', injectErr);
          return false;
        }
      }
    } catch (err) {
      console.log('WorthKeeping: Failed to send message:', err);
      return false;
    }
  }

  // Try to show a nudge
  async function tryShowNudge(reason: string): Promise<void> {
    console.log('WorthKeeping: Checking nudge for reason:', reason);

    if (!(await canShowNudge())) {
      return;
    }

    const message = getRandomNudgeMessage();
    const sent = await sendToActiveTab({ type: 'SHOW_NUDGE', message });

    if (sent) {
      await recordNudgeShown();
      console.log('WorthKeeping: Nudge shown -', reason);
    }
  }

  // Handle keyboard shortcut
  browser.commands.onCommand.addListener(async (command) => {
    console.log('WorthKeeping: Command received:', command);

    if (command === 'capture-memory') {
      await sendToActiveTab({ type: 'TOGGLE_CAPTURE' });
    }
  });

  // Track GitHub sync state
  let isGitHubSyncing = false;

  // Handle messages from content script and sidepanel
  browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'SAVE_ENTRY') {
      // Save entry in background context (has extension IndexedDB access)
      saveEntry(message.text, message.context)
        .then((entry) => {
          console.log('WorthKeeping: Entry saved', entry.id);
          // Track nudge acceptance if this came from a nudge
          if (message.fromNudge) {
            recordNudgeAccepted();
          }
          sendResponse({ success: true, entry });
        })
        .catch((err) => {
          console.error('WorthKeeping: Failed to save entry', err);
          sendResponse({ success: false, error: err.message });
        });
      return true; // Keep channel open for async response
    }

    if (message.type === 'NUDGE_DISMISSED') {
      recordNudgeDismissed();
      sendResponse({ success: true });
      return true;
    }

    // GitHub sync handlers
    if (message.type === 'SYNC_GITHUB_PRS') {
      if (isGitHubSyncing) {
        sendResponse({ success: false, error: 'Sync already in progress' });
        return true;
      }

      isGitHubSyncing = true;
      console.log('WorthKeeping: Starting GitHub PR sync...');

      syncGitHubPRs((progress) => {
        console.log('WorthKeeping: GitHub sync -', progress);
      })
        .then((result) => {
          isGitHubSyncing = false;
          console.log('WorthKeeping: GitHub sync complete', result);
          sendResponse(result);
        })
        .catch((err) => {
          isGitHubSyncing = false;
          console.error('WorthKeeping: GitHub sync failed', err);
          sendResponse({ success: false, newPRs: 0, error: err.message });
        });

      return true; // Keep channel open for async response
    }

    if (message.type === 'GET_GITHUB_SYNC_STATUS') {
      getGitHubSyncStatus()
        .then((status) => {
          sendResponse({ ...status, isSyncing: isGitHubSyncing });
        })
        .catch((err) => {
          sendResponse({ lastSync: null, prCount: 0, isSyncing: false, error: err.message });
        });

      return true;
    }
  });

  // Track tab removals - many tabs closed = session ending
  browser.tabs.onRemoved.addListener(async () => {
    const thresholdReached = await recordTabClosed();
    if (thresholdReached) {
      await tryShowNudge('multiple tabs closed');
      await resetTabCloseCounter();
    }
  });

  // Track window focus changes - returning after inactivity
  browser.windows.onFocusChanged.addListener(async (windowId) => {
    if (windowId === browser.windows.WINDOW_ID_NONE) {
      // Browser lost focus
      lastActiveTime = Date.now();
    } else {
      // Browser gained focus - check if user was away
      const awayMinutes = (Date.now() - lastActiveTime) / 1000 / 60;
      if (awayMinutes >= 5) {
        // User was away for 5+ minutes
        await tryShowNudge(`returned after ${Math.round(awayMinutes)} minutes`);
      }
      lastActiveTime = Date.now();
    }
  });

  // Check for long sessions periodically
  windowFocusCheckInterval = setInterval(async () => {
    if (await isLongSession()) {
      await tryShowNudge('long session');
      // Reset session timer after nudge
      await startSession();
    }
  }, 5 * 60 * 1000); // Check every 5 minutes

  // Handle extension icon click - open side panel
  browser.action.onClicked.addListener(async (tab) => {
    console.log('WorthKeeping: Icon clicked');
    if (tab.windowId) {
      await browser.sidePanel.open({ windowId: tab.windowId });
    }
  });

  // Set side panel behavior
  browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {
    // Fallback for older Chrome versions
  });

  console.log('WorthKeeping: Background script ready');
});
