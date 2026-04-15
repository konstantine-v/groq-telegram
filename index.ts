import { Bot, Context } from "grammy";
import Groq from "groq-sdk";
import telegramifyMarkdown from "telegramify-markdown";
import type {
  ChatCompletion,
  AssistantMessage,
  Message,
  ChatMessage,
  MessageRole,
  ContextLimitValue,
  ProcessMessageResult,
  Config,
  OpenWeatherCurrentResponse,
  WeatherFetchResult,
  WeatherSnapshot,
} from "./types";

const parseContextLimit = (limit: string): ContextLimitValue => {
  if (limit === "all") return null;
  const parsed = parseInt(limit, 10);
  return isNaN(parsed) ? null : parsed;
};

const getConfig = (): Config => ({
  systemPrompt: process.env.SYSTEM_PROMPT ?? "You are a helpful assistant.",
  contextLimit: parseContextLimit(process.env.CONTEXT_LIMIT ?? "5"),
  model: process.env.GROQ_MODEL ?? "llama-3.1-8b-instant",
  debugMode: (process.env.DEBUG_MODE ?? "false").trim().toLowerCase() === "true",
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN ?? "",
  groqApiKey: process.env.GROQ_API_KEY,
  openWeatherApiKey: process.env.OPENWEATHER_API_KEY?.trim() || undefined,
  thinkingTokens: (process.env.THINKING_TOKENS ?? process.env.Thinking_Tokens ?? "false").trim().toLowerCase() === "true",
});

const config = getConfig();

if (!config.telegramBotToken) {
  console.error("TELEGRAM_BOT_TOKEN is required.");
  process.exit(1);
}

const OPENWEATHER_TIMEOUT_MS = 15_000;

const celsiusToFahrenheit = (c: number): number => (c * 9) / 5 + 32;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readCod = (raw: Record<string, unknown>): number | string | undefined => {
  const cod = raw["cod"];
  if (typeof cod === "number" || typeof cod === "string") return cod;
  return undefined;
};

const normalizeOpenWeatherResponse = (raw: OpenWeatherCurrentResponse): WeatherSnapshot | undefined => {
  const name = raw.name;
  const main = raw.main;
  if (typeof name !== "string" || name.length === 0 || !main) return undefined;
  if (typeof main.temp !== "number" || typeof main.feels_like !== "number") return undefined;

  const country =
    raw.sys && typeof raw.sys.country === "string" ? raw.sys.country : "—";
  const humidity = typeof main.humidity === "number" ? main.humidity : 0;
  const windSpeed = raw.wind?.speed;
  const windMps = typeof windSpeed === "number" ? windSpeed : undefined;

  const first = raw.weather?.[0];
  const condition =
    typeof first?.description === "string" && first.description.length > 0
      ? first.description
      : typeof first?.main === "string" && first.main.length > 0
        ? first.main
        : "Unknown";

  const tempC = main.temp;
  const feelsC = main.feels_like;

  return {
    cityName: name,
    countryCode: country,
    tempC,
    tempF: celsiusToFahrenheit(tempC),
    feelsLikeC: feelsC,
    feelsLikeF: celsiusToFahrenheit(feelsC),
    condition,
    humidity,
    windMps,
  };
};

const parseOpenWeatherJson = (raw: unknown): OpenWeatherCurrentResponse | undefined => {
  if (!isRecord(raw)) return undefined;
  return raw as OpenWeatherCurrentResponse;
};

const weatherFailure = (
  kind: "missing_api_key" | "city_not_found" | "upstream_error" | "invalid_response",
  message: string
): Extract<WeatherFetchResult, { ok: false }> => ({
  ok: false,
  error: { kind, message },
});

const fetchCurrentWeather = async (
  city: string,
  apiKey: string | undefined
): Promise<WeatherFetchResult> => {
  const trimmed = city.trim();
  if (!apiKey || apiKey.length === 0) {
    return weatherFailure("missing_api_key", "Set OPENWEATHER_API_KEY in the environment.");
  }
  if (trimmed.length === 0) {
    return weatherFailure("invalid_response", "City name is empty.");
  }

  const url = new URL("https://api.openweathermap.org/data/2.5/weather");
  url.searchParams.set("q", trimmed);
  url.searchParams.set("appid", apiKey);
  url.searchParams.set("units", "metric");

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(OPENWEATHER_TIMEOUT_MS) });
    const json: unknown = await res.json();
    const parsed = parseOpenWeatherJson(json);

    if (!parsed) {
      return weatherFailure("invalid_response", "Could not parse weather response.");
    }

    if (!res.ok) {
      const rec = isRecord(json) ? json : {};
      const cod = readCod(rec);
      if (cod === "404" || cod === 404) {
        return weatherFailure("city_not_found", `No results for "${trimmed}".`);
      }
      const msg =
        typeof rec["message"] === "string" && rec["message"].length > 0
          ? rec["message"]
          : typeof parsed.message === "string"
            ? parsed.message
            : res.statusText;
      return weatherFailure("upstream_error", msg || `HTTP ${String(res.status)}`);
    }

    const bodyRec = isRecord(json) ? json : {};
    const cod = readCod(bodyRec);
    if (cod !== 200 && cod !== "200") {
      return weatherFailure("invalid_response", "Unexpected response from weather API.");
    }

    const data = normalizeOpenWeatherResponse(parsed);
    if (!data) {
      return weatherFailure("invalid_response", "Incomplete weather data.");
    }
    return { ok: true, data };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Request failed.";
    return weatherFailure("upstream_error", msg);
  }
};

