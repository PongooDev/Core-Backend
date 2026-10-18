export function sendError(res, status, errorCode, errorMessage) {
  res.status(status).json({ errorCode, errorMessage });
}

export function notFound(res, url) {
  sendError(res, 404, "errors.com.epicgames.common.not_found", `Sorry the resource ${url} could not be found`);
}
