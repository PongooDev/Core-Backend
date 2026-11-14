// messageVars: the error's arguments, as Epic's services sent them (the gifting screen reads a gift's refused receivers
// from them: store/gifting.js).
export function sendError(res, status, errorCode, errorMessage, messageVars) {
  res.status(status).json({ errorCode, errorMessage, ...(Array.isArray(messageVars) ? { messageVars } : {}) });
}

export function notFound(res, url) {
  sendError(res, 404, "errors.com.epicgames.common.not_found", `Sorry the resource ${url} could not be found`);
}

// Thrown by an MCP command to refuse it: nothing it changed is saved, and the client gets a 400 with this code.
export class McpError extends Error {
  constructor(errorCode, message, messageVars) {
    super(message);
    this.errorCode = errorCode;
    if (messageVars) this.messageVars = messageVars;
  }
}
