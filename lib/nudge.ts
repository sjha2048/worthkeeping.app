// Nudge state management - context-aware, non-annoying reminders

interface NudgeState {
  // Tracking
  nudgesToday: number;
  lastNudgeTime: number;
  consecutiveDismissals: number;
  nudgesAccepted: number; // times user logged via nudge
  nudgesDismissed: number; // total dismissals

  // Pause state
  pausedUntil: number; // timestamp when nudges resume

  // Session tracking
  sessionStartTime: number;
  tabsClosedInWindow: number;
  lastTabCloseTime: number;
}

const DEFAULT_STATE: NudgeState = {
  nudgesToday: 0,
  lastNudgeTime: 0,
  consecutiveDismissals: 0,
  nudgesAccepted: 0,
  nudgesDismissed: 0,
  pausedUntil: 0,
  sessionStartTime: Date.now(),
  tabsClosedInWindow: 0,
  lastTabCloseTime: 0,
};

// Config
const MAX_NUDGES_PER_DAY = 2;
const MIN_MINUTES_BETWEEN_NUDGES = 30;
const PAUSE_DURATION_HOURS = 48;
const CONSECUTIVE_DISMISSALS_TO_PAUSE = 3;
const LONG_SESSION_MINUTES = 45;
const TABS_CLOSED_THRESHOLD = 3;
const TABS_CLOSED_WINDOW_MS = 60000; // 1 minute window

// Nudge copy - rotates randomly
const NUDGE_MESSAGES = [
  "Before you forget — worth remembering what you just did?",
  "Quick note before you move on?",
  "Did you just finish something?",
  "Anything worth keeping from that session?",
];

export function getRandomNudgeMessage(): string {
  return NUDGE_MESSAGES[Math.floor(Math.random() * NUDGE_MESSAGES.length)];
}

// Storage helpers
async function getState(): Promise<NudgeState> {
  const result = await chrome.storage.local.get('nudgeState');
  const state = result.nudgeState || DEFAULT_STATE;

  // Reset daily counter if it's a new day
  const lastNudgeDate = new Date(state.lastNudgeTime).toDateString();
  const today = new Date().toDateString();
  if (lastNudgeDate !== today) {
    state.nudgesToday = 0;
  }

  return state;
}

async function setState(state: Partial<NudgeState>): Promise<void> {
  const current = await getState();
  await chrome.storage.local.set({
    nudgeState: { ...current, ...state },
  });
}

// Check if nudges are permanently disabled
async function isPermanentlyDisabled(): Promise<boolean> {
  const state = await getState();
  // If user has dismissed 10+ nudges and never accepted one, disable permanently
  return state.nudgesDismissed >= 10 && state.nudgesAccepted === 0;
}

// DEMO MODE - set to true to bypass all nudge restrictions
const DEMO_MODE = false;

// Check if we can show a nudge right now
export async function canShowNudge(): Promise<boolean> {
  // Demo mode: always allow nudges
  if (DEMO_MODE) {
    console.log('WorthKeeping: Demo mode - allowing nudge');
    return true;
  }

  const state = await getState();
  const now = Date.now();

  // Check permanent disable
  if (await isPermanentlyDisabled()) {
    console.log('WorthKeeping: Nudges permanently disabled (user never engages)');
    return false;
  }

  // Check if paused
  if (state.pausedUntil > now) {
    console.log('WorthKeeping: Nudges paused until', new Date(state.pausedUntil));
    return false;
  }

  // Check daily limit
  if (state.nudgesToday >= MAX_NUDGES_PER_DAY) {
    console.log('WorthKeeping: Daily nudge limit reached');
    return false;
  }

  // Check minimum time between nudges
  const minutesSinceLastNudge = (now - state.lastNudgeTime) / 1000 / 60;
  if (minutesSinceLastNudge < MIN_MINUTES_BETWEEN_NUDGES) {
    console.log('WorthKeeping: Too soon since last nudge');
    return false;
  }

  return true;
}

// Record that we showed a nudge
export async function recordNudgeShown(): Promise<void> {
  const state = await getState();
  await setState({
    nudgesToday: state.nudgesToday + 1,
    lastNudgeTime: Date.now(),
  });
}

// Record that user accepted the nudge (logged something)
export async function recordNudgeAccepted(): Promise<void> {
  const state = await getState();
  await setState({
    consecutiveDismissals: 0,
    nudgesAccepted: state.nudgesAccepted + 1,
  });
  console.log('WorthKeeping: Nudge accepted, reset dismissal counter');
}

// Record that user dismissed the nudge
export async function recordNudgeDismissed(): Promise<void> {
  const state = await getState();
  const newConsecutive = state.consecutiveDismissals + 1;

  const updates: Partial<NudgeState> = {
    consecutiveDismissals: newConsecutive,
    nudgesDismissed: state.nudgesDismissed + 1,
  };

  // Pause if too many consecutive dismissals
  if (newConsecutive >= CONSECUTIVE_DISMISSALS_TO_PAUSE) {
    updates.pausedUntil = Date.now() + PAUSE_DURATION_HOURS * 60 * 60 * 1000;
    updates.consecutiveDismissals = 0;
    console.log('WorthKeeping: Too many dismissals, pausing nudges for 48 hours');
  }

  await setState(updates);
}

// Session tracking - call when extension starts
export async function startSession(): Promise<void> {
  await setState({
    sessionStartTime: Date.now(),
    tabsClosedInWindow: 0,
  });
}

// Check if it's been a long session
export async function isLongSession(): Promise<boolean> {
  const state = await getState();
  const sessionMinutes = (Date.now() - state.sessionStartTime) / 1000 / 60;
  return sessionMinutes >= LONG_SESSION_MINUTES;
}

// Track tab closes
export async function recordTabClosed(): Promise<boolean> {
  const state = await getState();
  const now = Date.now();

  // Reset counter if outside the window
  let tabsInWindow = state.tabsClosedInWindow;
  if (now - state.lastTabCloseTime > TABS_CLOSED_WINDOW_MS) {
    tabsInWindow = 0;
  }

  tabsInWindow++;

  await setState({
    tabsClosedInWindow: tabsInWindow,
    lastTabCloseTime: now,
  });

  // Return true if threshold reached
  return tabsInWindow >= TABS_CLOSED_THRESHOLD;
}

// Reset tab close counter (after nudge shown)
export async function resetTabCloseCounter(): Promise<void> {
  await setState({
    tabsClosedInWindow: 0,
  });
}

// Get current state (for debugging)
export async function getNudgeState(): Promise<NudgeState> {
  return getState();
}
