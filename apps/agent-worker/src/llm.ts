/**
 * ChronoCanvas agent-worker — LLM client initialisation (Stage 3).
 *
 * This module is the single source of truth for the OpenAI/OpenRouter client
 * used by Temporal activities.  It is intentionally separated from activities.ts
 * so that:
 *
 *   1. The `.env` load call lives in one place and fires exactly once per
 *      worker process, regardless of how many activities import this module.
 *   2. Activities only need `import { getLlmClient } from './llm'` — they never
 *      touch `process.env` or the OpenAI constructor directly.
 *   3. The client can be tested or swapped without touching activity logic.
 *
 * Environment variables consumed (all read from `.env` in the agent-worker root
 * directory *or* from the shell environment, whichever is already set):
 *
 *   OPENROUTER_API_KEY   — required.  The OpenRouter bearer token.
 *   OPENROUTER_BASE_URL  — optional.  Defaults to https://openrouter.ai/api/v1
 *   OPENROUTER_MODEL     — optional.  Defaults to openrouter/auto
 *
 * ⚠️  The `.env` file is loaded with `override: false`, which means shell-level
 *    environment variables always win over `.env` values — the recommended
 *    behaviour for production deployments.
 */

import path from 'node:path';
import * as dotenv from 'dotenv';
import OpenAI from 'openai';

// ---------------------------------------------------------------------------
// Load .env from apps/agent-worker/.env  (one directory up from src/)
// ---------------------------------------------------------------------------

const envPath = path.resolve(__dirname, '..', '.env');

// `override: false` — existing shell env vars take precedence over .env values.
// `path` — explicit path so dotenv does not fall back to process.cwd().
dotenv.config({ path: envPath, override: false });

// ---------------------------------------------------------------------------
// Public config accessors
// ---------------------------------------------------------------------------

/** The active OpenRouter (or OpenAI-compatible) model identifier. */
export function getLlmModel(): string {
  return process.env.OPENROUTER_MODEL ?? 'openrouter/auto';
}

// ---------------------------------------------------------------------------
// Singleton OpenAI client
// ---------------------------------------------------------------------------

let _client: OpenAI | null = null;

/**
 * Return an OpenAI client instance.
 *
 * If a `dynamicApiKey` is provided (e.g. user BYOK key), constructs a dedicated
 * client using that key without mutating the process singleton.
 * Otherwise, falls back to the process-wide singleton using OPENROUTER_API_KEY.
 *
 * @throws {Error} when neither dynamicApiKey nor OPENROUTER_API_KEY is present.
 */
export function getLlmClient(dynamicApiKey?: string): OpenAI {
  const key = dynamicApiKey?.trim();
  if (key) {
    // If user provided a direct OpenAI key vs OpenRouter key, point to respective gateway
    const isDirectOpenAi = key.startsWith('sk-') && !key.startsWith('sk-or-');
    const baseURL = process.env.OPENROUTER_BASE_URL ?? (isDirectOpenAi ? 'https://api.openai.com/v1' : 'https://openrouter.ai/api/v1');

    return new OpenAI({
      apiKey: key,
      baseURL,
      defaultHeaders: {
        'HTTP-Referer': 'https://github.com/ChronoCanvas/chrono-canvas',
        'X-Title':      'ChronoCanvas Agent Worker (BYOK)',
      },
    });
  }

  if (_client) return _client;

  const envApiKey = process.env.OPENROUTER_API_KEY;
  if (!envApiKey) {
    throw new Error(
      '[llm] OPENROUTER_API_KEY is not set and no BYOK dynamic API key was provided. ' +
      'Add OPENROUTER_API_KEY to apps/agent-worker/.env or provide a user API key.',
    );
  }

  _client = new OpenAI({
    apiKey: envApiKey,
    baseURL: process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1',
    defaultHeaders: {
      // OpenRouter attribution headers (optional but recommended by the docs).
      'HTTP-Referer': 'https://github.com/ChronoCanvas/chrono-canvas',
      'X-Title':      'ChronoCanvas Agent Worker',
    },
  });

  return _client;
}

/** Exposed for unit testing — resets the singleton so a new client is built. */
export function _resetLlmClientForTests(): void {
  _client = null;
}
