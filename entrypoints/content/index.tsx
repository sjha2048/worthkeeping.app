import { render } from 'solid-js/web';
import { createSignal, onMount, Show } from 'solid-js';

// Note: We use message passing instead of direct db access
// because content scripts run in the webpage context, not extension context

// Styles injected into shadow DOM for isolation
const styles = `
  * {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  .wk-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.4);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 2147483647;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    animation: fadeIn 0.2s cubic-bezier(0.16, 1, 0.3, 1);
    will-change: opacity;
  }

  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  @keyframes slideUp {
    from {
      opacity: 0;
      transform: translate3d(0, 20px, 0) scale(0.95);
    }
    to {
      opacity: 1;
      transform: translate3d(0, 0, 0) scale(1);
    }
  }

  .wk-modal {
    background: #ffffff;
    border-radius: 16px;
    padding: 24px;
    width: 90%;
    max-width: 480px;
    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
    animation: slideUp 0.25s cubic-bezier(0.16, 1, 0.3, 1);
    will-change: transform, opacity;
    backface-visibility: hidden;
    transform: translateZ(0);
  }

  .wk-label {
    font-size: 14px;
    color: #6b7280;
    margin-bottom: 12px;
    display: block;
  }

  .wk-input {
    width: 100%;
    padding: 16px;
    font-size: 18px;
    border: 2px solid #e5e7eb;
    border-radius: 12px;
    outline: none;
    transition: border-color 0.15s ease, background 0.15s ease;
    background: #f9fafb;
    color: #111827;
    -webkit-text-fill-color: #111827;
    caret-color: #3b82f6;
  }

  .wk-input:focus {
    border-color: #3b82f6;
    background: #ffffff;
  }

  .wk-input::placeholder {
    color: #9ca3af;
    -webkit-text-fill-color: #9ca3af;
  }

  .wk-hint {
    margin-top: 12px;
    font-size: 12px;
    color: #9ca3af;
    text-align: center;
  }

  .wk-hint kbd {
    background: #f3f4f6;
    padding: 2px 6px;
    border-radius: 4px;
    font-family: inherit;
    font-size: 11px;
  }

  .wk-saved {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 24px;
  }

  .wk-saved-icon {
    width: 48px;
    height: 48px;
    background: #10b981;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    animation: scaleIn 0.2s ease-out;
  }

  @keyframes scaleIn {
    from { transform: scale(0); }
    to { transform: scale(1); }
  }

  .wk-saved-icon svg {
    width: 24px;
    height: 24px;
    color: white;
  }

  .wk-saved-text {
    font-size: 16px;
    color: #374151;
    font-weight: 500;
  }

  /* Nudge toast styles */
  .wk-nudge {
    position: fixed;
    bottom: 24px;
    right: 24px;
    background: #1f2937;
    color: white;
    padding: 16px 20px;
    border-radius: 12px;
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
    z-index: 2147483646;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    max-width: 340px;
    animation: slideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1);
    will-change: transform, opacity;
    backface-visibility: hidden;
    transform: translateZ(0);
  }

  @keyframes slideIn {
    from {
      opacity: 0;
      transform: translate3d(0, 20px, 0);
    }
    to {
      opacity: 1;
      transform: translate3d(0, 0, 0);
    }
  }

  .wk-nudge-text {
    font-size: 14px;
    line-height: 1.5;
    margin-bottom: 12px;
  }

  .wk-nudge-actions {
    display: flex;
    gap: 8px;
  }

  .wk-nudge-btn {
    padding: 8px 16px;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    border: none;
    transition: all 0.15s ease;
  }

  .wk-nudge-btn-primary {
    background: #3b82f6;
    color: white;
  }

  .wk-nudge-btn-primary:hover {
    background: #2563eb;
  }

  .wk-nudge-btn-dismiss {
    background: transparent;
    color: #9ca3af;
  }

  .wk-nudge-btn-dismiss:hover {
    color: white;
  }
`;

