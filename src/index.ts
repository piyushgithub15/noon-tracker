import cron from "node-cron";
import { config, validateConfig } from "./config";
import { logger } from "./logger";
import { initDb, closeDb } from "./storage";
import { initTelegram, notifyStartup } from "./telegram";
import { runPriceCheck } from "./tracker";
import { closeBrowser } from "./scraper";

async function main(): Promise<void> {
  logger.info("Noon Price Tracker starting up...");

  validateConfig();
  initDb();
  initTelegram();

  if (config.checkOnStartup || process.argv.includes("--check-now")) {
    await notifyStartup();
    await runPriceCheck();
  }

  if (process.argv.includes("--check-now")) {
    logger.info("Single check complete, exiting.");
    await cleanup();
    process.exit(0);
  }

  logger.info(`Scheduling price checks: ${config.cron}`);
  cron.schedule(config.cron, async () => {
    try {
      await runPriceCheck();
    } catch (err) {
      logger.error(`Scheduled check failed: ${err}`);
    }
  });

  logger.info("Tracker is running. Press Ctrl+C to stop.");
}

async function cleanup(): Promise<void> {
  logger.info("Shutting down...");
  await closeBrowser();
  closeDb();
}

process.on("SIGINT", async () => {
  await cleanup();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await cleanup();
  process.exit(0);
});

main().catch((err) => {
  logger.error(`Fatal error: ${err}`);
  process.exit(1);
});
