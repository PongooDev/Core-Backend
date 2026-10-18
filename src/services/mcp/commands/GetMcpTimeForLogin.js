export function getMcpTimeForLogin({ notifications }) {
  notifications.push({ type: "GetMcpTimeForPlayerNotification", primary: true, mcpTime: new Date().toISOString() });
}
