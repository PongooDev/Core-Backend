// The OAuth client Core's gameservers use for MCP's "DedicatedServer" service permission. The Cert build has the
// permission's users (UFortMcpResource::Dispatch for world/info and world/validate, the dedicated_server profile
// commands) but no entry for it; CoreV2 restores the entry with this client (Core's choice: Epic's id and secret aren't
// in the binary). Its tokens come from client_credentials with Basic id:secret.
export const dedicatedServerClient = { id: "313dfed3ec3023e52d3be9dda178bdfa", secret: "111aa434a6780d54f5cf759149639f20" };

export const isDedicatedServerToken = (session) => session?.clientId === dedicatedServerClient.id && !session.accountId;