const groq = new Groq({
  apiKey: config.groqApiKey,
});

const bot = new Bot(
  config.telegramBotToken
);

const conversationHistory: Map<number, Message[]> = new Map();

const limitHistory = (history: readonly Message[], limit: ContextLimitValue): readonly Message[] => {
  if (limit === null) return history;
  if (limit === 0) return [];
  return history.slice(-limit);
};

const createSystemMessage = (prompt: string): ChatMessage => ({
  role: "system",
  content: prompt,
});

const createUserMessage = (content: string): ChatMessage => ({
  role: "user",
  content,
});

const buildMessages = (
  history: readonly Message[],
  currentMessage: string,
  limit: ContextLimitValue,
  systemPrompt: string
): readonly ChatMessage[] => [
  createSystemMessage(systemPrompt),
  ...limitHistory(history, limit),
  createUserMessage(currentMessage),
];

const createMessage = (role: MessageRole, content: string): Message => ({
  role,
  content,
});

/** Per Telegram MarkdownV2 rules for text outside entities. */
const escapeMarkdownV2 = (text: string): string =>
  text
    .replace(/\\/g, "\\\\")
    .replace(/_/g, "\\_")
    .replace(/\*/g, "\\*")
    .replace(/\[/g, "\\[")
    .replace(/]/g, "\\]")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/~/g, "\\~")
    .replace(/`/g, "\\`")
    .replace(/>/g, "\\>")
    .replace(/#/g, "\\#")
    .replace(/\+/g, "\\+")
    .replace(/-/g, "\\-")
    .replace(/=/g, "\\=")
    .replace(/\|/g, "\\|")
    .replace(/{/g, "\\{")
    .replace(/}/g, "\\}")
    .replace(/\./g, "\\.")
    .replace(/!/g, "\\!");

/** Telegram blockquote: each line starts with `>` (see core.telegram.org/bots/api#markdownv2-style). */
const formatMarkdownV2Blockquote = (text: string): string =>
  text
    .split("\n")
    .map((line) => ">" + escapeMarkdownV2(line))
    .join("\n");

const collectThinkInnerBlocks = (content: string): string[] => {
  const re = /<think>([\s\S]*?)<\/think>/gi;
  const blocks: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    blocks.push(m[1].trim());
  }
  return blocks;
};

type MessageParts = {
  reasoning: string;
  thinkBlocks: string[];
  mainContent: string;
  rawContent: string;
};

/** Single source of truth for decomposing a Groq completion message. */
const extractMessageParts = (completion: ChatCompletion): MessageParts | undefined => {
  const msg = completion.choices[0]?.message as AssistantMessage | undefined;
  if (!msg) return undefined;
  const rawContent = msg.content ?? "";
  const reasoning = typeof msg.reasoning === "string" ? msg.reasoning.trim() : "";
  const thinkBlocks = collectThinkInnerBlocks(rawContent);
  const mainContent = rawContent.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  return { reasoning, thinkBlocks, mainContent, rawContent };
};

const extractAssistantText = (
  completion: ChatCompletion,
  stripThinking: boolean
): string | undefined => {
  const parts = extractMessageParts(completion);
  if (!parts) return undefined;

  if (stripThinking) {
    return parts.mainContent.length > 0 ? parts.mainContent : undefined;
  }

  const merged = [parts.reasoning, parts.rawContent]
    .filter((s) => s.trim().length > 0)
    .join("\n\n");
  return merged.length > 0 ? merged : undefined;
};

const formatTelegramBody = (
  completion: ChatCompletion,
  stripThinking: boolean
): string | undefined => {
  const parts = extractMessageParts(completion);
  if (!parts) return undefined;

  if (stripThinking) {
    return parts.mainContent.length > 0
      ? telegramifyMarkdown(parts.mainContent, "escape")
      : undefined;
  }

  const result: string[] = [];
  const thinkingParts = [parts.reasoning, ...parts.thinkBlocks].filter(
    (s) => s.trim().length > 0
  );
  if (thinkingParts.length > 0) {
    result.push(formatMarkdownV2Blockquote(thinkingParts.join("\n\n")));
  }
  if (parts.mainContent.length > 0) {
    result.push(telegramifyMarkdown(parts.mainContent, "escape"));
  }
  return result.length > 0 ? result.join("\n\n") : undefined;
};

const replyTelegramMarkdownV2 = async (
  ctx: Context,
  body: string,
  fallbackPlain: string
): Promise<void> => {
  try {
    await ctx.reply(body, { parse_mode: "MarkdownV2" });
  } catch {
    await ctx.reply(fallbackPlain);
  }
};

const formatWeatherMarkdownV2 = (w: WeatherSnapshot): string => {
  const head = `*${escapeMarkdownV2(w.cityName)}* \\(${escapeMarkdownV2(w.countryCode)}\\)`;
  const cond = escapeMarkdownV2(w.condition);
  const temp = `Temp: ${escapeMarkdownV2(`${w.tempC.toFixed(1)} °C`)} / ${escapeMarkdownV2(`${w.tempF.toFixed(1)} °F`)}`;
  const feels = `Feels like: ${escapeMarkdownV2(`${w.feelsLikeC.toFixed(1)} °C`)} / ${escapeMarkdownV2(`${w.feelsLikeF.toFixed(1)} °F`)}`;
  const hum = `Humidity: ${escapeMarkdownV2(`${String(w.humidity)}%`)}`;
  const parts = [head, cond, temp, feels, hum];
  if (w.windMps !== undefined) {
    parts.push(`Wind: ${escapeMarkdownV2(`${w.windMps.toFixed(1)} m/s`)}`);
  }
  return parts.join("\n\n");
};

const formatWeatherPlain = (w: WeatherSnapshot): string => {
  const lines = [
    `${w.cityName} (${w.countryCode})`,
    "",
    w.condition,
    "",
    `Temp: ${w.tempC.toFixed(1)} °C / ${w.tempF.toFixed(1)} °F`,
    `Feels like: ${w.feelsLikeC.toFixed(1)} °C / ${w.feelsLikeF.toFixed(1)} °F`,
    `Humidity: ${w.humidity}%`,
  ];
  if (w.windMps !== undefined) {
    lines.push(`Wind: ${w.windMps.toFixed(1)} m/s`);
  }
  return lines.join("\n");
};

type GroqReply = { readonly historyText: string; readonly telegramBody: string };

const createCompletion = async (
  messages: readonly ChatMessage[],
  model: string
): Promise<GroqReply | undefined> => {
  try {
    const completion = await groq.chat.completions.create({
      messages: [...messages],
      model,
      stream: false,
    });
    const stripThinking = !config.thinkingTokens;
    const historyText = extractAssistantText(completion, stripThinking);
    if (!historyText) return undefined;
    const telegramBody = formatTelegramBody(completion, stripThinking);
    if (!telegramBody) return undefined;
    return { historyText, telegramBody };
  } catch (error: unknown) {
    console.error("Groq API error:", error);
    return undefined;
  }
};

const processMessage = async (
  history: Map<number, Message[]>,
  chatId: number,
  query: string,
  config: Config
): Promise<ProcessMessageResult> => {
  const chatHistory = history.get(chatId) ?? [];
  const messages = buildMessages(chatHistory, query, config.contextLimit, config.systemPrompt);
  const reply = await createCompletion(messages, config.model);

  if (reply) {
    history.set(chatId, [
      ...chatHistory,
      createMessage("user", query),
      createMessage("assistant", reply.historyText),
    ]);
  }

  return {
    response: reply?.historyText,
    telegramBody: reply?.telegramBody,
  };
};

const logDebug = (username: string | undefined, message: string, response: string | undefined): void => {
  console.time("DebugConsoleTime");
  console.log(
    "Message from:", username,
    "\nMessage:", message,
    "\nResponse:", response,
    "\nTimestamp:", new Date().toISOString(),
  );
  console.timeEnd("DebugConsoleTime");
};

const handleTextMessage = async (ctx: Context): Promise<void> => {
  const text = ctx.message?.text;
  const chatId = ctx.chat?.id;

  if (!text || !chatId) return;
  if (text.startsWith("/")) return;

  const { response, telegramBody } = await processMessage(
    conversationHistory,
    chatId,
    text,
    config
  );

  if (config.debugMode) {
    logDebug(ctx.from?.username, text, response);
  }

  if (telegramBody && response) {
    await replyTelegramMarkdownV2(ctx, telegramBody, response);
  }
};

bot.command("weather", async (ctx) => {
  const text = ctx.message?.text?.trim() ?? "";
  const m = /^\/weather(?:@\w+)?\s*(.*)$/is.exec(text);
  const cityArg = (m?.[1] ?? "").trim();
  if (!cityArg) {
    await ctx.reply("Usage: /weather <city>\nExample: /weather Tbilisi");
    return;
  }
  const result = await fetchCurrentWeather(cityArg, config.openWeatherApiKey);
  if (!result.ok) {
    await ctx.reply(result.error.message);
    return;
  }
  await replyTelegramMarkdownV2(
    ctx,
    formatWeatherMarkdownV2(result.data),
    formatWeatherPlain(result.data)
  );
});

bot.on("message:text", handleTextMessage);

bot.catch((err) => {
  console.error("Bot error:", err);
});

try {
  await bot.api.setMyCommands([
    { command: "weather", description: "Current weather for a city" },
  ]);
} catch (e: unknown) {
  console.error("setMyCommands failed:", e);
}

bot.start();
