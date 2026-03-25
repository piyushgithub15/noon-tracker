import puppeteer, { Browser, Page } from "puppeteer";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import AdblockerPlugin from "puppeteer-extra-plugin-adblocker";
import puppeteerExtra from "puppeteer-extra";
import { ProductTarget, config } from "./config";
import { logger } from "./logger";

puppeteerExtra.use(StealthPlugin());
puppeteerExtra.use(AdblockerPlugin({ blockTrackers: true }));

export interface ScrapedPrice {
  price: number;
  currency: string;
  available: boolean;
  raw: string;
}

let browser: Browser | null = null;

export async function launchBrowser(): Promise<void> {
  if (browser) return;
  browser = await puppeteerExtra.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-blink-features=AutomationControlled",
      "--disable-features=IsolateOrigins,site-per-process",
      "--window-size=1440,900",
    ],
  });
  logger.info("Browser launched (stealth mode)");
}

export async function closeBrowser(): Promise<void> {
  if (browser) {
    await browser.close();
    browser = null;
    logger.info("Browser closed");
  }
}

function parsePriceText(raw: string): { price: number; currency: string } | null {
  const cleaned = raw.replace(/,/g, "").trim();

  // noon uses U+E001 (PUA icon font) as its AED currency symbol
  const noonIconMatch = cleaned.match(/[\uE001\uE000-\uF8FF]\s*([\d.]+)/);
  if (noonIconMatch) {
    const price = parseFloat(noonIconMatch[1]);
    if (price > 0) return { price, currency: "AED" };
  }

  const aedMatch = cleaned.match(/AED\s*([\d.]+)/) || cleaned.match(/([\d.]+)\s*AED/);
  if (aedMatch) {
    const price = parseFloat(aedMatch[1]);
    if (price > 0) return { price, currency: "AED" };
  }

  // Bare number (for element text that only contains a price)
  const numOnly = cleaned.match(/^([\d]+\.?\d*)$/);
  if (numOnly) {
    const price = parseFloat(numOnly[1]);
    if (price > 500 && price < 30_000) return { price, currency: "AED" };
  }

  return null;
}

async function dismissCookieBanner(page: Page): Promise<void> {
  try {
    const btn = await page.$('button::-p-text(ACCEPT ALL)');
    if (btn) {
      await btn.click();
      await new Promise((r) => setTimeout(r, 500));
    }
  } catch { /* no banner */ }
}

const PRICE_SELECTORS = [
  'span[data-qa="div-price-now"]',
  '[data-qa*="price"] span',
  '[class*="priceNow"]',
  '[class*="sellingPrice"]',
];

async function extractFromProductPage(page: Page, platform: string): Promise<ScrapedPrice | null> {
  // Strategy 1: CSS selectors
  for (const selector of PRICE_SELECTORS) {
    try {
      await page.waitForSelector(selector, { timeout: 5_000 });
      const texts = await page.$$eval(selector, (els) =>
        els.map((el) => el.textContent?.trim() ?? "").filter((t) => t.length > 0 && t.length < 30)
      );
      for (const text of texts) {
        const parsed = parsePriceText(text);
        if (parsed && parsed.price >= 3000 && parsed.price <= 15000) {
          logger.info(`[${platform}] Price via selector: AED ${parsed.price}`);
          return { ...parsed, available: true, raw: text };
        }
      }
    } catch { /* selector not found */ }
  }

  // Strategy 2: JSON-LD
  try {
    const jsonLd = await page.evaluate(() => {
      const scripts = document.querySelectorAll('script[type="application/ld+json"]');
      for (const script of scripts) {
        try {
          const data = JSON.parse(script.textContent ?? "");
          if (data["@type"] === "Product" && data.offers) {
            const offer = Array.isArray(data.offers) ? data.offers[0] : data.offers;
            return { price: parseFloat(offer.price), currency: offer.priceCurrency ?? "AED" };
          }
        } catch { /* ignore */ }
      }
      return null;
    });
    if (jsonLd && jsonLd.price > 0) {
      logger.info(`[${platform}] Price via JSON-LD: ${jsonLd.currency} ${jsonLd.price}`);
      return { price: jsonLd.price, currency: jsonLd.currency, available: true, raw: `${jsonLd.currency} ${jsonLd.price}` };
    }
  } catch { /* no JSON-LD */ }

  // Strategy 3: body text
  return extractPriceFromBodyText(page, platform);
}

/**
 * On search pages, scan visible text for product name + price pairs.
 * Only return a price if the product name matches our target keywords.
 */
