// MCP notifications for a player who isn't the one calling (a gifted XP boost), handed over with their next client
// command's response. Kept in memory: a restart drops undelivered ones.
export function createMailbox() {
  const boxes = new Map();
  return {
    send(accountId, notification) {
      if (!boxes.has(accountId)) boxes.set(accountId, []);
      boxes.get(accountId).push(notification);
    },
    take(accountId) {
      const waiting = boxes.get(accountId) ?? [];
      boxes.delete(accountId);
      return waiting;
    }
  };
}
