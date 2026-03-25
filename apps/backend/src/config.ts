import { join } from "node:path";

const certsDirectory = new URL("../../../certs/", import.meta.url);

const parseList = (value: string | undefined) =>
  (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

export const appConfig = {
  port: Number(Bun.env.BACKEND_PORT ?? Bun.env.PORT ?? 3001),
  host: Bun.env.HOST ?? "0.0.0.0",
  publicHost: Bun.env.PUBLIC_HOST ?? "joi.thrush-dab.ts.net",
  protocol: Bun.env.PROTOCOL ?? "https",
  aiServiceUrl:
    Bun.env.AI_SERVICE_URL ??
    `${Bun.env.PROTOCOL ?? "https"}://${Bun.env.PUBLIC_HOST ?? "joi.thrush-dab.ts.net"}:3002`,
  internalApiSecret: Bun.env.INTERNAL_API_SECRET ?? "mote-dev-internal-secret",
  databasePath: Bun.env.DATABASE_PATH ?? join(process.cwd(), "data", "mote.sqlite"),
  tls: {
    certPath:
      Bun.env.TLS_CERT_PATH ?? new URL("joi.thrush-dab.ts.net.crt", certsDirectory).pathname,
    keyPath:
      Bun.env.TLS_KEY_PATH ?? new URL("joi.thrush-dab.ts.net.key", certsDirectory).pathname
  },
  mediasoup: {
    listenIp: Bun.env.MEDIASOUP_LISTEN_IP ?? "0.0.0.0",
    announcedAddress: Bun.env.MEDIASOUP_ANNOUNCED_ADDRESS ?? (Bun.env.PUBLIC_HOST ?? "joi.thrush-dab.ts.net"),
    rtcMinPort: Number(Bun.env.MEDIASOUP_MIN_PORT ?? 40_000),
    rtcMaxPort: Number(Bun.env.MEDIASOUP_MAX_PORT ?? 49_999)
  },
  ice: {
    stunUrls: parseList(Bun.env.STUN_URLS ?? "stun:stun.l.google.com:19302"),
    turnUrls: parseList(Bun.env.TURN_URLS),
    turnTlsUrls: parseList(Bun.env.TURN_TLS_URLS),
    turnStaticAuthSecret: Bun.env.TURN_STATIC_AUTH_SECRET ?? "",
    turnCredentialTtlSeconds: Number(Bun.env.TURN_CREDENTIAL_TTL_SECONDS ?? 3600)
  },
  transcription: {
    defaultProvider:
      (Bun.env.TRANSCRIPTION_DEFAULT_PROVIDER ?? "whisperlive") === "sarvam"
        ? "sarvam"
        : (Bun.env.TRANSCRIPTION_DEFAULT_PROVIDER ?? "whisperlive") === "none"
          ? "none"
          : "whisperlive",
    whisperlive: {
      model: Bun.env.TRANSCRIPTION_MODEL ?? "base",
      language: Bun.env.TRANSCRIPTION_LANGUAGE ?? "auto",
      sampleRate: Number(Bun.env.TRANSCRIPTION_SAMPLE_RATE ?? 16_000)
    },
    none: {
      model: "disabled",
      language: "none",
      sampleRate: 16_000
    },
    sarvam: {
      model: Bun.env.SARVAM_STT_MODEL ?? "saaras:v3",
      language: Bun.env.SARVAM_LANGUAGE_CODE ?? "unknown",
      sampleRate: Number(Bun.env.SARVAM_SAMPLE_RATE ?? 16_000)
    }
  }
} as const;
