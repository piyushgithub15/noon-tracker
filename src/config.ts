import "dotenv/config";
import path from "path";

export interface ProductTarget {
  name: string;
  platform: "noon" | "supermall" | "minutes";
  url: string;
  /** CSS selectors to try for price extraction, in priority order */
  priceSelectors: string[];
  /** If true, this is a search/listing page and we extract from the first matching result */
  isSearchPage?: boolean;
}

export const PRODUCTS: ProductTarget[] = [
  {
    name: "iPhone 17 Pro 256GB Deep Blue (eSIM) Intl - noon",
    platform: "noon",
    url: "https://www.noon.com/uae-en/iphone-17-pro-256-gb-deep-blue-5g-esim-only-with-facetime-international-version/N70211682V/p/",
    priceSelectors: [
      'span[data-qa="div-price-now"]',
      '[data-qa*="price"] span',
      '[class*="priceNow"]',
      '[class*="sellingPrice"]',
      '[class*="price"] span',
    ],
  },
  {
    name: "iPhone 17 Pro 256GB Deep Blue (eSIM) Intl - Supermall",
    platform: "supermall",
    url: "https://www.noon.com/uae-en/search/?q=iphone+17+pro+256gb+deep+blue+international+esim&f[fulfilled_by]=supermall",
    priceSelectors: [
      '[class*="price"]',
      '[data-qa*="price"]',
    ],
    isSearchPage: true,
  },
  {
    name: "iPhone 17 Pro 256GB Deep Blue (eSIM) Intl - Minutes",
    platform: "minutes",
    url: "https://minutes.noon.com/uae-en/search/?q=iphone+17+pro+256gb+deep+blue",
    priceSelectors: [
      '[class*="price"]',
      '[class*="Price"]',
      '[data-qa*="price"]',
    ],
    isSearchPage: true,
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
  port: parseInt(process.env.PORT ?? "3000", 10),
  navigationTimeout: 60_000,
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
