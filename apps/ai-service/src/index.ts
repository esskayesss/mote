import { AgendaNormalizerAgent } from "./agents/agenda-normalizer-agent";
import { createApp } from "./http/create-app";
import { aiServiceConfig, loadTlsFiles } from "./config";
import { OpenAiChatCompletionsTool } from "./tools/llm/openai-chat-completions-tool";
import { BackendTranscriptPublisher } from "./transcription/backend-publisher";
import { TranscriptionRuntime } from "./transcription/runtime";
import { createRefineAgendaWorkflow } from "./workflows/agenda/refine-agenda-workflow";

const publisher = new BackendTranscriptPublisher(
  aiServiceConfig.backendUrl,
  aiServiceConfig.internalApiSecret
);

const transcriptionRuntime = new TranscriptionRuntime(
  publisher,
  aiServiceConfig.transcription
);
const llmTool = new OpenAiChatCompletionsTool(aiServiceConfig.llm);
const refineAgendaWorkflow = createRefineAgendaWorkflow(llmTool);
const agendaNormalizerAgent = new AgendaNormalizerAgent(refineAgendaWorkflow);

const app = createApp(
  transcriptionRuntime,
  aiServiceConfig.backendUrl,
  (input) => agendaNormalizerAgent.normalize(input)
).listen({
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
console.log(
  `AI service agenda model ${aiServiceConfig.llm.model} @ ${aiServiceConfig.llm.baseUrl}`
);
