import { AgendaNormalizerAgent } from "./agents/agenda-normalizer-agent";
import { createApp } from "./http/create-app";
import { aiServiceConfig, loadTlsFiles } from "./config";
import { logger } from "./logger";
import { MeetingMonitoringRuntime } from "./monitoring/runtime";
import { OpenAiChatCompletionsTool } from "./tools/llm/openai-chat-completions-tool";
import { BackendTranscriptPublisher } from "./transcription/backend-publisher";
import { TranscriptionRuntime } from "./transcription/runtime";
import { createRefineAgendaWorkflow } from "./workflows/agenda/refine-agenda-workflow";

const publisher = new BackendTranscriptPublisher(
  aiServiceConfig.backendUrl,
  aiServiceConfig.internalApiSecret
);

const llmTool = new OpenAiChatCompletionsTool(aiServiceConfig.openai);
const monitoringRuntime = new MeetingMonitoringRuntime(
  aiServiceConfig.backendUrl,
  publisher,
  llmTool
);
const transcriptionRuntime = new TranscriptionRuntime(
  publisher,
  monitoringRuntime,
  aiServiceConfig.transcription
);
const refineAgendaWorkflow = createRefineAgendaWorkflow(llmTool);
const agendaNormalizerAgent = new AgendaNormalizerAgent(refineAgendaWorkflow);

const app = createApp(
  transcriptionRuntime,
  aiServiceConfig.backendUrl,
  (input) => agendaNormalizerAgent.normalize(input)
).listen({
  port: aiServiceConfig.port,
  hostname: aiServiceConfig.host,
  ...(aiServiceConfig.tlsEnabled
    ? {
        tls: loadTlsFiles()
      }
    : {})
});

logger.withContext({
  service: "ai-service"
}).withMetadata({
  listenAddress: `${aiServiceConfig.protocol}://${aiServiceConfig.host}:${app.server?.port ?? aiServiceConfig.port}`,
  publicAddress: `${aiServiceConfig.protocol}://${aiServiceConfig.publicHost}:${app.server?.port ?? aiServiceConfig.port}`,
  transcriptionProviders: {
    whisperlive: aiServiceConfig.transcription.providers.whisperlive.url,
    sarvam: aiServiceConfig.transcription.providers.sarvam.url,
    openai: aiServiceConfig.transcription.providers.openai.baseUrl
  },
  openai: {
    baseUrl: aiServiceConfig.openai.baseUrl,
    models: llmTool.getModels()
  }
}).info("service.started");
