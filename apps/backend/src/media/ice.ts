import { createHmac } from "node:crypto";
import type { IceServerBundle, IceServerDefinition } from "@mote/models";

export interface IceConfig {
  stunUrls: string[];
  turnUrls: string[];
  turnTlsUrls: string[];
  turnStaticAuthSecret: string;
  turnCredentialTtlSeconds: number;
}

const createTimedTurnCredential = (
  secret: string,
  participantId: string,
  ttlSeconds: number
) => {
  const expiresAtUnix = Math.floor(Date.now() / 1000) + ttlSeconds;
  const username = `${expiresAtUnix}:${participantId}`;
  const credential = createHmac("sha1", secret).update(username).digest("base64");

  return {
    username,
    credential,
    expiresAt: new Date(expiresAtUnix * 1000).toISOString()
  };
};

export const createIceServerBundle = (
  config: IceConfig,
  participantId?: string
): IceServerBundle => {
  const servers: IceServerDefinition[] = [];

  if (config.stunUrls.length > 0) {
    servers.push({
      urls: config.stunUrls
    });
  }

  const turnUrls = [...config.turnUrls, ...config.turnTlsUrls];
  const shouldIncludeTurn =
    participantId &&
    turnUrls.length > 0 &&
    config.turnStaticAuthSecret.trim().length > 0 &&
    config.turnCredentialTtlSeconds > 0;

  if (shouldIncludeTurn) {
    const timedCredential = createTimedTurnCredential(
      config.turnStaticAuthSecret,
      participantId,
      config.turnCredentialTtlSeconds
    );

    servers.push({
      urls: turnUrls,
      username: timedCredential.username,
      credential: timedCredential.credential,
      credentialType: "password"
    });

    return {
      servers,
      expiresAt: timedCredential.expiresAt,
      ttlSeconds: config.turnCredentialTtlSeconds
    };
  }

  return {
    servers,
    expiresAt: null,
    ttlSeconds: 0
  };
};
