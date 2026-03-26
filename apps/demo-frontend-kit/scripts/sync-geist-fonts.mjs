import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const appDirectory = path.resolve(currentDirectory, "..");
const fontsDirectory = path.join(appDirectory, "static", "fonts");
const require = createRequire(import.meta.url);
const geistPackageDirectory = path.dirname(require.resolve("geist/package.json"));

const fontMappings = [
  {
    source: path.join(
      geistPackageDirectory,
      "dist",
      "fonts",
      "geist-sans",
      "Geist-Variable.woff2"
    ),
    target: path.join(fontsDirectory, "geist-sans-variable.woff2")
  },
  {
    source: path.join(
      geistPackageDirectory,
      "dist",
      "fonts",
      "geist-mono",
      "GeistMono-Variable.woff2"
    ),
    target: path.join(fontsDirectory, "geist-mono-variable.woff2")
  }
];

await fs.mkdir(fontsDirectory, { recursive: true });

for (const font of fontMappings) {
  await fs.copyFile(font.source, font.target);
}
