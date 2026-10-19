export function sendError(res, status, errorCode, errorMessage) {
  res.status(status).json({ errorCode, errorMessage });
}

export function notFound(res, url) {
  sendError(res, 404, "errors.com.epicgames.common.not_found", `Sorry the resource ${url} could not be found`);
}

// Thrown by an MCP command to refuse it: nothing it changed is saved, and the client gets a 400 with this code.
export class McpError extends Error {
  constructor(errorCode, message) {
    super(message);
    this.errorCode = errorCode;
  }
}
