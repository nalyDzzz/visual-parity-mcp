import fs from "node:fs/promises";
import path from "node:path";
import type { AcceptedDeviation, VisualParityConfig } from "./types.js";

const DEFAULT_CONFIG_FILE = ".visual-parity.json";

export async function loadVisualParityConfig(configPath?: string): Promise<VisualParityConfig> {
  const resolved = configPath ? path.resolve(process.cwd(), configPath) : path.resolve(process.cwd(), DEFAULT_CONFIG_FILE);
  try {
    const content = await fs.readFile(resolved, "utf8");
    return JSON.parse(content) as VisualParityConfig;
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code === "ENOENT" && !configPath) return {};
    throw new Error(`Failed to read visual parity config at ${resolved}: ${nodeError.message}`);
  }
}

export function mergeAcceptedDeviations(...groups: Array<AcceptedDeviation[] | undefined>): AcceptedDeviation[] {
  return groups.flatMap((group) => group ?? []);
}
