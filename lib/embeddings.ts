import { pipeline, env, type FeatureExtractionPipeline } from '@huggingface/transformers';
import {
  type MemoryEntry,
  updateEntryEmbedding,
  getEntriesWithoutEmbeddings,
  getEntriesWithEmbeddings,
} from './db';

// Configure Transformers.js for Chrome extension environment
// Must be set before any model loading

// Use chrome.runtime.getURL for the correct extension path to WASM files
const wasmPath = typeof chrome !== 'undefined' && chrome.runtime?.getURL
  ? chrome.runtime.getURL('wasm/')
  : '/wasm/';

env.backends.onnx.wasm.wasmPaths = wasmPath;

// Don't try local model paths - always fetch from HuggingFace CDN
// This prevents 404 warnings for /models/... paths
env.allowLocalModels = false;

// Cache downloaded models in browser IndexedDB
env.useBrowserCache = true;

console.log('WorthKeeping: WASM path configured to', wasmPath);

// Model config - small but effective
const MODEL_NAME = 'Xenova/all-MiniLM-L6-v2';
const EMBEDDING_DIM = 384;

// Singleton pipeline
let embeddingPipeline: FeatureExtractionPipeline | null = null;
let isLoadingModel = false;
let modelLoadPromise: Promise<FeatureExtractionPipeline> | null = null;

// Load the embedding model (lazy, singleton)
async function getEmbeddingPipeline(): Promise<FeatureExtractionPipeline> {
  if (embeddingPipeline) {
    return embeddingPipeline;
  }

  if (modelLoadPromise) {
    return modelLoadPromise;
  }

  isLoadingModel = true;
  console.log('WorthKeeping: Loading embedding model...');

  modelLoadPromise = pipeline('feature-extraction', MODEL_NAME, {
    dtype: 'fp32',
  }).then((pipe) => {
    embeddingPipeline = pipe as FeatureExtractionPipeline;
    isLoadingModel = false;
    console.log('WorthKeeping: Embedding model loaded');
    return embeddingPipeline;
  });

  return modelLoadPromise;
}

// Check if model is currently loading
export function isModelLoading(): boolean {
  return isLoadingModel;
}

// Check if model is ready
export function isModelReady(): boolean {
  return embeddingPipeline !== null;
}

// Generate embedding for text
export async function generateEmbedding(text: string): Promise<number[]> {
  const pipe = await getEmbeddingPipeline();
  const output = await pipe(text, { pooling: 'mean', normalize: true });

  // Convert to array
  const embedding = Array.from(output.data as Float32Array);
  return embedding.slice(0, EMBEDDING_DIM);
}

// Generate embedding for an entry and save it
export async function embedEntry(entry: MemoryEntry): Promise<void> {
  try {
    const embedding = await generateEmbedding(entry.text);
    await updateEntryEmbedding(entry.id, embedding);
    console.log('WorthKeeping: Embedded entry', entry.id);
  } catch (err) {
    console.error('WorthKeeping: Failed to embed entry', entry.id, err);
  }
}

// Process all entries without embeddings (background job)
export async function processUnembeddedEntries(): Promise<number> {
  const entries = await getEntriesWithoutEmbeddings();

  if (entries.length === 0) {
    return 0;
  }

  console.log(`WorthKeeping: Processing ${entries.length} unembedded entries`);

  // Process in batches to avoid blocking
  for (const entry of entries) {
    await embedEntry(entry);
    // Small delay to not block UI
    await new Promise((r) => setTimeout(r, 50));
  }

  return entries.length;
}

// Cosine similarity between two vectors
function cosineSimilarity(a: number[], b: number[]): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

// Semantic search - find entries similar to query
export async function semanticSearch(
  query: string,
  options?: {
    limit?: number;
    minScore?: number;
    startTime?: number;
    endTime?: number;
  }
): Promise<Array<{ entry: MemoryEntry; score: number }>> {
  const { limit = 10, minScore = 0.3, startTime, endTime } = options ?? {};

  // Generate query embedding
  const queryEmbedding = await generateEmbedding(query);

  // Get all entries with embeddings
  let entries = await getEntriesWithEmbeddings();

  // Filter by time range if specified
  if (startTime !== undefined || endTime !== undefined) {
    entries = entries.filter((entry) => {
      if (startTime && entry.timestamp < startTime) return false;
      if (endTime && entry.timestamp > endTime) return false;
      return true;
    });
  }

  // Calculate similarity scores
  const results = entries
    .map((entry) => ({
      entry,
      score: cosineSimilarity(queryEmbedding, entry.embedding!),
    }))
    .filter((r) => r.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return results;
}

// Get time range helpers
export function getTimeRange(range: 'today' | 'week' | 'month' | 'quarter' | 'year'): {
  startTime: number;
  endTime: number;
} {
  const now = new Date();
  const endTime = now.getTime();
  let startTime: number;

  switch (range) {
    case 'today':
      const today = new Date(now);
      today.setHours(0, 0, 0, 0);
      startTime = today.getTime();
      break;
    case 'week':
      const weekStart = new Date(now);
      weekStart.setDate(now.getDate() - now.getDay());
      weekStart.setHours(0, 0, 0, 0);
      startTime = weekStart.getTime();
      break;
    case 'month':
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      startTime = monthStart.getTime();
      break;
    case 'quarter':
      const quarterMonth = Math.floor(now.getMonth() / 3) * 3;
      const quarterStart = new Date(now.getFullYear(), quarterMonth, 1);
      startTime = quarterStart.getTime();
      break;
    case 'year':
      const yearStart = new Date(now.getFullYear(), 0, 1);
      startTime = yearStart.getTime();
      break;
  }

  return { startTime, endTime };
}

// Preload the model (call early to warm up)
export async function preloadModel(): Promise<void> {
  try {
    await getEmbeddingPipeline();
  } catch (err) {
    console.error('WorthKeeping: Failed to preload model', err);
  }
}
