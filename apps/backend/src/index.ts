import { AgendaRefinementClient } from "./agenda/refinement-client";
import { readFileSync } from "node:fs";
import { appConfig } from "./config";
import { EventsRuntime } from "./events/runtime";
import { createApp } from "./http/create-app";
import { MediaRuntime } from "./media/runtime";
import { RoomStore } from "./store/room-store";

const roomStore = new RoomStore(appConfig.databasePath);
const eventsRuntime = new EventsRuntime(roomStore);
const agendaRefinementClient = new AgendaRefinementClient(appConfig.aiServiceUrl);
const mediaRuntime = await MediaRuntime.create({
  rtcMinPort: appConfig.mediasoup.rtcMinPort,
  rtcMaxPort: appConfig.mediasoup.rtcMaxPort,
  listenIp: appConfig.mediasoup.listenIp,
  announcedAddress: appConfig.mediasoup.announcedAddress
});

const app = createApp(
  roomStore,
  mediaRuntime,
  eventsRuntime,
  agendaRefinementClient,
  appConfig.ice,
  {
    url: `${appConfig.aiServiceUrl.replace(/^http/, "ws")}/transcribe`,
    model: appConfig.transcription.model,
    language: appConfig.transcription.language,
    sampleRate: appConfig.transcription.sampleRate
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

console.log(`${appConfig.protocol.toUpperCase()} backend listening on ${appConfig.protocol}://${appConfig.host}:${app.server?.port ?? appConfig.port}`);
console.log(`Backend public address ${appConfig.protocol}://${appConfig.publicHost}:${app.server?.port ?? appConfig.port}`);
