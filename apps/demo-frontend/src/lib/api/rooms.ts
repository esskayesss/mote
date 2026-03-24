import type {
  CreateRoomResponse,
  JoinRoomResponse,
  RoomResponseEnvelope
} from "@mote/models";

export const parseResponse = async <T>(response: Response): Promise<T> => {
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message ?? "Request failed.");
  }

  return data as T;
};

export const createRoomsApi = (backendUrl: string) => ({
  loadRoom: (code: string, participantId?: string | null) => {
    const url = new URL(`${backendUrl}/rooms/${code}`);

    if (participantId) {
      url.searchParams.set("participantId", participantId);
    }

    return fetch(url).then((response) =>
      parseResponse<RoomResponseEnvelope>(response)
    );
  },
  createRoom: (displayName: string, agenda: string[]) =>
    fetch(`${backendUrl}/rooms`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName, agenda })
    }).then((response) => parseResponse<CreateRoomResponse>(response)),
  joinRoom: (code: string, displayName: string) =>
    fetch(`${backendUrl}/rooms/${code.trim().toLowerCase()}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName })
    }).then((response) => parseResponse<JoinRoomResponse>(response)),
  leaveRoom: async (code: string, participantId: string) => {
    await fetch(`${backendUrl}/rooms/${code.trim().toLowerCase()}/leave`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ participantId }),
      keepalive: true
    });
  }
});
