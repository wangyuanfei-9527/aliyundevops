// =============================================================================
// LLM Provider Abstraction — A7 AI
// Interface for LLM calls. Real provider calls OpenAI-compatible API.
// Mock provider returns fixture data for local-safe testing.
// =============================================================================

import { redact } from "@/src/lib/redact";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LLMConfig {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  /** "auto" | "responses" | "chat_completions" */
  apiMode?: string;
}

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMResponse {
  content: string;
  model?: string;
  usage?: { promptTokens: number; completionTokens: number };
}

// ---------------------------------------------------------------------------
// Provider interface
// ---------------------------------------------------------------------------

export interface ILLMProvider {
  /** Send messages and get a completion */
  complete(messages: LLMMessage[]): Promise<LLMResponse>;

  /** Whether this provider is configured for real calls */
  isConfigured(): boolean;
}

// ---------------------------------------------------------------------------
// Real provider — OpenAI-compatible API
// ---------------------------------------------------------------------------

export class OpenAIProvider implements ILLMProvider {
  constructor(private readonly config: LLMConfig) {}

  isConfigured(): boolean {
    return !!this.config.apiKey;
  }

  async complete(messages: LLMMessage[]): Promise<LLMResponse> {
    if (!this.config.apiKey) {
      throw new Error("OPENAI_API_KEY is not configured");
    }

    const baseUrl = this.config.baseUrl || "https://api.openai.com/v1";
    const model = this.config.model || "gpt-4o";

    const url = `${baseUrl}/chat/completions`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0,
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `LLM API error (${response.status}): ${redact(text)}`,
      );
    }

    const data = (await response.json()) as Record<string, unknown>;
    const choices = data.choices as Array<Record<string, unknown>> | undefined;
    const message = choices?.[0]?.message as Record<string, unknown> | undefined;
    const content = String(message?.content ?? "");
    const usage = data.usage as Record<string, number> | undefined;

    return {
      content,
      model: String(data.model ?? model),
      usage: usage
        ? {
            promptTokens: usage.prompt_tokens ?? 0,
            completionTokens: usage.completion_tokens ?? 0,
          }
        : undefined,
    };
  }
}

// ---------------------------------------------------------------------------
// Mock provider — returns fixture data for testing
// ---------------------------------------------------------------------------

export class MockLLMProvider implements ILLMProvider {
  private responseContent: string;

  constructor(responseContent: string) {
    this.responseContent = responseContent;
  }

  isConfigured(): boolean {
    return true;
  }

  async complete(_messages: LLMMessage[]): Promise<LLMResponse> {
    return {
      content: this.responseContent,
      model: "mock",
    };
  }
}

// ---------------------------------------------------------------------------
// Provider factory
// ---------------------------------------------------------------------------

/**
 * Create an LLM provider based on configuration.
 * Returns MockLLMProvider if apiKey is not set.
 */
export function createLLMProvider(config: LLMConfig): ILLMProvider {
  if (config.apiKey) {
    return new OpenAIProvider(config);
  }
  // No API key — return a provider that will throw on actual calls
  // This allows the system to fall back to template/manual mode
  return new OpenAIProvider(config);
}
