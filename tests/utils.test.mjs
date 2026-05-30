import assert from "node:assert/strict";
import test from "node:test";
import { joinUrl, slugify, uniqueNonEmpty } from "../dist/utils.js";
import { VERSION } from "../dist/version.js";
import packageJson from "../package.json" with { type: "json" };

test("VERSION follows package.json", () => {
  assert.equal(VERSION, packageJson.version);
});

test("joinUrl preserves base paths and route slashes", () => {
  assert.equal(joinUrl("https://example.com/site", "/about"), "https://example.com/site/about");
  assert.equal(joinUrl("https://example.com/site/", "/about/"), "https://example.com/site/about/");
});

test("slugify and uniqueNonEmpty normalize user input", () => {
  assert.equal(slugify("https://Example.com/A nice page!"), "example-com-a-nice-page");
  assert.deepEqual(uniqueNonEmpty([" header ", "", undefined, "header", "main"]), ["header", "main"]);
});
