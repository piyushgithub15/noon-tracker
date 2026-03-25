import { chromium, Browser, Page } from "playwright";
import { ProductTarget, config } from "./config";
import { logger } from "./logger";

export interface ScrapedPrice {
  price: number;
  currency: string;
  available: boolean;
  raw: string;
}

let browser: Browser | null = null;

export async function launchBrowser(): Promise<void> {
  if (browser) return;
  browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });
  logger.info("Browser launched");
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

  // Try pattern: "AED 4,299" or "4,299 AED"
  const match =
    cleaned.match(/([A-Z]{3})\s*([\d.]+)/) ||
    cleaned.match(/([\d.]+)\s*([A-Z]{3})/);

  if (match) {
    const groups = match.slice(1);
    const numStr = groups.find((g) => /^\d/.test(g));
    const curStr = groups.find((g) => /^[A-Z]/.test(g));
    if (numStr) {
      return {
        price: parseFloat(numStr),
        currency: curStr ?? "AED",
      };
    }
  }

  // Fallback: just grab any number
  const numOnly = cleaned.match(/([\d,]+\.?\d*)/);
  if (numOnly) {
    return {
      price: parseFloat(numOnly[1].replace(/,/g, "")),
      currency: "AED",
    };
  }

  return null;
}

async function extractPriceFromPage(page: Page, target: ProductTarget): Promise<ScrapedPrice | null> {
  // Strategy 1: Try each CSS selector
  for (const selector of target.priceSelectors) {
    try {
      const el = await page.waitForSelector(selector, { timeout: 5_000 });
      if (el) {
        const text = await el.textContent();
        if (text) {
          const parsed = parsePriceText(text);
          if (parsed && parsed.price > 0) {
            logger.info(`Found price via selector "${selector}": ${text}`);
            return { ...parsed, available: true, raw: text.trim() };
          }
        }
      }
    } catch {
      // Selector not found, try next
    }
  }

  // Strategy 2: Look for JSON-LD structured data
  try {
    const jsonLd = await page.evaluate(() => {
      const scripts = document.querySelectorAll('script[type="application/ld+json"]');
      for (const script of scripts) {
        try {
          const data = JSON.parse(script.textContent ?? "");
          if (data["@type"] === "Product" && data.offers) {
            const offer = Array.isArray(data.offers) ? data.offers[0] : data.offers;
            return {
              price: parseFloat(offer.price),
              currency: offer.priceCurrency ?? "AED",
            };
          }
        } catch {
          // ignore parse errors
        }
      }
      return null;
    });

    if (jsonLd && jsonLd.price > 0) {
      logger.info(`Found price via JSON-LD: ${jsonLd.currency} ${jsonLd.price}`);
      return {
        price: jsonLd.price,
        currency: jsonLd.currency,
        available: true,
        raw: `${jsonLd.currency} ${jsonLd.price}`,
      };
    }
  } catch {
    // no JSON-LD
  }

  // Strategy 3: Search page content with regex
  try {
    const priceFromContent = await page.evaluate(() => {
      const body = document.body.innerText;
      const patterns = [
        /AED\s*([\d,]+\.?\d*)/g,
        /([\d,]+\.?\d*)\s*AED/g,
      ];
      const prices: number[] = [];
      for (const pattern of patterns) {
        let m;
        while ((m = pattern.exec(body)) !== null) {
          const p = parseFloat(m[1].replace(/,/g, ""));
          if (p > 1000 && p < 20000) prices.push(p);
        }
      }
      if (prices.length > 0) {
        return Math.min(...prices);
      }
      return null;
    });

    if (priceFromContent) {
      logger.info(`Found price via content regex: AED ${priceFromContent}`);
      return {
        price: priceFromContent,
        currency: "AED",
        available: true,
        raw: `AED ${priceFromContent}`,
      };
    }
  } catch {
    // fallback failed
  }

  return null;
}

export async function scrapePrice(target: ProductTarget): Promise<ScrapedPrice | null> {
  if (!browser) await launchBrowser();

  const context = await browser!.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    viewport: { width: 1440, height: 900 },
    locale: "en-AE",
  });

  const page = await context.newPage();

  try {
    logger.info(`Scraping ${target.platform}: ${target.url}`);

    await page.goto(target.url, {
      waitUntil: "domcontentloaded",
      timeout: config.navigationTimeout,
    });

    // Wait for dynamic content
    await page.waitForTimeout(3_000);

    // Check for "out of stock" or "not available"
    const pageText = await page.evaluate(() => document.body.innerText.toLowerCase());
    if (pageText.includes("out of stock") || pageText.includes("currently unavailable")) {
      logger.warn(`${target.platform}: Product appears out of stock`);
      return { price: 0, currency: "AED", available: false, raw: "Out of stock" };
    }

    const result = await extractPriceFromPage(page, target);

    if (!result) {
      logger.warn(`${target.platform}: Could not extract price from ${target.url}`);

      // Save a screenshot for debugging
      await page.screenshot({
        path: `data/debug-${target.platform}-${Date.now()}.png`,
        fullPage: false,
      });
    }

    return result;
  } catch (err) {
    logger.error(`${target.platform}: Scrape failed – ${err}`);
    return null;
  } finally {
    await context.close();
  }
}

export async function scrapeAll(targets: ProductTarget[]): Promise<Map<string, ScrapedPrice | null>> {
  const results = new Map<string, ScrapedPrice | null>();
  await launchBrowser();

  for (const target of targets) {
    const price = await scrapePrice(target);
    results.set(target.platform, price);
    // Small delay between requests to be respectful
    await new Promise((r) => setTimeout(r, 2_000));
  }

  await closeBrowser();
  return results;
}
