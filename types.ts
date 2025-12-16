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

export type History = ReadonlyMap<number, readonly Message[]>;

export interface ProcessMessageResult {
  readonly response: string | undefined;
  readonly updatedHistory: History;
}

export interface Config {
  readonly systemPrompt: string;
  readonly contextLimit: string;
  readonly model: string;
  readonly debugMode: string;
  readonly telegramBotToken: string;
  readonly groqApiKey: string | undefined;
}