function CaptureOverlay(props: { onClose: () => void; onSave?: () => void }) {
  const [text, setText] = createSignal('');
  const [saved, setSaved] = createSignal(false);
  let inputRef: HTMLInputElement | undefined;

  const handleSave = async () => {
    const value = text().trim();
    if (!value) {
      props.onClose();
      return;
    }

    // Get current tab context
    const context = {
      url: window.location.href,
      title: document.title,
    };

    // Send message to background script to save (background has extension context)
    try {
      await browser.runtime.sendMessage({
        type: 'SAVE_ENTRY',
        text: value,
        context,
        fromNudge: !!props.onSave,
      });

      setSaved(true);

      // Auto-close after brief confirmation
      setTimeout(() => {
        props.onClose();
      }, 600);
    } catch (err) {
      console.error('WorthKeeping: Failed to save entry', err);
      props.onClose();
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSave();
    } else if (e.key === 'Escape') {
      props.onClose();
    }
  };

  onMount(() => {
    // Focus input immediately
    setTimeout(() => inputRef?.focus(), 50);
  });

  return (
    <div class="wk-overlay" onClick={(e) => e.target === e.currentTarget && props.onClose()}>
      <div class="wk-modal">
        <Show
          when={!saved()}
          fallback={
            <div class="wk-saved">
              <div class="wk-saved-icon">
                <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <span class="wk-saved-text">Saved</span>
            </div>
          }
        >
          <label class="wk-label">What did you just do?</label>
          <input
            ref={inputRef}
            type="text"
            class="wk-input"
            placeholder="Shipped the login fix..."
            value={text()}
            onInput={(e) => setText(e.currentTarget.value)}
            onKeyDown={handleKeyDown}
          />
          <p class="wk-hint">
            <kbd>Enter</kbd> to save · <kbd>Esc</kbd> to close
          </p>
        </Show>
      </div>
    </div>
  );
}

// Nudge toast component
function NudgeToast(props: { message: string; onAccept: () => void; onDismiss: () => void }) {
  return (
    <div class="wk-nudge">
      <p class="wk-nudge-text">{props.message}</p>
      <div class="wk-nudge-actions">
        <button class="wk-nudge-btn wk-nudge-btn-primary" onClick={props.onAccept}>
          Quick note
        </button>
        <button class="wk-nudge-btn wk-nudge-btn-dismiss" onClick={props.onDismiss}>
          Not now
        </button>
      </div>
    </div>
  );
}

export default defineContentScript({
  matches: ['<all_urls>'],
  cssInjectionMode: 'ui',

  async main(ctx) {
    console.log('WorthKeeping: Content script loaded on', window.location.href);

    let captureContainer: ReturnType<typeof createIntegratedUi> | null = null;
    let nudgeContainer: ReturnType<typeof createIntegratedUi> | null = null;

    // Helper to show capture overlay
    const showCaptureOverlay = (fromNudge = false) => {
      // Close nudge if open
      if (nudgeContainer) {
        nudgeContainer.remove();
        nudgeContainer = null;
      }

      if (captureContainer) {
        captureContainer.remove();
        captureContainer = null;
        return;
      }

      captureContainer = createIntegratedUi(ctx, {
        position: 'overlay',
        onMount: (container) => {
          const styleEl = document.createElement('style');
          styleEl.textContent = styles;
          container.parentElement?.appendChild(styleEl);

          render(
            () => (
              <CaptureOverlay
                onClose={() => {
                  captureContainer?.remove();
                  captureContainer = null;
                }}
                onSave={fromNudge ? () => {} : undefined}
              />
            ),
            container
          );
        },
      });
      captureContainer.mount();
    };

    // Helper to show nudge
    const showNudge = (message: string) => {
      if (nudgeContainer || captureContainer) return; // Don't show if something is already open

      nudgeContainer = createIntegratedUi(ctx, {
        position: 'inline',
        anchor: document.body,
        append: 'last',
        onMount: (container) => {
          const styleEl = document.createElement('style');
          styleEl.textContent = styles;
          container.parentElement?.appendChild(styleEl);

          render(
            () => (
              <NudgeToast
                message={message}
                onAccept={() => {
                  nudgeContainer?.remove();
                  nudgeContainer = null;
                  showCaptureOverlay(true);
                }}
                onDismiss={() => {
                  browser.runtime.sendMessage({ type: 'NUDGE_DISMISSED' });
                  nudgeContainer?.remove();
                  nudgeContainer = null;
                }}
              />
            ),
            container
          );
        },
      });
      nudgeContainer.mount();

      // Auto-dismiss after 10 seconds
      setTimeout(() => {
        if (nudgeContainer) {
          browser.runtime.sendMessage({ type: 'NUDGE_DISMISSED' });
          nudgeContainer.remove();
          nudgeContainer = null;
        }
      }, 10000);
    };

    // Listen for messages from background
    browser.runtime.onMessage.addListener((message) => {
      console.log('WorthKeeping: Content script received message:', message);

      if (message.type === 'TOGGLE_CAPTURE') {
        showCaptureOverlay(false);
      } else if (message.type === 'SHOW_NUDGE') {
        showNudge(message.message);
      }
    });
  },
});
