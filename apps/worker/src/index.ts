import "dotenv/config";

import { runOnce } from "./runOnce";

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function getFlagValue(name: string): string | null {
  const prefix = `${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  if (!hit) return null;
  return hit.slice(prefix.length);
}

async function main() {
  const dryRun = hasFlag("--dry-run");
  const xTestPost = hasFlag("--x-test-post");
  const xTestText = getFlagValue("--x-test-text");
  const result = await runOnce({
    dryRun,
    xTestPost,
    xTestText,
  });
  console.log("[worker] run complete:", result);
}

main().catch((err) => {
  console.error("[worker] fatal:", err);
  process.exitCode = 1;
});

