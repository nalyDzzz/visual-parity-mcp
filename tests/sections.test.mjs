import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { compareSection, compareSections, discoverSections } from "../dist/sections.js";

test("section workflow discovers and compares fixture sections", async () => {
  const server = await fixtureServer();
  try {
    const base = `http://127.0.0.1:${server.port}`;
    const common = {
      liveUrl: `${base}/live/index.html`,
      localUrl: `${base}/local/index.html`,
      waitUntil: "domcontentloaded",
      waitMs: 0,
      maxSections: 3
    };

    const discovered = await discoverSections(common);
    const header = discovered.sections.find((section) => section.reference.selector === "header");
    assert.ok(header);
    assert.equal(header.candidate?.selector, "header");
    assert.match(header.matchReason ?? "", /same selector/);
    const hero = discovered.sections.find((section) => section.reference.selector.includes(".hero") || section.label.includes("Migration QA"));
    assert.ok(hero);
    assert.equal(hero.candidate?.selector, "section.hero");

    const section = await compareSection({
      ...common,
      referenceSelector: "section.hero",
      localSelector: "section.hero",
      sectionLabel: "Hero",
      outputDir: ".visual-parity/reports/tests"
    });
    assert.equal(section.section.label, "Hero");
    assert.equal(section.visual.passed, false);
    assert.ok(section.styles.diffCount > 0);
    assert.ok((await stat(section.reportHtml)).isFile());

    const checklist = await compareSections({ ...common, outputDir: ".visual-parity/reports/tests/sections" });
    assert.equal(checklist.total, discovered.sections.length);
    assert.ok(checklist.failed > 0);
    assert.ok(checklist.recommendedOrder.length > 0);
    assert.ok((await stat(checklist.summaryHtml)).isFile());
    assert.ok(checklist.sections.some((section) => section.reportHtml));
  } finally {
    await server.close();
  }
});

async function fixtureServer() {
  const root = process.cwd();
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", "http://127.0.0.1");
      const filePath = path.join(root, "fixtures", url.pathname);
      const content = await readFile(filePath);
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.end(content);
    } catch {
      res.statusCode = 404;
      res.end("not found");
    }
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.equal(typeof address, "object");
  assert.ok(address);
  return {
    port: address.port,
    close: () => new Promise((resolve) => server.close(resolve))
  };
}
