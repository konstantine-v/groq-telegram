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
  /** OpenWeatherMap API key for `/weather` (optional until command is used). */
  readonly openWeatherApiKey: string | undefined;
  /**
   * When `true`: include Groq `message.reasoning` and full `content` (with `think` blocks).
   * When `false`: strip `think`…`</think>` from `content` and omit `reasoning`.
   * Also read from `Thinking_Tokens` if `THINKING_TOKENS` is unset.
   */
  readonly thinkingTokens: boolean;
}

/** Normalized current weather for replies. */
export interface WeatherSnapshot {
  readonly cityName: string;
  readonly countryCode: string;
  readonly tempC: number;
  readonly tempF: number;
  readonly feelsLikeC: number;
  readonly feelsLikeF: number;
  readonly condition: string;
  readonly humidity: number;
  readonly windMps: number | undefined;
}

export type WeatherFetchErrorKind =
  | "missing_api_key"
  | "city_not_found"
  | "upstream_error"
  | "invalid_response";

export interface WeatherFetchError {
  readonly kind: WeatherFetchErrorKind;
  readonly message: string;
}

export type WeatherFetchResult =
  | { readonly ok: true; readonly data: WeatherSnapshot }
  | { readonly ok: false; readonly error: WeatherFetchError };

/** OpenWeather 2.5 `/data/2.5/weather` — fields we read (subset). */
export interface OpenWeatherMain {
  readonly temp: number;
  readonly feels_like: number;
  readonly humidity?: number;
}

export interface OpenWeatherWeatherItem {
  readonly main?: string;
  readonly description?: string;
}

export interface OpenWeatherSys {
  readonly country?: string;
}

export interface OpenWeatherWind {
  readonly speed?: number;
}

export interface OpenWeatherCurrentResponse {
  readonly name?: string;
  readonly cod?: number | string;
  readonly message?: string;
  readonly main?: OpenWeatherMain;
  readonly weather?: readonly OpenWeatherWeatherItem[];
  readonly sys?: OpenWeatherSys;
  readonly wind?: OpenWeatherWind;
}
