import fs from "node:fs";
import { describe, expect, it } from "vitest";

describe("release version consistency", () => {
  it("keeps package, installer, Compose, and Settings defaults aligned", () => {
    const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8")) as { version: string };
    const packageLock = JSON.parse(fs.readFileSync("package-lock.json", "utf8")) as {
      version: string;
      packages: Record<string, { version?: string }>;
    };
    const version = packageJson.version;
    expect(packageLock.version).toBe(version);
    expect(packageLock.packages[""]?.version).toBe(version);
    expect(fs.readFileSync("lib/config.ts", "utf8")).toContain(
      `APP_VERSION: z.string().default("${version}")`,
    );
    expect(fs.readFileSync("compose.yml", "utf8")).toContain(
      `APP_VERSION: \${APP_VERSION:-${version}}`,
    );
    expect(fs.readFileSync("unraid.sh", "utf8")).toContain(`APP_RELEASE_VERSION="${version}"`);
  });

  it("uses neutral household defaults and database-driven login choices", () => {
    const exampleEnv = fs.readFileSync(".env.example", "utf8");
    expect(exampleEnv).toContain("HOUSEHOLD_USER_1_NAME=Owner");
    expect(exampleEnv).toContain("HOUSEHOLD_USER_2_NAME=Member");

    const loginForm = fs.readFileSync("components/login-form.tsx", "utf8");
    expect(loginForm).toContain("displayNames.map");
    expect(loginForm).not.toMatch(/<option>[^<{]+<\/option>/);
  });

  it("keeps runtime data ignored without excluding source database modules", () => {
    const ignoreLines = fs
      .readFileSync(".gitignore", "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim());
    expect(ignoreLines).toContain("/db/");
    expect(ignoreLines).toContain("/postgres/");
    expect(ignoreLines).not.toContain("db/");
    expect(fs.existsSync("lib/db/queries.ts")).toBe(true);
  });
});
