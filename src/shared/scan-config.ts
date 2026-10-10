import type { ScanConfig } from "./types.js";

export const standardProductPath = ".workflow-system/PRODUCT.yaml";

// Projects from older versions join the vNext reading workflow on upgrade.
// Custom scope remains an explicit escape hatch for compatibility and diagnosis.
export function normalizeReadConfig(config: ScanConfig): ScanConfig {
  if (config.readingMode === "custom") return config;
  return {
    ...config,
    readingMode: "vnext",
    autoDiscover: true,
    product: { enabled: true, manifestPath: standardProductPath },
  };
}
