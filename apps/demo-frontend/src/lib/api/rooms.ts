import type {
  CreateRoomResponse,
  JoinRoomResponse,
  RoomPolicy,
  RoomResponseEnvelope,
  TranscriptionProvider,
  TranscriptionProviderStatusResponse
} from "@mote/models";
import { logger } from "../logger";

export const parseResponse = async <T>(response: Response): Promise<T> => {
  const data = await response.json();
  const responseLogger = logger.withContext({
    subsystem: "rooms_api",
    status: response.status,
    ok: response.ok,
    url: response.url
  }).withMetadata({
    responseBody: data
  });

  if (!response.ok) {
    responseLogger.error("http.response.error", {
      error: new Error(data.message ?? "Request failed.")
    });
    throw new Error(data.message ?? "Request failed.");
  }

  responseLogger.info("http.response.out");
  return data as T;
};

export const createRoomsApi = (backendUrl: string) => ({
  loadRoom: (code: string, participantId?: string | null) => {
    const url = new URL(`${backendUrl}/rooms/${code}`);

    if (participantId) {
      url.searchParams.set("participantId", participantId);
    }

    logger.withContext({
      subsystem: "rooms_api",
      method: "GET",
      route: "/rooms/:code"
    }).withMetadata({
      roomCode: code,
      participantId: participantId ?? null,
      requestUrl: url.toString()
    }).info("http.request.out");

    return fetch(url).then((response) =>
      parseResponse<RoomResponseEnvelope>(response)
    );
  },
  loadTranscriptionProviderStatuses: () => {
    const requestUrl = `${backendUrl}/transcription/providers/status`;
    logger.withContext({
      subsystem: "rooms_api",
      method: "GET",
      route: "/transcription/providers/status"
    }).withMetadata({
      requestUrl
    }).info("http.request.out");

    return fetch(requestUrl).then((response) =>
      parseResponse<TranscriptionProviderStatusResponse>(response)
    );
  },
  createRoom: (
    displayName: string,
    meetingTitle: string,
    transcriptionProvider: TranscriptionProvider,
    agenda: string[],
    policy: Partial<RoomPolicy>
  ) => {
    const payload = {
      displayName,
      meetingTitle: meetingTitle.trim() || undefined,
      transcriptionProvider,
      agenda,
      policy
    };
    logger.withContext({
      subsystem: "rooms_api",
      method: "POST",
      route: "/rooms"
    }).withMetadata({
      requestUrl: `${backendUrl}/rooms`,
      requestBody: payload
    }).info("http.request.out");

    return fetch(`${backendUrl}/rooms`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    }).then((response) => parseResponse<CreateRoomResponse>(response));
  },
  joinRoom: (code: string, displayName: string) => {
    const normalizedCode = code.trim().toLowerCase();
    const requestUrl = `${backendUrl}/rooms/${normalizedCode}`;
    const payload = { displayName };
    logger.withContext({
      subsystem: "rooms_api",
      method: "POST",
      route: "/rooms/:code"
    }).withMetadata({
      roomCode: normalizedCode,
      requestUrl,
      requestBody: payload
    }).info("http.request.out");

    return fetch(requestUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    }).then((response) => parseResponse<JoinRoomResponse>(response));
  },
  leaveRoom: async (code: string, participantId: string) => {
    const normalizedCode = code.trim().toLowerCase();
    const requestUrl = `${backendUrl}/rooms/${normalizedCode}/leave`;
    const payload = { participantId };
    logger.withContext({
      subsystem: "rooms_api",
      method: "POST",
      route: "/rooms/:code/leave"
    }).withMetadata({
      roomCode: normalizedCode,
      requestUrl,
      requestBody: payload
    }).info("http.request.out");

    await fetch(requestUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true
    });
  }
});
