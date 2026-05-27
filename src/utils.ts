import fs from "node:fs/promises";
import path from "node:path";

export async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

export function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || "run";
}

export function timestampSlug(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, "-");
}

export function resolveOutputDir(outputDir = "reports/visual-parity"): string {
  return path.resolve(process.cwd(), outputDir);
}

export function toNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

export function uniqueNonEmpty(values: Array<string | undefined> | undefined): string[] {
  return Array.from(new Set((values ?? []).map((value) => value?.trim()).filter(Boolean) as string[]));
}

export function makeRunDir(outputDir: string, name?: string, fallback?: string): string {
  const runName = slugify(name || fallback || timestampSlug());
  return path.join(resolveOutputDir(outputDir), runName);
}

export function joinUrl(base: string, routePath: string): string {
  const url = new URL(base);
  const basePath = url.pathname.endsWith("/") ? url.pathname : `${url.pathname}/`;
  const cleanRoute = routePath.replace(/^\/+/, "");
  url.pathname = path.posix.join(basePath, cleanRoute);
  if ((routePath.endsWith("/") || routePath === "") && !url.pathname.endsWith("/")) {
    url.pathname += "/";
  }
  return url.toString();
}

export function relativeForHtml(filePath: string, fromDir: string): string {
  return path.relative(fromDir, filePath).split(path.sep).join("/");
}

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function trimText(value: string, max = 120): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
}
