import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-solid'],
  manifest: {
    name: 'WorthKeeping',
    description: 'Capture what you did. Remember what mattered.',
    permissions: ['activeTab', 'storage', 'sidePanel', 'scripting'],
    action: {
      default_title: 'Open WorthKeeping',
    },
    commands: {
      'capture-memory': {
        suggested_key: {
          default: 'Ctrl+Shift+L',
          mac: 'Command+Shift+L',
        },
        description: 'Capture a memory',
      },
    },
    side_panel: {
      default_path: 'sidepanel.html',
    },
    // CSP for WASM execution (required for Transformers.js)
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';",
    },
    // Make WASM files accessible
    web_accessible_resources: [
      {
        resources: ['wasm/*'],
        matches: ['<all_urls>'],
      },
    ],
  },
});
