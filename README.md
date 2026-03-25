# Noon Price Tracker

Tracks the price of **iPhone 17 Pro 256GB Deep Blue (eSIM) International Version** across three noon platforms and sends Telegram alerts when the price drops.

**Platforms monitored:**
- [noon.com](https://www.noon.com) — Main marketplace
- [noon Supermall](https://supermall.noon.com) — Premium fast-delivery store
- [noon Minutes](https://minutes.noon.com) — 15-minute delivery

## Quick Start

### 1. Create a Telegram Bot

1. Open Telegram and message [@BotFather](https://t.me/BotFather)
2. Send `/newbot` and follow the prompts to create a bot
3. Copy the **bot token** (looks like `123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11`)
4. Start a conversation with your new bot (send it any message)
5. Visit `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates` in your browser
6. Find your `chat_id` in the JSON response under `result[0].message.chat.id`

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` and fill in your Telegram credentials:

```
TELEGRAM_BOT_TOKEN=your_bot_token_here
TELEGRAM_CHAT_ID=your_chat_id_here
CRON_SCHEDULE=0 */2 * * *
CHECK_ON_STARTUP=true
```

### 3. Run Locally

```bash
npm install
npx playwright install chromium
npm run build
npm start
```

Or in dev mode:

```bash
npm run dev
```

### 4. Run with Docker (recommended for deployment)

```bash
docker compose up -d
```

View logs:

```bash
docker compose logs -f tracker
```

## How It Works

1. Every 2 hours (configurable), the tracker launches a headless Chromium browser
2. It visits each product page and extracts the current price using multiple strategies (CSS selectors, JSON-LD, regex fallback)
3. Prices are stored in a local SQLite database (`data/prices.db`)
4. If the price is lower than the previous check, a Telegram notification is sent
5. A summary of all prices is sent after each check

## Configuration

| Variable | Default | Description |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | — | Required. Your Telegram bot token |
| `TELEGRAM_CHAT_ID` | — | Required. Your Telegram chat ID |
| `CRON_SCHEDULE` | `0 */2 * * *` | Cron expression for check frequency |
| `CHECK_ON_STARTUP` | `true` | Run a check immediately on startup |
| `DB_PATH` | `./data/prices.db` | Path to SQLite database |

### Customizing Product URLs

Edit `src/config.ts` → `PRODUCTS` array to change tracked URLs or add new products.

## Deployment Options

### VPS / Cloud VM

1. Clone the repo onto your server
2. Install Docker and Docker Compose
3. Create `.env` with your Telegram credentials
4. Run `docker compose up -d`

### Railway / Render / Fly.io

1. Push to a Git repo
2. Connect the repo to your platform
3. Set environment variables (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`)
4. Deploy — the Dockerfile handles the rest

## Debugging

If prices aren't being extracted, check `data/` for debug screenshots (`debug-*.png`) that show what the scraper sees.

Logs are in `data/tracker.log` and stdout.
