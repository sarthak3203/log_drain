import "dotenv/config";
import { startFlushWorker } from "./flushWorker";
import { startEmbeddingWorker } from "./embeddingWorker";
import { startAnomalyWorker } from "./anomalyWorker";
console.log("Starting background workers...");
startFlushWorker();
startEmbeddingWorker();
startAnomalyWorker();
// Retention job: delete old logs nightly
import cron from "node-cron";
import { query } from "../db";
cron.schedule("0 2 * * *", async () => {
  try {
    console.log("Running retention cleanup...");
    await query(`DELETE FROM logs WHERE timestamp < NOW() - INTERVAL '30 days'`);
    console.log("Retention cleanup completed");
  } catch (err) {
    console.error("Retention cleanup failed:", err);
  }
});
// Keep process alive
process.on("SIGTERM", () => {
  console.log("Worker process shutting down...");
  process.exit(0);
});
