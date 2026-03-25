import { readFileSync } from "node:fs";

const certsDirectory = new URL("../../../certs/", import.meta.url);

export const aiServiceConfig = {
  port: Number(Bun.env.AI_SERVICE_PORT ?? 3002),
  host: Bun.env.HOST ?? "0.0.0.0",
  publicHost: Bun.env.PUBLIC_HOST ?? "joi.thrush-dab.ts.net",
  protocol: Bun.env.PROTOCOL ?? "https",
  backendUrl:
    Bun.env.BACKEND_URL ??
    `${Bun.env.PROTOCOL ?? "https"}://${Bun.env.PUBLIC_HOST ?? "joi.thrush-dab.ts.net"}:3001`,
  internalApiSecret: Bun.env.INTERNAL_API_SECRET ?? "mote-dev-internal-secret",
  llm: {
    baseUrl: Bun.env.LLM_BASE_URL ?? "https://api.openai.com/v1/chat/completions",
    apiKey: Bun.env.LLM_API_KEY ?? Bun.env.OPENAI_API_KEY ?? "",
    model: Bun.env.LLM_MODEL ?? Bun.env.OPENAI_MODEL ?? "gpt-4.1-mini"
  },
  transcription: {
    providerUrl:
      Bun.env.TRANSCRIPTION_PROVIDER_URL ?? "ws://xerxes.thrush-dab.ts.net:9090",
    model: Bun.env.TRANSCRIPTION_MODEL ?? "base",
    language: Bun.env.TRANSCRIPTION_LANGUAGE ?? "auto",
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
