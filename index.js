import { Bot } from "grammy";
import Groq from "groq-sdk";

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

const bot = new Bot(
  process.env.TELEGRAM_BOT_TOKEN,
);

async function getGroqResponse(query) {
  try {
    const completion = await groq.chat.completions.create({
      messages: [
        {
          role: "user",
          content: query,
        },
      ],
      model: process.env.GROQ_MODEL,
    });

    return completion.choices[0].message.content;
  } catch (error) {
    console.error(error);
  }
}

bot.on("message:text", async (ctx) => {
  const response = await getGroqResponse(ctx.message.text);

  console.log('Message from: ', ctx.from.username)
  console.log('Message: ', ctx.message.text)

  ctx.reply(response);
});

bot.start();
