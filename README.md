## Groq-Telegram

A template for chatting with [Groq](https://groq.com) models in Telegram using TypeScript and [Bun](https://bun.sh).

Features:

- Chat with any Groq model by sending plain text to the bot. Each chat keeps its own conversation history.
- Replies are rendered as Telegram MarkdownV2 and fall back to plain text if Telegram rejects the formatting.
- Optional display of model reasoning ("thinking") as a blockquote.
- `/weather <city>` slash command backed by the OpenWeather API.

## Prerequisites

- [Bun](https://bun.sh) (the commands below use bun; npm, yarn or pnpm can be adapted).
- A Telegram bot token from [BotFather](https://t.me/botfather).
- A Groq API key from the [developer console](https://console.groq.com/keys).
- An OpenWeather API key from [OpenWeather](https://openweathermap.org/api). This is only needed for `/weather`.

## Setup

```sh
bun install
cp .env-example .env
# then fill in the values in .env
```

Bun loads `.env` automatically.

## Configuration

| Variable | Required | Default | Description |
|---|---|---|---|
| `TELEGRAM_BOT_TOKEN` | yes | — | Bot token from BotFather. The bot exits on startup if it's missing. |
| `GROQ_API_KEY` | yes | — | Groq API key. |
| `GROQ_MODEL` | no | `llama-3.1-8b-instant` | Groq model ID. See [supported models](https://console.groq.com/docs/models). If you leave it empty in `.env`, the Groq request fails, so remove the line or set a model. |
| `SYSTEM_PROMPT` | no | `You are a helpful assistant.` | System prompt sent with every request. |
| `CONTEXT_LIMIT` | no | `5` | How many earlier messages (user and assistant) to send as context. Use `0` for none and `all` for the full history. A value that isn't a number is treated as `all`. |
| `DEBUG_MODE` | no | `false` | `true` logs each message, the response and the timing to the console, plus OpenWeather request details. |
| `THINKING_TOKENS` | no | `false` | `true` shows the model's reasoning (from `reasoning` or `<think>…</think>`) as a blockquote above the answer and keeps it in history. `false` strips it. `Thinking_Tokens` is also accepted. |
| `OPENWEATHER_API_KEY` | for `/weather` | — | OpenWeather API key. Without it, `/weather` replies with a setup error. |

Conversation history is stored in memory per chat and is lost when the bot restarts.

## Usage

- Send any text message to chat with the configured Groq model.
- `/weather <city>`: current conditions (°C and °F), humidity and wind (when available). Example: `/weather Tbilisi`
- `/weather` with no city shows usage.

The bot registers `/weather` in the Telegram command menu on startup.

`/weather` errors: unknown city (`No results for "…"`), missing key (`Set OPENWEATHER_API_KEY…`), or upstream/network failures.

## Scripts

| Command | Description |
|---|---|
| `bun run dev` | Start the bot in watch mode (restarts on file changes). |
| `bun run start` | Start the bot. |
| `bun run type-check` | Type-check the project with `tsc --noEmit`. |
| `bun run lint` | Alias for `type-check`. |

## Dev / Testing

_Note: Set up your bot through BotFather and start a chat with it first._

```sh
bun run dev
```

Send normal text for Groq chat, or use `/weather Paris` for weather. Set `DEBUG_MODE=true` to print input and output to the console.

## Deploy

```sh
bun run start
```

### Docker

`docker-compose.yml` runs the bot in the `oven/bun` image. It mounts the project directory into the container and reads `.env`. Because the project directory is mounted as-is, run `bun install` on the host first so `node_modules` exists.

```sh
bun install
docker compose up -d
```

## Project structure

- `index.ts`: bot setup, Groq chat handling, message formatting and the `/weather` command.
- `types.ts`: shared types (config, messages, OpenWeather response and result types).

## Roadmap

TBD

## License

MIT
