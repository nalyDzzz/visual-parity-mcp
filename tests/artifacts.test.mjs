import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { artifactImageContent, artifactResourceLink, fileArtifact, mimeTypeForPath } from "../dist/artifacts.js";

test("mimeTypeForPath recognizes report artifact types", () => {
  assert.equal(mimeTypeForPath("diff.png"), "image/png");
  assert.equal(mimeTypeForPath("report.html"), "text/html");
  assert.equal(mimeTypeForPath("report.json"), "application/json");
});

test("artifact helpers create MCP image content and resource links", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "visual-parity-artifact-"));
  const pngPath = path.join(dir, "diff.png");
  await fs.writeFile(pngPath, Buffer.from("not really a png"));

  const artifact = fileArtifact(pngPath, "diff-image", "Diff image");
  const image = await artifactImageContent(artifact);
  const link = await artifactResourceLink(artifact);

  assert.equal(image.type, "image");
  assert.equal(image.mimeType, "image/png");
  assert.equal(image.data, Buffer.from("not really a png").toString("base64"));
  assert.equal(link.type, "resource_link");
  assert.equal(link.mimeType, "image/png");
  assert.equal(link.size, "not really a png".length);
  assert.match(link.uri, /^file:\/\//);
});
