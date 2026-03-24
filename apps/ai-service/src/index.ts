import { createApp } from "./http/create-app";
import { aiServiceConfig, loadTlsFiles } from "./config";
import { BackendTranscriptPublisher } from "./transcription/backend-publisher";
import { TranscriptionRuntime } from "./transcription/runtime";

const publisher = new BackendTranscriptPublisher(
  aiServiceConfig.backendUrl,
  aiServiceConfig.internalApiSecret
);

const transcriptionRuntime = new TranscriptionRuntime(
  publisher,
  aiServiceConfig.transcription
);

const app = createApp(transcriptionRuntime, aiServiceConfig.backendUrl).listen({
  port: aiServiceConfig.port,
  hostname: aiServiceConfig.host,
  tls: loadTlsFiles()
});

console.log(
  `${aiServiceConfig.protocol.toUpperCase()} AI service listening on ${aiServiceConfig.protocol}://${aiServiceConfig.host}:${app.server?.port ?? aiServiceConfig.port}`
);
console.log(
  `AI service public address ${aiServiceConfig.protocol}://${aiServiceConfig.publicHost}:${app.server?.port ?? aiServiceConfig.port}`
);
console.log(
  `AI service transcription provider ${aiServiceConfig.transcription.providerUrl} (${aiServiceConfig.transcription.model}, ${aiServiceConfig.transcription.language}, ${aiServiceConfig.transcription.sampleRate}Hz)`
);
