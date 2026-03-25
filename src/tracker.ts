import { PRODUCTS, ProductTarget } from "./config";
import { logger } from "./logger";
import { scrapeAll, ScrapedPrice } from "./scraper";
import {
  savePrice,
  getLatestPrice,
  getPreviousPrice,
  getLowestPrice,
} from "./storage";
import {
  notifyPriceDrop,
  notifyPriceSummary,
  notifyError,
} from "./telegram";

export async function runPriceCheck(): Promise<void> {
  logger.info("=== Starting price check ===");

  const results = await scrapeAll(PRODUCTS);
  const summary: { platform: string; price: number; currency: string; url: string }[] = [];

  for (const target of PRODUCTS) {
    const scraped = results.get(target.platform);
    await processResult(target, scraped, summary);
  }

  if (summary.length > 0) {
    await notifyPriceSummary(summary);
  }

  logger.info("=== Price check complete ===");
}

async function processResult(
  target: ProductTarget,
  scraped: ScrapedPrice | null | undefined,
  summary: { platform: string; price: number; currency: string; url: string }[]
): Promise<void> {
  if (!scraped) {
    logger.warn(`${target.platform}: No price data`);
    await notifyError(target.platform, "Could not extract price from page");
    return;
  }

  if (!scraped.available) {
    logger.info(`${target.platform}: Product not available`);
    return;
  }

  const now = new Date().toISOString();

  savePrice({
    platform: target.platform,
    product_name: target.name,
    price: scraped.price,
    currency: scraped.currency,
    url: target.url,
    scraped_at: now,
  });

  summary.push({
    platform: target.platform,
    price: scraped.price,
    currency: scraped.currency,
    url: target.url,
  });

  const previousRecord = getPreviousPrice(target.platform);

  if (previousRecord && scraped.price < previousRecord.price) {
    const lowest = getLowestPrice(target.platform);
    await notifyPriceDrop(
      target.platform,
      scraped.price,
      previousRecord.price,
      scraped.currency,
      target.url,
      lowest?.price ?? null
    );
  }
}
