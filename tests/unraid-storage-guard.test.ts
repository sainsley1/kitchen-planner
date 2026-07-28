import fs from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Unraid Docker storage guard", () => {
  it("retains the old image until health succeeds, bounds logs, and exposes safe cleanup", async () => {
    const script = await fs.readFile("unraid.sh", "utf8");
    expect(script).toContain("wait_for_app");
    expect(script).toContain(
      'start_app\n  wait_for_app\n  cleanup_previous_app_image "$previous_app_image"',
    );
    expect(script).toContain('docker image rm "$previous_image"');
    expect(script).toContain('docker builder prune --force --filter "until=24h"');
    expect(script).toContain("--log-opt max-size=10m");
    expect(script).toContain("--log-opt max-file=3");
    expect(script).toContain("cleanup) cleanup_docker_storage ;;");
    expect(script).not.toContain("docker system prune");
    expect(script).not.toContain("docker volume prune");
  });
});
