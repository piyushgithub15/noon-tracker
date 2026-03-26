import puppeteer, { Browser, Page, CookieParam } from "puppeteer";
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
let locationInitialized = false;

const UAE_COOKIES: CookieParam[] = [
  { name: "bm_loc", value: "AE", domain: ".noon.com", path: "/" },
  { name: "visitor_country", value: "AE", domain: ".noon.com", path: "/" },
  { name: "locale", value: "en", domain: ".noon.com", path: "/" },
  { name: "delivery_city", value: "Dubai", domain: ".noon.com", path: "/" },
  { name: "delivery_lat", value: "25.2048", domain: ".noon.com", path: "/" },
  { name: "delivery_lng", value: "55.2708", domain: ".noon.com", path: "/" },
  { name: "now_loc_id", value: "dubai", domain: ".noon.com", path: "/" },
  { name: "now_loc_en", value: "Dubai", domain: ".noon.com", path: "/" },
];

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
  locationInitialized = false;
  logger.info("Browser launched (stealth mode)");
}

export async function closeBrowser(): Promise<void> {
  if (browser) {
    await browser.close();
    browser = null;
    locationInitialized = false;
    logger.info("Browser closed");
  }
}

/**
 * Visit noon.com homepage first to establish a UAE session
 * with proper cookies and location selection.
 */
async function initializeUaeSession(page: Page): Promise<void> {
  if (locationInitialized) return;

  logger.info("Initializing UAE session...");

  // Set UAE cookies on all noon domains
  for (const domain of [".noon.com", ".minutes.noon.com", ".supermall.noon.com"]) {
    const cookies = UAE_COOKIES.map((c) => ({ ...c, domain }));
    await page.setCookie(...cookies);
  }

  // Visit homepage to warm up the session
  try {
    await page.goto("https://www.noon.com/uae-en/", {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    await new Promise((r) => setTimeout(r, 2_000));

    // Dismiss cookie banner
    await dismissCookieBanner(page);

    // Try to set location to Dubai if a location modal appears
    try {
      const locationBtn = await page.$('::-p-text(Dubai)');
      if (locationBtn) {
        await locationBtn.click();
        await new Promise((r) => setTimeout(r, 1_000));
        logger.info("Selected Dubai as delivery location");
      }
    } catch { /* no location modal */ }

    // Capture the actual location shown
    const locText = await page.evaluate(() => {
      const el = document.querySelector('[data-qa="delivery-city"], [class*="deliverTo"], [class*="deliver-to"]');
      return el?.textContent?.trim() ?? null;
    });
    logger.info(`Session location: ${locText ?? "unknown"}`);

    locationInitialized = true;
  } catch (err) {
    logger.warn(`Session init warning (continuing anyway): ${String(err).slice(0, 100)}`);
    locationInitialized = true;
  }
}

function parsePriceText(raw: string): { price: number; currency: string } | null {
  const cleaned = raw.replace(/,/g, "").trim();

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

  return extractPriceFromBodyText(page, platform);
}

async function extractFromSearchPage(page: Page, platform: string): Promise<ScrapedPrice | null> {
  const result = await page.evaluate(() => {
    const body = document.body.innerText;
    const lines = body.split("\n").map((l) => l.trim()).filter((l) => l);

    // Matching tiers: strict → relaxed → broad, all exclude Pro Max
    const tiers = [
      { must: ["iphone 17 pro", "256", "deep blue", "esim only"], mustNot: ["pro max"] },
      { must: ["iphone 17 pro", "256", "deep blue"], mustNot: ["pro max"] },
      { must: ["iphone 17 pro", "256", "blue"], mustNot: ["pro max"] },
    ];

    for (const tier of tiers) {
      for (let i = 0; i < lines.length; i++) {
        const lower = lines[i].toLowerCase();
        const isMatch =
          tier.must.every((kw) => lower.includes(kw)) &&
          !tier.mustNot.some((kw) => lower.includes(kw));

        if (!isMatch) continue;

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
    }

    return null;
  });

  if (result) {
    logger.info(`[${platform}] Matched product: "${result.name}" → AED ${result.price}`);
    return { price: result.price, currency: "AED", available: true, raw: `AED ${result.price}` };
  }

  // Log first few product-like lines for debugging
  const debugLines = await page.evaluate(() => {
    const lines = document.body.innerText.split("\n").map((l) => l.trim());
    return lines.filter((l) => l.toLowerCase().includes("iphone")).slice(0, 5);
  });
  logger.warn(`[${platform}] No matching product. iPhone lines on page: ${JSON.stringify(debugLines)}`);

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

    // Establish UAE session before first scrape
    await initializeUaeSession(page);

    logger.info(`Scraping ${target.platform}: ${target.url}`);

    const ok = await navigateWithRetry(page, target.url);
    if (!ok) {
      logger.error(`${target.platform}: All navigation attempts failed`);
      return null;
    }

    await new Promise((r) => setTimeout(r, 5_000));
    await dismissCookieBanner(page);

    if (target.isSearchPage) {
      for (let i = 0; i < 3; i++) {
        await page.evaluate(() => window.scrollBy(0, 800));
        await new Promise((r) => setTimeout(r, 1_000));
      }
    }

    const pageText = await page.evaluate(() => document.body?.innerText?.toLowerCase() ?? "");

    // On product pages, "not available" means this variant is OOS — still try to find price
    if (!target.isSearchPage && (pageText.includes("this product is not available") || pageText.includes("currently unavailable"))) {
      logger.info(`${target.platform}: Product marked unavailable, still attempting price extraction...`);

      // Sometimes the price is still on the page even when unavailable
      const priceResult = await extractFromProductPage(page, target.platform);
      if (priceResult) {
        priceResult.available = false;
        logger.info(`${target.platform}: Got price despite unavailable status: AED ${priceResult.price}`);
        return priceResult;
      }

      // Try selecting a different variant (the international eSIM version might be in stock)
      try {
        const eSIMBtn = await page.$('::-p-text(International Version (eSIM))');
        if (eSIMBtn) {
          logger.info(`${target.platform}: Clicking 'International Version (eSIM)' variant...`);
          await eSIMBtn.click();
          await new Promise((r) => setTimeout(r, 3_000));

          const variantResult = await extractFromProductPage(page, target.platform);
          if (variantResult) {
            logger.info(`${target.platform}: Got price after variant switch: AED ${variantResult.price}`);
            return variantResult;
          }
        }
      } catch { /* variant switch failed */ }

      logger.warn(`${target.platform}: Product not available and no price found`);
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
