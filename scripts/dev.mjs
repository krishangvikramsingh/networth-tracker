// Runs the API (tsx) and the Vite dev server together. Open http://localhost:5173
import { spawn } from "node:child_process";
const run = (cmd, args, env = {}) => spawn(cmd, args, { stdio: "inherit", env: { ...process.env, ...env } });
const api = run("node", ["--import", "tsx", "--watch", "src/server/index.ts"]);
const web = run("npx", ["vite"]);
const stop = () => { api.kill(); web.kill(); process.exit(0); };
process.on("SIGINT", stop); process.on("SIGTERM", stop);
