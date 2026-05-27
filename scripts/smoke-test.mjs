import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const root = process.cwd();
const port = 4173;

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://127.0.0.1:${port}`);
    const filePath = path.join(root, "fixtures", url.pathname);
    const content = await readFile(filePath);
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end(content);
  } catch (error) {
    res.statusCode = 404;
    res.end("not found");
  }
});

await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));

const child = spawn(
  process.execPath,
  [
    "dist/cli.js",
    "compare",
    "--reference",
    `http://127.0.0.1:${port}/live/index.html`,
    "--candidate",
    `http://127.0.0.1:${port}/local/index.html`,
    "--out",
    "reports/smoke",
    "--name",
    "fixture",
    "--selector",
    "header",
    "--selector",
    ".hero",
    "--selector",
    "h1",
    "--selector",
    ".cta",
    "--preset",
    "hubspot",
    "--max-diff-percent",
    "0"
  ],
  { stdio: "inherit" }
);

const exitCode = await new Promise((resolve) => child.on("exit", resolve));
server.close();

// The fixture is intentionally different, so CLI should return 2 for threshold failure.
if (exitCode === 2) process.exit(0);
process.exit(exitCode ?? 1);
