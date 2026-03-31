import { Bot, Context } from "grammy";
import Groq from "groq-sdk";
import telegramifyMarkdown from "telegramify-markdown";
import type {
  ChatCompletion,
  Message,
  ChatMessage,
  MessageRole,
  ContextLimitValue,
  History,
  ProcessMessageResult,
  Config,
} from "./types";

const envThinkingTokens = (): string | undefined =>
  process.env.THINKING_TOKENS ?? process.env.Thinking_Tokens;

const getConfig = (): Config => ({
  systemPrompt: process.env.SYSTEM_PROMPT ?? "You are a helpful assistant.",
  contextLimit: process.env.CONTEXT_LIMIT ?? "5",
  model: process.env.GROQ_MODEL ?? "llama-3.1-8b-instant",
  debugMode: process.env.DEBUG_MODE ?? "false",
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN ?? "",
  groqApiKey: process.env.GROQ_API_KEY,
  thinkingTokens: envThinkingTokens() ?? "disabled",
});

const config = getConfig();

if (!config.telegramBotToken) {
  console.error("TELEGRAM_BOT_TOKEN is required.");
  process.exit(1);
}

const groq = new Groq({
  apiKey: config.groqApiKey,
});

const bot = new Bot(
  config.telegramBotToken
);

const conversationHistory: Map<number, Message[]> = new Map();

const parseContextLimit = (limit: string): ContextLimitValue => {
  if (limit === "all") return null;
  const parsed = parseInt(limit, 10);
  return isNaN(parsed) ? null : parsed;
};

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

const getHistory = (history: History, chatId: number): readonly Message[] =>
  history.get(chatId) ?? [];

const createMessage = (role: MessageRole, content: string): Message => ({
  role,
  content,
});

const addToHistory = (
  history: History,
  chatId: number,
  userMessage: string,
  assistantMessage: string
): History => {
  const current = getHistory(history, chatId);
  const updated = new Map(history);
  updated.set(chatId, [
    ...current,
    createMessage("user", userMessage),
    createMessage("assistant", assistantMessage),
  ]);
  return updated;
};

/** Groq reasoning models may return `reasoning` and/or `think`…`</think>` inside `content` (see Groq reasoning docs). */
type AssistantMessage = ChatCompletion["choices"][number]["message"] & {
  reasoning?: string | null;
};

/** `enabled` / `true` / … → show reasoning + raw `content`; otherwise strip `think` blocks and omit `reasoning`. */
const shouldShowThinkingTokens = (raw: string): boolean => {
  const v = raw.trim().toLowerCase().replace(/^["']|["']$/g, "");
  return v === "enabled" || v === "true" || v === "yes" || v === "1" || v === "on";
};

/** Qwen / Groq raw format uses `think`…`</think>` in `content`. */
const stripThinkingTags = (text: string): string =>
  text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();

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

const extractAssistantText = (
  completion: ChatCompletion,
  stripThinking: boolean
): string | undefined => {
  const msg = completion.choices[0]?.message as AssistantMessage | undefined;
  if (!msg) return undefined;

  const content = msg.content ?? "";
  const reasoning = typeof msg.reasoning === "string" ? msg.reasoning : "";

  if (stripThinking) {
    const out = stripThinkingTags(content);
    return out.length > 0 ? out : undefined;
  }

  const parts: string[] = [];
  if (reasoning.trim().length > 0) parts.push(reasoning.trim());
  if (content.trim().length > 0) parts.push(content.trim());
  const merged = parts.join("\n\n");
  return merged.length > 0 ? merged : undefined;
};

const formatTelegramBody = (
  completion: ChatCompletion,
  stripThinking: boolean
): string | undefined => {
  if (stripThinking) {
    const raw = extractAssistantText(completion, true);
    return raw ? telegramifyMarkdown(raw, "escape") : undefined;
  }

  const msg = completion.choices[0]?.message as AssistantMessage | undefined;
  if (!msg) return undefined;

  const content = msg.content ?? "";
  const reasoning = typeof msg.reasoning === "string" ? msg.reasoning : "";

  const parts: string[] = [];
  const thinkBlocks = collectThinkInnerBlocks(content);
  const contentWithoutThink = content.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();

  const thinkingParts: string[] = [];
  if (reasoning.trim().length > 0) thinkingParts.push(reasoning.trim());
  if (thinkBlocks.length > 0) thinkingParts.push(thinkBlocks.join("\n\n"));

  if (thinkingParts.length > 0) {
    parts.push(
      formatMarkdownV2Blockquote(thinkingParts.join("\n\n"))
    );
  }

  if (contentWithoutThink.length > 0) {
    parts.push(telegramifyMarkdown(contentWithoutThink, "escape"));
  }

  const merged = parts.filter(Boolean).join("\n\n");
  return merged.length > 0 ? merged : undefined;
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
    const stripThinking = !shouldShowThinkingTokens(config.thinkingTokens);
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
  history: History,
  chatId: number,
  query: string,
  config: Config
): Promise<ProcessMessageResult> => {
  const contextLimit = parseContextLimit(config.contextLimit);
  const chatHistory = getHistory(history, chatId);
  const messages = buildMessages(chatHistory, query, contextLimit, config.systemPrompt);
  const reply = await createCompletion(messages, config.model);

  const updatedHistory = reply
    ? addToHistory(history, chatId, query, reply.historyText)
    : history;

  return {
    response: reply?.historyText,
    telegramBody: reply?.telegramBody,
    updatedHistory,
  };
};

const updateHistory = (target: Map<number, Message[]>, source: History): void => {
  source.forEach((value, key) => target.set(key, [...value]));
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

  const { response, telegramBody, updatedHistory } = await processMessage(
    conversationHistory,
    chatId,
    text,
    config
  );

  updateHistory(conversationHistory, updatedHistory);

  if (config.debugMode === "true") {
    logDebug(ctx.from?.username, text, response);
  }

  if (telegramBody && response) {
    await replyTelegramMarkdownV2(ctx, telegramBody, response);
  }
};

bot.on("message:text", handleTextMessage);

bot.catch((err) => {
  console.error("Bot error:", err);
});

bot.start();