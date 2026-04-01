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
  thinkingTokens: (process.env.THINKING_TOKENS ?? process.env.Thinking_Tokens ?? "false").trim().toLowerCase() === "true",
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

bot.on("message:text", handleTextMessage);

bot.catch((err) => {
  console.error("Bot error:", err);
});

bot.start();
