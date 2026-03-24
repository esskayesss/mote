import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const certsDirectory = path.resolve(currentDirectory, "../../certs");
const cert = fs.readFileSync(path.join(certsDirectory, "joi.thrush-dab.ts.net.crt"));
const key = fs.readFileSync(path.join(certsDirectory, "joi.thrush-dab.ts.net.key"));

export default defineConfig({
  plugins: [tailwindcss(), svelte()],
  resolve: {
    alias: {
      $lib: path.resolve("./src/lib")
    }
  },
  server: {
    host: "0.0.0.0",
    https: {
      cert,
      key
    },
    allowedHosts: ["joi.thrush-dab.ts.net"],
    port: 5173
  },
  preview: {
    host: "0.0.0.0",
    https: {
      cert,
      key
    },
    allowedHosts: ["joi.thrush-dab.ts.net"],
    port: 4173
  }
});
