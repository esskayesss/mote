import { readFileSync } from "node:fs";

const certsDirectory = new URL("../../../certs/", import.meta.url);

export const aiServiceConfig = {
  port: Number(Bun.env.PORT ?? 3002),
  host: Bun.env.HOST ?? "0.0.0.0",
  publicHost: Bun.env.PUBLIC_HOST ?? "joi.thrush-dab.ts.net",
  protocol: Bun.env.PROTOCOL ?? "https",
  backendUrl:
    Bun.env.BACKEND_URL ??
    `${Bun.env.PROTOCOL ?? "https"}://${Bun.env.PUBLIC_HOST ?? "joi.thrush-dab.ts.net"}:3001`,
  internalApiSecret: Bun.env.INTERNAL_API_SECRET ?? "mote-dev-internal-secret",
  transcription: {
    providerUrl:
      Bun.env.TRANSCRIPTION_PROVIDER_URL ?? "ws://xerxes.thrush-dab.ts.net:9090",
    model: Bun.env.TRANSCRIPTION_MODEL ?? "base.en",
    language: Bun.env.TRANSCRIPTION_LANGUAGE ?? "en",
    sampleRate: Number(Bun.env.TRANSCRIPTION_SAMPLE_RATE ?? 16_000)
  },
  tls: {
    certPath:
      Bun.env.TLS_CERT_PATH ?? new URL("joi.thrush-dab.ts.net.crt", certsDirectory).pathname,
    keyPath:
      Bun.env.TLS_KEY_PATH ?? new URL("joi.thrush-dab.ts.net.key", certsDirectory).pathname
  }
} as const;

export const loadTlsFiles = () => ({
  cert: readFileSync(aiServiceConfig.tls.certPath),
  key: readFileSync(aiServiceConfig.tls.keyPath)
});
