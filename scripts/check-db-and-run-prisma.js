const net = require("node:net");
const { spawn } = require("node:child_process");
require("dotenv/config");

const command = process.argv.slice(2);

if (command.length === 0) {
  console.error("Usage: node scripts/check-db-and-run-prisma.js <prisma args...>");
  process.exit(1);
}

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error("DATABASE_URL is not set. Add it to .env before running Prisma.");
  process.exit(1);
}

let parsed;
try {
  parsed = new URL(databaseUrl.replace(/^"|"$/g, ""));
} catch {
  console.error(`DATABASE_URL is not a valid URL: ${databaseUrl}`);
  process.exit(1);
}

const host = parsed.hostname || "localhost";
const port = Number(parsed.port || 5432);

function canConnect() {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const timeout = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, 2000);

    socket.once("connect", () => {
      clearTimeout(timeout);
      socket.end();
      resolve(true);
    });

    socket.once("error", () => {
      clearTimeout(timeout);
      resolve(false);
    });
  });
}

async function main() {
  if (!(await canConnect())) {
    console.error(
      [
        `Cannot reach PostgreSQL at ${host}:${port}.`,
        "",
        "Start the local database first:",
        "  docker compose up -d --wait postgres redis",
        "",
        "If Docker is not installed, install/start Docker Desktop or run a local PostgreSQL",
        "server that matches DATABASE_URL in .env.",
      ].join("\n"),
    );
    process.exit(1);
  }

  const prisma = spawn("npx", ["prisma", ...command], {
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  prisma.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 1);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
