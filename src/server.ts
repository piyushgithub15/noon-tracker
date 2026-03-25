import express from "express";
import { PRODUCTS } from "./config";
import { logger } from "./logger";
import {
  getLatestPrices,
  getLatestPrice,
  getLowestPrice,
  getLowestPriceOverall,
  getPriceHistory,
  getAllPriceHistory,
  PriceRecord,
} from "./storage";

export function startServer(port: number): void {
  const app = express();

  app.use((_req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    next();
  });

  app.get("/api/prices", (_req, res) => {
    const latest = getLatestPrices();
    const overall = getLowestPriceOverall();

    const platforms = latest.map((r) => ({
      platform: r.platform,
      product: r.product_name,
      price: r.price,
      currency: r.currency,
      url: r.url,
      scraped_at: r.scraped_at,
      lowest_ever: getLowestPrice(r.platform)?.price ?? null,
    }));

    const best = latest.length > 0
      ? latest.reduce((a, b) => (a.price < b.price ? a : b))
      : null;

    res.json({
      product: "iPhone 17 Pro 256GB Deep Blue (eSIM) International Version",
      best_price: best
        ? { platform: best.platform, price: best.price, currency: best.currency, url: best.url }
        : null,
      lowest_ever: overall
        ? { platform: overall.platform, price: overall.price, currency: overall.currency, scraped_at: overall.scraped_at }
        : null,
      platforms,
    });
  });

  app.get("/api/prices/:platform", (req, res) => {
    const { platform } = req.params;
    const valid = PRODUCTS.map((p) => p.platform);
    if (!valid.includes(platform as any)) {
      res.status(400).json({ error: `Invalid platform. Valid: ${valid.join(", ")}` });
      return;
    }

    const latest = getLatestPrice(platform);
    const lowest = getLowestPrice(platform);
    const history = getPriceHistory(platform, 50);

    res.json({
      platform,
      latest: latest ?? null,
      lowest_ever: lowest ?? null,
      history,
    });
  });

  app.get("/api/history", (req, res) => {
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
    const history = getAllPriceHistory(limit);
    res.json({ count: history.length, history });
  });

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", uptime: process.uptime() });
  });

  app.listen(port, () => {
    logger.info(`API server listening on http://localhost:${port}`);
    logger.info(`  GET /api/prices          → latest prices from all platforms`);
    logger.info(`  GET /api/prices/:platform → detail + history for one platform`);
    logger.info(`  GET /api/history?limit=N  → recent price records`);
    logger.info(`  GET /health               → health check`);
  });
}