async function extractFromSearchPage(page: Page, platform: string): Promise<ScrapedPrice | null> {
  const result = await page.evaluate(() => {
    const body = document.body.innerText;
    const lines = body.split("\n").map((l) => l.trim()).filter((l) => l);

    const mustContain = ["iphone 17 pro", "256", "deep blue", "esim only"];
    const mustNotContain = ["pro max", "nano sim"];

    for (let i = 0; i < lines.length; i++) {
      const lower = lines[i].toLowerCase();
      const isMatch =
        mustContain.every((kw) => lower.includes(kw)) &&
        !mustNotContain.some((kw) => lower.includes(kw));

      if (!isMatch) continue;

      // Found matching product name — search next few lines for a price
      for (let j = i; j < Math.min(i + 8, lines.length); j++) {
        const priceMatch = lines[j].match(/([\d,]+\.?\d{2})/);
        if (priceMatch) {
          const price = parseFloat(priceMatch[1].replace(/,/g, ""));
          if (price >= 3000 && price <= 15000) {
            return { name: lines[i], price, raw: priceMatch[0] };
          }
        }
      }
    }
    return null;
  });

  if (result) {
    logger.info(`[${platform}] Matched product: "${result.name}" → AED ${result.price}`);
    return { price: result.price, currency: "AED", available: true, raw: `AED ${result.price}` };
  }

  logger.warn(`[${platform}] No matching product found in search results`);
  return null;
}

async function extractPriceFromBodyText(page: Page, platform: string): Promise<ScrapedPrice | null> {
  try {
    const result = await page.evaluate(() => {
      const body = document.body.innerText;
      const prices: number[] = [];
      for (const m of body.matchAll(/\uE001\s*([\d,]+\.?\d*)/g)) {
        const p = parseFloat(m[1].replace(/,/g, ""));
        if (p >= 3000 && p <= 15000) prices.push(p);
      }
      for (const m of body.matchAll(/AED\s*([\d,]+\.?\d*)/g)) {
        const p = parseFloat(m[1].replace(/,/g, ""));
        if (p >= 3000 && p <= 15000) prices.push(p);
      }
      return prices.length > 0 ? Math.min(...prices) : null;
    });

    if (result) {
      logger.info(`[${platform}] Price via body text: AED ${result}`);
      return { price: result, currency: "AED", available: true, raw: `AED ${result}` };
    }
  } catch { /* scan failed */ }
  return null;
}

async function navigateWithRetry(page: Page, url: string, retries = 3): Promise<boolean> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      logger.info(`[nav] Attempt ${attempt}/${retries}: ${url}`);
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: config.navigationTimeout });
      return true;
    } catch (err) {
      logger.warn(`[nav] Attempt ${attempt} failed: ${String(err).slice(0, 120)}`);
      if (attempt < retries) {
        const delay = attempt * 5_000;
        logger.info(`[nav] Retrying in ${delay / 1000}s...`);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  return false;
}

export async function scrapePrice(target: ProductTarget): Promise<ScrapedPrice | null> {
  if (!browser) await launchBrowser();
  const page = await browser!.newPage();

  try {
    await page.setUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    );
    await page.setViewport({ width: 1440, height: 900 });
    await page.setExtraHTTPHeaders({
      "Accept-Language": "en-US,en;q=0.9,ar;q=0.8",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    });

    logger.info(`Scraping ${target.platform}: ${target.url}`);

    const ok = await navigateWithRetry(page, target.url);
    if (!ok) {
      logger.error(`${target.platform}: All navigation attempts failed`);
      return null;
    }

    await new Promise((r) => setTimeout(r, 5_000));
    await dismissCookieBanner(page);

    // Scroll down on search pages to load more products
    if (target.isSearchPage) {
      for (let i = 0; i < 3; i++) {
        await page.evaluate(() => window.scrollBy(0, 800));
        await new Promise((r) => setTimeout(r, 1_000));
      }
    }

    const pageText = await page.evaluate(() => document.body?.innerText?.toLowerCase() ?? "");
    if (pageText.includes("this product is not available") || pageText.includes("currently unavailable")) {
      logger.warn(`${target.platform}: Product not available`);
      return { price: 0, currency: "AED", available: false, raw: "Not available" };
    }

    const result = target.isSearchPage
      ? await extractFromSearchPage(page, target.platform)
      : await extractFromProductPage(page, target.platform);

    if (!result) {
      logger.warn(`${target.platform}: Could not extract price`);
      try {
        await page.screenshot({ path: `data/debug-${target.platform}-${Date.now()}.png`, fullPage: false });
        logger.info(`Debug screenshot saved for ${target.platform}`);
      } catch { /* screenshot failed */ }
    }

    return result;
  } catch (err) {
    logger.error(`${target.platform}: Scrape failed – ${err}`);
    return null;
  } finally {
    await page.close();
  }
}

export async function scrapeAll(targets: ProductTarget[]): Promise<Map<string, ScrapedPrice | null>> {
  const results = new Map<string, ScrapedPrice | null>();
  await launchBrowser();

  for (const target of targets) {
    const price = await scrapePrice(target);
    results.set(target.platform, price);
    await new Promise((r) => setTimeout(r, 3_000 + Math.random() * 2_000));
  }

  await closeBrowser();
  return results;
}
