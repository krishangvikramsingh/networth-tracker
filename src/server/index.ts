import { openDb } from "./db";
import { createApp } from "./app";
import { seedIfEmpty } from "./seed";

const db = openDb();
const seeded = seedIfEmpty(db);
const app = createApp(db);
const port = Number(process.env.PORT ?? 8787);
app.listen(port, process.env.HOST ?? "127.0.0.1", () => {
  console.log(`Net Worth Tracker API listening on http://${process.env.HOST ?? "127.0.0.1"}:${port}`);
  if (seeded.adminPassword) {
    console.log("First run: created synthetic demo users (change/replace via DEMO_* env vars):");
    console.log(`  admin  ${process.env.DEMO_ADMIN_EMAIL || "advisor@demo.local"}  /  ${seeded.adminPassword}`);
    console.log(`  viewer ${process.env.DEMO_VIEWER_EMAIL || "viewer@demo.local"}  /  ${seeded.viewerPassword}`);
  }
});
