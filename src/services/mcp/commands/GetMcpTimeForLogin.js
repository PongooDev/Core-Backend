export function getMcpTimeForLogin({ notifications }) {
  notifications.push({ primary: true, mcpTime: new Date().toISOString() });
}
