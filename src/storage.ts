import Database from "better-sqlite3";
import { config } from "./config";
import { logger } from "./logger";
import path from "path";
import fs from "fs";

export interface PriceRecord {
  id?: number;
  platform: string;
  product_name: string;
  price: number;
  currency: string;
  url: string;
  scraped_at: string;
}

let db: Database.Database;

export function initDb(): void {
  const dir = path.dirname(config.dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  db = new Database(config.dbPath);
  db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS prices (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      platform    TEXT    NOT NULL,
      product_name TEXT   NOT NULL,
      price       REAL    NOT NULL,
      currency    TEXT    NOT NULL DEFAULT 'AED',
      url         TEXT    NOT NULL,
      scraped_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_prices_platform ON prices(platform);
    CREATE INDEX IF NOT EXISTS idx_prices_scraped   ON prices(scraped_at);
  `);

  logger.info(`Database initialized at ${config.dbPath}`);
}

export function savePrice(record: Omit<PriceRecord, "id">): void {
  const stmt = db.prepare(`
    INSERT INTO prices (platform, product_name, price, currency, url, scraped_at)
    VALUES (@platform, @product_name, @price, @currency, @url, @scraped_at)
  `);
  stmt.run(record);
  logger.info(`Saved price: ${record.platform} → ${record.currency} ${record.price}`);
}

export function getLatestPrice(platform: string): PriceRecord | undefined {
  return db
    .prepare(
      `SELECT * FROM prices WHERE platform = ? ORDER BY scraped_at DESC LIMIT 1`
    )
    .get(platform) as PriceRecord | undefined;
}

export function getPreviousPrice(platform: string): PriceRecord | undefined {
  return db
    .prepare(
      `SELECT * FROM prices WHERE platform = ? ORDER BY scraped_at DESC LIMIT 1 OFFSET 1`
    )
    .get(platform) as PriceRecord | undefined;
}

export function getLowestPrice(platform: string): PriceRecord | undefined {
  return db
    .prepare(
      `SELECT * FROM prices WHERE platform = ? ORDER BY price ASC LIMIT 1`
    )
    .get(platform) as PriceRecord | undefined;
}

export function getLowestPriceOverall(): PriceRecord | undefined {
  return db
    .prepare(`SELECT * FROM prices ORDER BY price ASC LIMIT 1`)
    .get() as PriceRecord | undefined;
}

export function closeDb(): void {
  db?.close();
}
