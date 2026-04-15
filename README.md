## Groq-Telegram

A template for chatting with Groq models in Telegram using TypeScript

## Prerequisites

- Groq API key via the [developer panel](https://console.groq.com/keys).
- OpenWeather API key from [OpenWeather](https://openweathermap.org/api) (for `/weather`).
- Create a bot with [BotFather](https://t.me/botfather).

Set `OPENWEATHER_API_KEY` in `.env` (see `.env-example`). Without it, `/weather` replies with a setup error.

## Slash commands

- `/weather <city>` — current conditions (°C and °F), humidity, optional wind. Example: `/weather Tbilisi`
- `/weather` with no city shows usage.

Errors: unknown city (`No results for "…"`), missing key (`Set OPENWEATHER_API_KEY…`), or upstream/network failures.

## Roadmap
TBD

## Prerequisites

This project is primarily designed to be used with [bun](https://bun.sh). The commands shown use bun, but you can adapt them for npm, yarn, or pnpm if preferred. Be sure to have bun installed before proceeding.


## Dev / Testing

_Note: Make sure to setup your bot via BotFather and start a chat with it_

Start the bot script:
`bun run dev`

Send normal text for Groq chat, or use `/weather Paris` for weather.

I/O should be printed in the console so you can see.

## Deploy
`bun run start`