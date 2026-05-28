import { createServer } from "node:http";
import { spawn } from "node:child_process";

const port = 4175;
const maxDurationMs = Number(process.env.VISUAL_PARITY_PERF_MAX_MS ?? 15_000);

const cssRules = Array.from({ length: 1400 }, (_, index) => {
  return `.unused-${index} { color: rgb(${index % 255}, ${(index * 3) % 255}, ${(index * 7) % 255}); padding: ${index % 24}px; margin: ${index % 17}px; border-color: rgb(${(index * 5) % 255}, ${(index * 11) % 255}, ${(index * 13) % 255}); }`;
}).join("\n");

function page(kind) {
  const isLocal = kind === "local";
  const title = isLocal ? "Candidate heavy page" : "Reference heavy page";
  const accent = isLocal ? "#4338ca" : "#4f46e5";
  const spacing = isLocal ? 44 : 48;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>
    ${cssRules}
    :root { font-family: Inter, ui-sans-serif, system-ui, sans-serif; color: #111827; background: #f8fafc; }
    body { margin: 0; }
    header { display: flex; justify-content: space-between; align-items: center; min-height: 80px; padding: 0 ${spacing}px; background: white; }
    main { padding: ${spacing}px; }
    .hero h1 { font-size: 64px; line-height: 1; margin: 0 0 24px; -webkit-text-fill-color: ${isLocal ? "#f8fafc" : "#ffffff"}; color: #000; }
    .nr-event-card { display: grid; grid-template-columns: 240px 1fr; gap: 28px; padding: 24px; margin: 0 0 20px; border: 1px solid #d8dee8; border-radius: 18px; background: white; }
    .nr-event-card__media { min-height: 140px; border-radius: 14px; background: linear-gradient(135deg, ${accent}, #0f172a); }
    .nr-event-card__title { font-size: 28px; font-weight: 800; margin: 8px 0; }
    .nr-pill-cta-link { display: inline-flex; gap: 12px; padding: 12px 18px; border-radius: 999px; background: ${accent}; color: white; }
  </style>
</head>
<body>
  <header><strong>Visual Parity</strong><nav>Events</nav></header>
  <main>
    <section class="hero"><h1>Events and webinars</h1></section>
    ${Array.from({ length: 18 }, (_, index) => `<article class="nr-event-card">
      <div class="nr-event-card__media"></div>
      <div>
        <div class="nr-event-card__supertitle">Event ${index + 1}</div>
        <div class="nr-event-card__schedule">June ${index + 1}, 2026</div>
        <h2 class="nr-event-card__title">Security research forum ${index + 1}</h2>
        <a class="nr-event-card__cta nr-pill-cta-link"><span class="nr-pill-cta-link__left">Register</span><span class="nr-pill-cta-link__right">→</span></a>
      </div>
    </article>`).join("\n")}
    <section class="nr-cta-band"><h2>Stay in the loop</h2></section>
  </main>
</body>
</html>`;
}

const server = createServer((req, res) => {
  const url = new URL(req.url || "/", `http://127.0.0.1:${port}`);
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.end(page(url.pathname.includes("local") ? "local" : "live"));
});

await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));

const args = [
  "dist/cli.js",
  "compare",
  "--reference",
  `http://127.0.0.1:${port}/live/events`,
  "--candidate",
  `http://127.0.0.1:${port}/local/events`,
  "--out",
  ".visual-parity/reports/perf-smoke",
  "--name",
  "heavy-css",
  "--full-page",
  "--wait-until",
  "domcontentloaded",
  "--wait-ms",
  "0",
  "--max-diff-percent",
  "100",
  "--selector",
  "h1",
  "--selector",
  "h2",
  "--selector",
  ".nr-event-card",
  "--selector",
  ".nr-event-card__media",
  "--selector",
  ".nr-event-card__supertitle",
  "--selector",
  ".nr-event-card__schedule",
  "--selector",
  ".nr-event-card__title",
  "--selector",
  ".nr-event-card__cta",
  "--selector",
  ".nr-pill-cta-link",
  "--selector",
  ".nr-pill-cta-link__left",
  "--selector",
  ".nr-pill-cta-link__right",
  "--selector",
  ".nr-cta-band"
];

const start = performance.now();
const child = spawn(process.execPath, args, { stdio: "inherit" });
const exitCode = await new Promise((resolve) => child.on("exit", resolve));
const durationMs = Math.round(performance.now() - start);
server.close();

console.log(`visual-parity perf smoke completed in ${durationMs}ms (budget ${maxDurationMs}ms)`);

if (exitCode !== 0) process.exit(exitCode ?? 1);
if (durationMs > maxDurationMs) {
  console.error(`Perf smoke exceeded budget: ${durationMs}ms > ${maxDurationMs}ms`);
  process.exit(1);
}
