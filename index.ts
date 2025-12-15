import { Bot, Context } from "grammy";
import Groq from "groq-sdk";

type Message = { role: "user" | "assistant"; content: string };
type ChatMessage = { role: "system" | "user" | "assistant"; content: string };
type History = Map<number, Message[]>;

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

const bot = new Bot(
  process.env.TELEGRAM_BOT_TOKEN ?? "",
);

const SYSTEM_PROMPT = process.env.SYSTEM_PROMPT ?? "You are a helpful assistant.";
const CONTEXT_LIMIT = process.env.CONTEXT_LIMIT ?? "5";
const MODEL = process.env.GROQ_MODEL ?? "llama-3.1-8b-instant";
const DEBUG_MODE = process.env.DEBUG_MODE ?? "false";

const conversationHistory: History = new Map();

const debugLog = (...args: unknown[]): void => {
  if (DEBUG_MODE) {
    console.log(...args);
  }
};

const parseContextLimit = (limit: string): number | null => {
  if (limit === "all") return null;
  const parsed = parseInt(limit, 10);
  return isNaN(parsed) ? null : parsed;
};

const limitHistory = (history: Message[], limit: number | null): Message[] => {
  if (limit === null) return history;
  if (limit === 0) return [];
  return history.slice(-limit);
};

const buildMessages = (
  history: Message[],
  currentMessage: string,
  limit: number | null
): ChatMessage[] => [
  { role: "system", content: SYSTEM_PROMPT },
  ...limitHistory(history, limit),
  { role: "user", content: currentMessage },
];

const getHistory = (history: History, chatId: number): Message[] =>
  history.get(chatId) ?? [];

const addToHistory = (
  history: History,
  chatId: number,
  userMessage: string,
  assistantMessage: string ): History => {
  const current = getHistory(history, chatId);
  const updated = new Map(history);
  updated.set(chatId, [
    ...current,
    { role: "user", content: userMessage },
    { role: "assistant", content: assistantMessage },
  ]);
  return updated;
};

const createCompletion = async (messages: ChatMessage[]): Promise<string | undefined> => {
  try {
    const completion = await groq.chat.completions.create({
      messages,
      model: MODEL,
    });
    return completion.choices[0]?.message.content ?? undefined;
  } catch (error) {
    console.error(error);
    return undefined;
  }
};

const processMessage = async (
  history: History,
  chatId: number,
  query: string
): Promise<{ response: string | undefined; updatedHistory: History }> => {
  const contextLimit = parseContextLimit(CONTEXT_LIMIT);
  const chatHistory = getHistory(history, chatId);
  const messages = buildMessages(chatHistory, query, contextLimit);
  const response = await createCompletion(messages);

  const updatedHistory = response
    ? addToHistory(history, chatId, query, response)
    : history;

  return { response, updatedHistory };
};

bot.on("message:text", async (ctx: Context) => {
  const text = ctx.message?.text;
  const chatId = ctx.chat?.id;
  
  if (!text || !chatId) return;

  const { response, updatedHistory } = await processMessage(
    conversationHistory,
    chatId,
    text
  );

  updatedHistory.forEach((value, key) => conversationHistory.set(key, value));

  debugLog("Message from: ", ctx.from?.username);
  debugLog("Message: ", text);

  if (response) {
    ctx.reply(response);
  }
});

bot.start();

