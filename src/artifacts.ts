import fs from "node:fs/promises";
import { pathToFileURL } from "node:url";
import type { ContentBlock, ResourceLink } from "@modelcontextprotocol/sdk/types.js";

export interface ArtifactFile {
  path: string;
  name: string;
  title: string;
  description?: string;
}

export async function artifactResourceLink(file: ArtifactFile): Promise<ResourceLink> {
  const stats = await fs.stat(file.path);
  return {
    type: "resource_link",
    uri: pathToFileURL(file.path).href,
    name: file.name,
    title: file.title,
    description: file.description,
    mimeType: mimeTypeForPath(file.path),
    size: stats.size
  };
}

export async function artifactImageContent(file: ArtifactFile): Promise<ContentBlock> {
  const data = await fs.readFile(file.path);
  return {
    type: "image",
    data: data.toString("base64"),
    mimeType: mimeTypeForPath(file.path),
    annotations: {
      audience: ["user", "assistant"],
      priority: 0.9
    },
    _meta: {
      name: file.name,
      title: file.title,
      path: file.path
    }
  };
}

export function mimeTypeForPath(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return "text/html";
  if (lower.endsWith(".json")) return "application/json";
  return "application/octet-stream";
}

export function fileArtifact(path: string, name: string, title: string, description?: string): ArtifactFile {
  return { path, name, title, description };
}
