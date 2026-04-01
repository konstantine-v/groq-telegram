import type { ChatCompletion } from "groq-sdk/resources/chat/completions";
export type { ChatCompletion };

export type AssistantMessage = ChatCompletion["choices"][number]["message"] & {
  reasoning?: string | null;
};

export type MessageRole = "user" | "assistant";
export type ChatMessageRole = "system" | "user" | "assistant";
export type ContextLimitValue = number | null;

export interface Message {
  readonly role: MessageRole;
  readonly content: string;
}

export interface ChatMessage {
  readonly role: ChatMessageRole;
  readonly content: string;
}

export interface ProcessMessageResult {
  /** Plain assistant text for Groq history. */
  readonly response: string | undefined;
  /** MarkdownV2 body for Telegram (blockquotes for thinking when shown). */
  readonly telegramBody: string | undefined;
}

export interface Config {
  readonly systemPrompt: string;
  readonly contextLimit: ContextLimitValue;
  readonly model: string;
  readonly debugMode: boolean;
  readonly telegramBotToken: string;
  readonly groqApiKey: string | undefined;
  /**
   * When `true`: include Groq `message.reasoning` and full `content` (with `think` blocks).
   * When `false`: strip `think`…`</think>` from `content` and omit `reasoning`.
   * Also read from `Thinking_Tokens` if `THINKING_TOKENS` is unset.
   */
  readonly thinkingTokens: boolean;
}
