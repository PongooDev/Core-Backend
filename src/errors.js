export function sendError(res, status, errorCode, errorMessage, numericErrorCode, messageVars = []) {
  res.status(status).json({
    errorCode,
    errorMessage,
    messageVars,
    numericErrorCode,
    originatingService: "any",
    intent: "prod"
  });
}

export function notFound(res, url) {
  sendError(res, 404, "errors.com.epicgames.common.not_found",
    "Sorry the resource you were trying to find could not be found", 1004, [url]);
}
