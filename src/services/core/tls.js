import express from "express";
import { sendError } from "../../errors.js";
import { isLoopback, normalizeAddress } from "../../network.js";

// Core's (Core-Backend #377): the root certificate of this backend's local https (tls/certificates.js), public part
// only, PEM. The launcher on this PC fetches it for its opt-in "Trust the local backend's certificate", which adds it to
// the user's trusted roots so the purchase flow's browser accepts https://127.0.0.1 on 7.00 and later. Only this PC is
// answered, by the connection's own address (not X-Forwarded-For): another machine, or one a reverse proxy here
// forwarded, has no use for this PC's root.
export function coreTlsRoutes(context = {}) {
  const router = express.Router();

  router.get("/core/api/tls/root.crt", async (req, res) => {
    const forwarded = req.headers["x-forwarded-for"] !== undefined || req.headers.forwarded !== undefined;
    if (!isLoopback(normalizeAddress(req.socket?.remoteAddress)) || forwarded) {
      return sendError(res, 403, "errors.com.epicgames.common.missing_permission", "The backend's root certificate is only given to its own PC");
    }
    const set = await context.tls?.ready?.();
    if (!set) return sendError(res, 404, "errors.com.epicgames.common.not_found", "This backend has no local https certificate");
    res.set("Cache-Control", "no-store");
    res.set("X-Core-Root-Thumbprint", set.rootThumbprint);
    res.type("application/x-pem-file").send(set.rootCert);
  });

  return router;
}
