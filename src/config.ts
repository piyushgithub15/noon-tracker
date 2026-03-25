import "dotenv/config";
import path from "path";

export interface ProductTarget {
  name: string;
  platform: "noon" | "supermall" | "minutes";
  url: string;
  /** CSS selectors to try for price extraction, in priority order */
  priceSelectors: string[];
}

export const PRODUCTS: ProductTarget[] = [
  {
    name: "iPhone 17 Pro 256GB Deep Blue (eSIM) - noon",
    platform: "noon",
    url: "https://www.noon.com/uae-en/iphone-17-pro-256-gb-deep-blue-5g-esim-only-with-facetime-international-version/N70211534V/p/",
    priceSelectors: [
      'span[data-qa="div-price-now"]',
      ".priceNow",
      '[class*="price"] span',
      '[data-qa*="price"]',
    ],
  },
  {
    name: "iPhone 17 Pro 256GB Deep Blue (eSIM) - Supermall",
    platform: "supermall",
    url: "https://supermall.noon.com/uae-en/iphone-17-pro-256-gb-deep-blue-5g-esim-only-with-facetime-international-version/N70211534V/p/",
    priceSelectors: [
      'span[data-qa="div-price-now"]',
      ".priceNow",
      '[class*="price"] span',
      '[data-qa*="price"]',
    ],
  },
  {
    name: "iPhone 17 Pro 256GB Deep Blue (eSIM) - Minutes",
    platform: "minutes",
    url: "https://minutes.noon.com/uae-en/iphone-17-pro-256-gb-deep-blue-5g-esim-only-with-facetime-international-version/N70211534V/p/",
    priceSelectors: [
      'span[data-qa="div-price-now"]',
      ".priceNow",
      '[class*="price"] span',
      '[data-qa*="price"]',
    ],
  },
];

export const config = {
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN ?? "",
    chatId: process.env.TELEGRAM_CHAT_ID ?? "",
  },
  cron: process.env.CRON_SCHEDULE ?? "*/5 * * * *",
  checkOnStartup: process.env.CHECK_ON_STARTUP === "true",
  dbPath: path.resolve(process.env.DB_PATH ?? "./data/prices.db"),
  /** Max browser navigation timeout in ms */
  navigationTimeout: 60_000,
  /** Max time to wait for price element to appear */
  priceWaitTimeout: 30_000,
};

export function validateConfig(): void {
  if (!config.telegram.botToken) {
    throw new Error("TELEGRAM_BOT_TOKEN is required – see .env.example");
  }
  if (!config.telegram.chatId) {
    throw new Error("TELEGRAM_CHAT_ID is required – see .env.example");
  }
}
