import "dotenv/config";

import { runOnce } from "./runOnce";

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

async function main() {
  const dryRun = hasFlag("--dry-run");
  const result = await runOnce({ dryRun });
  console.log("[worker] run complete:", result);
}

main().catch((err) => {
  console.error("[worker] fatal:", err);
  process.exitCode = 1;
});

