import { AgendaRefinementClient } from "./agenda/refinement-client";
import { readFileSync } from "node:fs";
import { appConfig } from "./config";
import { EventsRuntime } from "./events/runtime";
import { createApp } from "./http/create-app";
import { logger } from "./logger";
import { MediaRuntime } from "./media/runtime";
import { RoomStore } from "./store/room-store";

const roomStore = new RoomStore(appConfig.databasePath);
const eventsRuntime = new EventsRuntime(roomStore);
const agendaRefinementClient = new AgendaRefinementClient(appConfig.aiServiceUrl);
const mediaRuntime = await MediaRuntime.create({
  rtcMinPort: appConfig.mediasoup.rtcMinPort,
  rtcMaxPort: appConfig.mediasoup.rtcMaxPort,
  listenIp: appConfig.mediasoup.listenIp,
  announcedAddress: appConfig.mediasoup.announcedAddress,
  roomStore
});

const app = createApp(
  roomStore,
  mediaRuntime,
  eventsRuntime,
  agendaRefinementClient,
  appConfig.aiServiceUrl,
  appConfig.ice,
  {
    url: `${appConfig.aiServiceUrl.replace(/^http/, "ws")}/transcribe`,
    providers: {
      none: {
        model: appConfig.transcription.none.model,
        language: appConfig.transcription.none.language,
        sampleRate: appConfig.transcription.none.sampleRate
      },
      whisperlive: {
        model: appConfig.transcription.whisperlive.model,
        language: appConfig.transcription.whisperlive.language,
        sampleRate: appConfig.transcription.whisperlive.sampleRate
      },
      sarvam: {
        model: appConfig.transcription.sarvam.model,
        language: appConfig.transcription.sarvam.language,
        sampleRate: appConfig.transcription.sarvam.sampleRate
      }
    }
  },
  appConfig.internalApiSecret
).listen({
  port: appConfig.port,
  hostname: appConfig.host,
  tls: {
    cert: readFileSync(appConfig.tls.certPath),
    key: readFileSync(appConfig.tls.keyPath)
  }
});

logger.withContext({
  service: "backend"
}).withMetadata({
  listenAddress: `${appConfig.protocol}://${appConfig.host}:${app.server?.port ?? appConfig.port}`,
  publicAddress: `${appConfig.protocol}://${appConfig.publicHost}:${app.server?.port ?? appConfig.port}`
}).info("service.started");
