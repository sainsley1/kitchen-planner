import { spawn } from "node:child_process";

const port = "4173";
const origin = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, [".next/standalone/server.js"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    PORT: port,
    HOSTNAME: "127.0.0.1",
    DEMO_MODE: "true",
    AUTH_MODE: "disabled",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let serverOutput = "";
server.stdout.on("data", (chunk) => {
  serverOutput += chunk.toString();
});
server.stderr.on("data", (chunk) => {
  serverOutput += chunk.toString();
});

async function waitForServer() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`${origin}/api/health`);
      if (response.ok) return;
    } catch {
      // The server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Server did not become ready.\n${serverOutput}`);
}

try {
  await waitForServer();
  const healthResponse = await fetch(`${origin}/api/health`);
  const health = await healthResponse.json();
  const dashboardResponse = await fetch(`${origin}/api/v1/dashboard`);
  const homeResponse = await fetch(origin);
  const home = await homeResponse.text();

  if (health.status !== "ok" || health.demoMode !== true)
    throw new Error("Health contract failed.");
  if (dashboardResponse.status !== 401) throw new Error("Unauthenticated API gate failed.");
  if (!home.includes("Welcome to your kitchen") || !home.includes("LAN household access"))
    throw new Error("Login-page smoke check failed.");

  console.log(
    JSON.stringify({ health, unauthenticatedDashboard: dashboardResponse.status, loginPage: "ok" }),
  );
} finally {
  server.kill("SIGTERM");
}
