import { Bot, Context } from "grammy";
import Groq from "groq-sdk";
import type {
  Message,
  ChatMessage,
  MessageRole,
  ContextLimitValue,
  History,
  ProcessMessageResult,
  Config,
} from "./types";

const getConfig = (): Config => ({
  systemPrompt: process.env.SYSTEM_PROMPT ?? "You are a helpful assistant.",
  contextLimit: process.env.CONTEXT_LIMIT ?? "5",
  model: process.env.GROQ_MODEL ?? "llama-3.1-8b-instant",
  debugMode: process.env.DEBUG_MODE ?? "false",
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN ?? "",
  groqApiKey: process.env.GROQ_API_KEY,
});

const config = getConfig();

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

const extractResponse = (completion: { choices?: Array<{ message?: { content?: string | null } }> }): string | undefined =>
  completion.choices?.[0]?.message?.content ?? undefined;

const createCompletion = async (
  messages: readonly ChatMessage[],
  model: string
): Promise<string | undefined> => {
  try {
    const completion = await groq.chat.completions.create({
      messages: [...messages],
      model,
      stream: false,
    });
    
    if ('choices' in completion) {
      return extractResponse(completion);
    }
    
    return undefined;
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
  const response = await createCompletion(messages, config.model);

  const updatedHistory = response
    ? addToHistory(history, chatId, query, response)
    : history;

  return { response, updatedHistory };
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

  const { response, updatedHistory } = await processMessage(
    conversationHistory,
    chatId,
    text,
    config
  );

  updateHistory(conversationHistory, updatedHistory);

  if (((mode: string) => mode === "true")(config.debugMode)) {
    logDebug(ctx.from?.username, text, response);
  }

  if (response) {
    await ctx.reply(response);
  }
};

bot.on("message:text", handleTextMessage);

bot.start();