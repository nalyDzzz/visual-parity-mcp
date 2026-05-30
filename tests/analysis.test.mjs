import assert from "node:assert/strict";
import test from "node:test";
import { aggregateCrossPageFindings, analyzeStyleDiffs } from "../dist/analysis.js";

test("analyzeStyleDiffs filters accepted deviations and collapses border color noise", () => {
  const rawDiffs = [
    { selector: ".card", index: 0, kind: "style", property: "border-top-color", live: "rgb(0, 0, 0)", local: "rgb(1, 1, 1)" },
    { selector: ".card", index: 0, kind: "style", property: "border-right-color", live: "rgb(0, 0, 0)", local: "rgb(1, 1, 1)" },
    { selector: ".card", index: 0, kind: "style", property: "border-bottom-color", live: "rgb(0, 0, 0)", local: "rgb(1, 1, 1)" },
    { selector: ".card", index: 0, kind: "style", property: "border-left-color", live: "rgb(0, 0, 0)", local: "rgb(1, 1, 1)" },
    { selector: ".card", index: 0, kind: "style", property: "font-family", live: "Inter", local: "Inter Fallback" }
  ];

  const { diffs, analysis } = analyzeStyleDiffs(rawDiffs, [{ selector: "*", property: "font-family", pattern: "Fallback" }], 2);

  assert.equal(diffs.length, 1);
  assert.equal(diffs[0].property, "border-color");
  assert.equal(analysis.ignoredDiffCount, 4);
  assert.equal(analysis.clusters[0].property, "border-color");
});

test("analyzeStyleDiffs builds a grouped fix plan", () => {
  const { analysis } = analyzeStyleDiffs([
    { selector: "body", index: 0, kind: "style", property: "box-sizing", live: "border-box", local: "content-box", localSources: [{ type: "rule", selectorText: "*", value: "content-box" }] },
    { selector: ".hero", index: 0, kind: "text", property: "text", live: "Hello", local: "Hi" }
  ]);

  assert.equal(analysis.fixPlan.globalCssFixes.length, 1);
  assert.match(analysis.fixPlan.globalCssFixes[0].suggestedFix, /box-sizing/);
  assert.equal(analysis.fixPlan.contentMismatches.length, 1);
});

test("aggregateCrossPageFindings combines repeated route clusters", () => {
  const result = (url, count) => ({
    liveUrl: `https://old.test${url}`,
    localUrl: `https://new.test${url}`,
    reportHtml: `/tmp/${url.replace("/", "root")}.html`,
    styles: {
      analysis: {
        clusters: [
          {
            id: "style:box-sizing:border-box:content-box",
            kind: "style",
            property: "box-sizing",
            live: "border-box",
            local: "content-box",
            count,
            selectors: ["body"],
            examples: [],
            priority: "high",
            severity: "major",
            suggestedFix: "fix it",
            estimatedResolution: { diffs: count, diffPercent: 0.5 }
          }
        ]
      }
    }
  });

  const findings = aggregateCrossPageFindings([result("/", 2), result("/about", 3)]);

  assert.equal(findings.length, 1);
  assert.equal(findings[0].pageCount, 2);
  assert.equal(findings[0].totalDiffs, 5);
  assert.equal(findings[0].estimatedDiffPercent, 1);
});
