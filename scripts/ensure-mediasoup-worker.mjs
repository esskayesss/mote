import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const workspaceCandidates = [process.cwd(), join(process.cwd(), "apps", "backend")];

const mediasoupEntryPath = workspaceCandidates.reduce((resolvedPath, candidate) => {
  if (resolvedPath) {
    return resolvedPath;
  }

  try {
    const require = createRequire(join(candidate, "package.json"));
    return require.resolve("mediasoup");
  } catch {
    return null;
  }
}, null);

if (!mediasoupEntryPath) {
  console.error("Unable to resolve mediasoup from the current workspace.");
  process.exit(1);
}

const mediasoupDir = join(dirname(mediasoupEntryPath), "..", "..");
const workerBinary = join(
  mediasoupDir,
  "worker",
  "out",
  "Release",
  process.platform === "win32" ? "mediasoup-worker.exe" : "mediasoup-worker"
);

if (existsSync(workerBinary)) {
  process.exit(0);
}

const script = join(mediasoupDir, "npm-scripts.mjs");
const result = spawnSync(process.execPath, [script, "worker:build"], {
  cwd: mediasoupDir,
  stdio: "inherit",
  env: process.env
});

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
