# WorthKeeping

A Chrome extension for capturing work accomplishments and generating AI-powered performance review summaries. Built with a local-first, privacy-preserving architecture.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Browser                               │
│                                                              │
│  ┌──────────┐    ┌──────────┐    ┌─────────────────────┐    │
│  │ Content  │    │  Side    │    │    Background       │    │
│  │ Script   │───▶│  Panel   │◀──▶│    Worker           │    │
│  │(Overlay) │    │  (UI)    │    │ (Embeddings Queue)  │    │
│  └──────────┘    └────┬─────┘    └──────────┬──────────┘    │
│                       │                      │               │
│                       ▼                      ▼               │
│              ┌─────────────────────────────────┐             │
│              │         IndexedDB (Dexie.js)    │             │
│              │      All data stays here        │             │
│              └─────────────────────────────────┘             │
│                       │                                      │
│         ┌─────────────┴─────────────┐                       │
│         ▼                           ▼                        │
│  ┌──────────────┐          ┌───────────────┐                │
│  │Transformers.js│          │ Vercel AI SDK │                │
│  │  (On-Device) │          │(User API Key) │────────────┐   │
│  └──────────────┘          └───────────────┘            │   │
└─────────────────────────────────────────────────────────│───┘
                                                          ▼
                                              ┌───────────────────┐
                                              │  AI Provider API  │
                                              │ (OpenAI/Claude/   │
                                              │  Gemini/Ollama)   │
                                              └───────────────────┘
```

## Tech Stack

| Layer | Technology | Why |
|-------|------------|-----|
| **Framework** | WXT | Manifest V3 compliant, hot reload, TypeScript-first |
| **UI** | SolidJS | 15KB bundle, fine-grained reactivity, no virtual DOM overhead |
| **Storage** | Dexie.js + IndexedDB | Reactive queries, schema migrations, 100% client-side |
| **Embeddings** | Transformers.js (MiniLM-L6-v2) | On-device ML, 384-dim vectors, no server roundtrip |
| **AI** | Vercel AI SDK | Unified interface for OpenAI/Anthropic/Google, streaming support |
| **Styling** | Tailwind CSS | Utility-first, minimal CSS bundle |

## Key Design Decisions

**Local-First Storage**
All data lives in IndexedDB. No accounts, no sync, no data leaves the browser. Users own their data completely.

**On-Device ML**
Semantic search runs entirely in the browser using ONNX Runtime WebAssembly. The MiniLM model is cached after first load for instant subsequent searches.

**BYO API Key**
AI features use the user's own API key with direct browser-to-provider communication. We're never in the middle.

**Minimal Permissions**
Only `activeTab`, `storage`, and `sidePanel`. No access to tabs, history, or browsing data.

## Project Structure

```
├── entrypoints/
│   ├── background.ts      # Service worker, keyboard shortcuts, embedding queue
│   ├── content/           # Capture overlay injected on Cmd+Shift+L
│   └── sidepanel/         # Main UI (history, search, chat)
├── lib/
│   ├── db.ts              # Dexie schema, reactive queries
│   ├── embeddings.ts      # Transformers.js wrapper, cosine similarity
│   └── ai.ts              # Multi-provider AI client
└── public/
    └── wasm/              # ONNX Runtime binaries
```

## Development

```bash
npm install
npm run dev        # Start with hot reload
npm run build      # Production build
npm run zip        # Create store-ready zip
```

## License

MIT
