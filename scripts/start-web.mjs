import { loadEnvFile } from "node:process";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
try {
  loadEnvFile(".env.local");
} catch {}
const command = process.argv[2] === "start" ? "start" : "dev";
const host = process.env.APP_ACCESS_TOKEN ? "0.0.0.0" : "127.0.0.1";
const child = spawn(
  process.execPath,
  [
    fileURLToPath(
      new URL("../node_modules/next/dist/bin/next", import.meta.url),
    ),
    command,
    "--hostname",
    host,
    ...process.argv.slice(3),
  ],
  { stdio: "inherit" },
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => child.kill(signal));
child.on("exit", (code) => process.exit(code ?? 0));
