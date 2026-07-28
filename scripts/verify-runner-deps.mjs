import { access } from "node:fs/promises";
import path from "node:path";

const standaloneModules = path.resolve(".next", "standalone", "node_modules");
const requiredPackages = ["pg", "zod"];

for (const packageName of requiredPackages) {
  const packageManifest = path.join(standaloneModules, packageName, "package.json");
  try {
    await access(packageManifest);
  } catch {
    throw new Error(`Standalone runner is missing ${packageName}. Expected ${packageManifest}`);
  }
}

console.log(`Standalone runner dependencies OK: ${requiredPackages.join(", ")}`);
