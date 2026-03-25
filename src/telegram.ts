import { Telegraf } from "telegraf";
import { config } from "./config";
import { logger } from "./logger";
import { PriceRecord } from "./storage";

let bot: Telegraf | null = null;

export function initTelegram(): void {
  bot = new Telegraf(config.telegram.botToken);
  logger.info("Telegram bot initialized");
}

async function send(message: string): Promise<void> {
  if (!bot) {
    logger.error("Telegram bot not initialized");
    return;
  }
  try {
    await bot.telegram.sendMessage(config.telegram.chatId, message, {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    });
    logger.info("Telegram message sent");
  } catch (err) {
    logger.error(`Failed to send Telegram message: ${err}`);
  }
}

export async function notifyPriceDrop(
  platform: string,
  currentPrice: number,
  previousPrice: number,
  currency: string,
  url: string,
  lowestEver: number | null
): Promise<void> {
  const drop = previousPrice - currentPrice;
  const pct = ((drop / previousPrice) * 100).toFixed(1);

  let msg = `🔔 <b>PRICE DROP on ${platform.toUpperCase()}</b>\n\n`;
  msg += `📱 iPhone 17 Pro 256GB Deep Blue (eSIM)\n\n`;
  msg += `💰 <b>${currency} ${currentPrice.toLocaleString()}</b>  `;
  msg += `<s>${currency} ${previousPrice.toLocaleString()}</s>\n`;
  msg += `📉 Down <b>${currency} ${drop.toLocaleString()}</b> (${pct}%)\n`;

  if (lowestEver !== null) {
    if (currentPrice <= lowestEver) {
      msg += `\n🏆 <b>ALL-TIME LOW PRICE!</b>\n`;
    } else {
      msg += `\n📊 All-time low: ${currency} ${lowestEver.toLocaleString()}\n`;
    }
  }

  msg += `\n🔗 <a href="${url}">View Product</a>`;

  await send(msg);
}

export async function notifyPriceSummary(
  records: { platform: string; price: number; currency: string; url: string }[]
): Promise<void> {
  let msg = `📊 <b>Price Check Summary</b>\n`;
  msg += `📱 iPhone 17 Pro 256GB Deep Blue (eSIM)\n\n`;

  for (const r of records) {
    const emoji =
      r.platform === "noon" ? "🟡" : r.platform === "supermall" ? "🟢" : "⚡";
    msg += `${emoji} <b>${r.platform}</b>: ${r.currency} ${r.price.toLocaleString()}\n`;
    msg += `   → <a href="${r.url}">View</a>\n\n`;
  }

  if (records.length > 0) {
    const best = records.reduce((a, b) => (a.price < b.price ? a : b));
    msg += `✅ Best price: <b>${best.currency} ${best.price.toLocaleString()}</b> on ${best.platform}`;
  }

  await send(msg);
}

export async function notifyError(platform: string, error: string): Promise<void> {
  const msg =
    `⚠️ <b>Scrape Error</b>\n\n` +
    `Platform: ${platform}\n` +
    `Error: ${error}\n\n` +
    `The tracker will retry on the next scheduled run.`;
  await send(msg);
}

export async function notifyStartup(): Promise<void> {
  await send(
    `✅ <b>Noon Price Tracker started</b>\n\n` +
      `Tracking iPhone 17 Pro 256GB Deep Blue (eSIM) across:\n` +
      `• noon.com\n` +
      `• noon Supermall\n` +
      `• noon Minutes\n\n` +
      `Schedule: ${config.cron}`
  );
}
