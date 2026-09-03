// Post-build step: assembles the standalone output so it can run portably.
// Cross-platform replacement for the previous Unix-only `cp -r` commands.
import { cpSync, mkdirSync, existsSync, copyFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const standalone = join(root, ".next", "standalone");

if (!existsSync(standalone)) {
  console.error("postbuild: .next/standalone not found - run `next build` first.");
  process.exit(1);
}

// 1. Static client assets -> .next/standalone/.next/static
mkdirSync(join(standalone, ".next"), { recursive: true });
cpSync(join(root, ".next", "static"), join(standalone, ".next", "static"), {
  recursive: true,
});

// 2. Public assets -> .next/standalone/public
if (existsSync(join(root, "public"))) {
  cpSync(join(root, "public"), join(standalone, "public"), { recursive: true });
}

// 3. SQLite database -> .next/standalone/db (used by the portable launcher)
if (existsSync(join(root, "db", "custom.db"))) {
  mkdirSync(join(standalone, "db"), { recursive: true });
  copyFileSync(join(root, "db", "custom.db"), join(standalone, "db", "custom.db"));
}

// 4. Portable launcher script
copyFileSync(join(root, "scripts", "start.cmd"), join(standalone, "start.cmd"));

console.log("postbuild: standalone bundle assembled (.next/standalone).");
