import { Bot, Context } from "grammy";
import Groq from "groq-sdk";

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

const bot = new Bot(
  process.env.TELEGRAM_BOT_TOKEN ?? "",
);

const SYSTEM_PROMPT = process.env.SYSTEM_PROMPT ?? "You are a helpful assistant.";

async function getGroqResponse(query: string): Promise<string | undefined> {
  try {
    const completion = await groq.chat.completions.create({
      messages: [
        {
          role: "system",
          content: SYSTEM_PROMPT,
        },
        {
          role: "user",
          content: query,
        },
      ],
      model: process.env.GROQ_MODEL ?? "llama-3.1-8b-instant",
    });

    return completion.choices[0]?.message.content ?? undefined;
  } catch (error) {
    console.error(error);
    return undefined;
  }
}

bot.on("message:text", async (ctx: Context) => {
  const text = ctx.message?.text;
  if (!text) return;

  const response = await getGroqResponse(text);

  console.log('Message from: ', ctx.from?.username);
  console.log('Message: ', text);

  if (response) {
    ctx.reply(response);
  }
});

bot.start();

