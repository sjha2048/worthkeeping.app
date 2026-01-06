import { generateText, streamText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { db, getSetting, setSetting, deleteSetting, type MemoryEntry } from './db';
import { getTimeRange } from './embeddings';

// Supported AI providers
export type AIProvider = 'openai' | 'anthropic' | 'google' | 'openai-compatible';

interface AIConfig {
  provider: AIProvider;
  apiKey: string;
  model?: string;
  baseURL?: string; // For OpenAI-compatible endpoints (LiteLLM, Ollama, etc.)
}

// Default models per provider
const DEFAULT_MODELS: Record<AIProvider, string> = {
  openai: 'gpt-4o-mini',
  anthropic: 'claude-3-5-haiku-latest',
  google: 'gemini-1.5-flash',
  'openai-compatible': 'gpt-4o-mini', // User should override this
};

// Settings keys
const SETTINGS_KEYS = {
  provider: 'ai_provider',
  apiKey: 'ai_api_key',
  model: 'ai_model',
  baseURL: 'ai_base_url',
};

// Get current AI config
export async function getAIConfig(): Promise<AIConfig | null> {
  const provider = (await getSetting(SETTINGS_KEYS.provider)) as AIProvider | null;
  const apiKey = await getSetting(SETTINGS_KEYS.apiKey);

  if (!provider || !apiKey) {
    return null;
  }

  const model = (await getSetting(SETTINGS_KEYS.model)) || DEFAULT_MODELS[provider];
  const baseURL = await getSetting(SETTINGS_KEYS.baseURL);

  return { provider, apiKey, model, baseURL: baseURL || undefined };
}

// Save AI config
export async function saveAIConfig(config: AIConfig): Promise<void> {
  await setSetting(SETTINGS_KEYS.provider, config.provider);
  await setSetting(SETTINGS_KEYS.apiKey, config.apiKey);
  if (config.model) {
    await setSetting(SETTINGS_KEYS.model, config.model);
  }
  if (config.baseURL) {
    await setSetting(SETTINGS_KEYS.baseURL, config.baseURL);
  } else {
    await deleteSetting(SETTINGS_KEYS.baseURL);
  }
}

// Clear AI config
export async function clearAIConfig(): Promise<void> {
  await deleteSetting(SETTINGS_KEYS.provider);
  await deleteSetting(SETTINGS_KEYS.apiKey);
  await deleteSetting(SETTINGS_KEYS.model);
  await deleteSetting(SETTINGS_KEYS.baseURL);
}

// Create provider instance based on config
function createProvider(provider: AIProvider, apiKey: string, baseURL?: string) {
  switch (provider) {
    case 'openai':
      return createOpenAI({ apiKey });
    case 'anthropic':
      return createAnthropic({ apiKey });
    case 'google':
      return createGoogleGenerativeAI({ apiKey });
    case 'openai-compatible':
      if (!baseURL) {
        throw new Error('Base URL is required for OpenAI-compatible provider');
      }
      return createOpenAI({ apiKey, baseURL });
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

// Unified AI call using Vercel AI SDK
export async function callAI(prompt: string): Promise<string> {
  const config = await getAIConfig();

  if (!config) {
    throw new Error('AI not configured. Please add your API key in settings.');
  }

  const { provider, apiKey, model, baseURL } = config;
  const modelId = model || DEFAULT_MODELS[provider];
  const providerInstance = createProvider(provider, apiKey, baseURL);

  const { text } = await generateText({
    model: providerInstance(modelId),
    prompt,
    maxTokens: 2000,
    temperature: 0.7,
  });

  return text;
}

// Streaming AI call - returns async generator
export async function* streamAI(prompt: string): AsyncGenerator<string, void, unknown> {
  const config = await getAIConfig();

  if (!config) {
    throw new Error('AI not configured. Please add your API key in settings.');
  }

  const { provider, apiKey, model, baseURL } = config;
  const modelId = model || DEFAULT_MODELS[provider];
  const providerInstance = createProvider(provider, apiKey, baseURL);

  const { textStream } = streamText({
    model: providerInstance(modelId),
    prompt,
    maxTokens: 2000,
    temperature: 0.7,
  });

  for await (const chunk of textStream) {
    yield chunk;
  }
}

// Test API key
export async function testAPIKey(
  provider: AIProvider,
  apiKey: string,
  baseURL?: string,
  model?: string
): Promise<boolean> {
  try {
    const modelId = model || DEFAULT_MODELS[provider];
    const providerInstance = createProvider(provider, apiKey, baseURL);

    await generateText({
      model: providerInstance(modelId),
      prompt: 'Say "OK" if you can read this.',
      maxTokens: 10,
    });

    return true;
  } catch (err) {
    console.error('API key test failed:', err);
    return false;
  }
}

// Format entries for AI context
function formatEntriesForContext(entries: MemoryEntry[]): string {
  return entries
    .map((e) => {
      const date = new Date(e.timestamp).toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      });
      const time = new Date(e.timestamp).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
      });
      return `- [${date} ${time}] ${e.text}`;
    })
    .join('\n');
}

// Build prompt for review question
export async function buildReviewPrompt(
  question: string,
  timeRange: 'week' | 'month' | 'quarter' | 'year' | 'all'
): Promise<{ prompt: string; entriesUsed: number }> {
  // Get ALL entries in time range (not semantic search - we want everything for reviews)
  const allEntries = await db.entries.orderBy('timestamp').reverse().toArray();

  let entries: MemoryEntry[];
  if (timeRange === 'all') {
    entries = allEntries;
  } else {
    const { startTime, endTime } = getTimeRange(timeRange);
    entries = allEntries.filter(
      (e) => e.timestamp >= startTime && e.timestamp <= endTime
    );
  }

  console.log('WorthKeeping: Building review prompt with', entries.length, 'entries in', timeRange);

  if (entries.length === 0) {
    return {
      prompt: '',
      entriesUsed: 0,
    };
  }

  const prompt = `You are a performance review writing assistant. Help me articulate my accomplishments for a performance review based on my work log entries.

Question: "${question}"

## Response Guidelines:

**Formatting:**
- Use markdown formatting with clear headers (##) to organize sections
- Use bullet points (- ) for listing accomplishments, skills, and action items
- Bold (**text**) key achievements, metrics, and outcomes
- Keep each bullet point specific and evidence-based

**Content Style:**
- Write in professional, performance-review-ready language
- Highlight specific achievements with quantifiable results when available
- Connect accomplishments to business impact where evident
- Group related work into themes (e.g., "Technical Contributions", "Collaboration", "Process Improvements")
- Include specific examples from the entries to support each point

**Structure your response with relevant sections like:**
- Key Accomplishments
- Skills Demonstrated
- Areas of Impact
- Growth & Development (if applicable)

**Important:**
- Only reference work that appears in my entries - do not invent details
- If entries lack specifics, acknowledge what was done at a high level
- Transform raw notes into polished, review-ready statements

My work log entries:
${formatEntriesForContext(entries)}`;

  return {
    prompt,
    entriesUsed: entries.length,
  };
}

