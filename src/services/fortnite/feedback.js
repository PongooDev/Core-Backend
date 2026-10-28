import express from "express";
import { Transform } from "node:stream";
import { requireAuth } from "../../accounts/auth.js";
import { log } from "../../log.js";

const MAX_REPORT_BYTES = 32 * 1024 * 1024; // 32 MB
const MAX_REPORTS_PER_WINDOW = 5;
const REPORT_WINDOW_MS = 60 * 1000; // 1 minute

const recentReportsByAccount = new Map();

export function clearFeedbackRateLimits() {
  recentReportsByAccount.clear();
}

function isRateLimited(accountId) {
  if (!accountId) return false;
  const now = Date.now();
  const windowStart = now - REPORT_WINDOW_MS;
  const timestamps = recentReportsByAccount.get(accountId) || [];
  const recent = timestamps.filter((t) => t > windowStart);
  if (recent.length >= MAX_REPORTS_PER_WINDOW) {
    recentReportsByAccount.set(accountId, recent);
    return true;
  }
  recent.push(now);
  recentReportsByAccount.set(accountId, recent);
  return false;
}

function createByteLimitStream(maxBytes) {
  let received = 0;
  const stream = new Transform({
    transform(chunk, encoding, callback) {
      received += chunk.length;
      if (received > maxBytes) {
        const error = new Error("Payload Too Large");
        error.statusCode = 413;
        return callback(error);
      }
      callback(null, chunk);
    }
  });
  stream.on("error", () => {});
  return stream;
}

// The front end's Send Feedback (1.7.2, sub_2CF38D0) posts a multipart form: feedbacktype, displayname, email,
// accountid, engineversion, platform, gamebackend, gamename, subgamename, subject, feedbackbody, and a screenshot
// (image/jpg), the zipped client log and the hardware survey.
export function feedbackRoutes({ tokens, reports, accounts }) {
  const router = express.Router();

  router.post("/fortnite/api/feedback/:kind", requireAuth(tokens), async (req, res) => {
    const accountId = req.session?.accountId;
    if (isRateLimited(accountId)) {
      req.resume();
      return res.status(429).json({ error: "Too many feedback reports. Please wait before submitting another report." });
    }

    const contentLength = Number(req.headers["content-length"]);
    if (Number.isFinite(contentLength) && contentLength > MAX_REPORT_BYTES) {
      req.resume();
      res.setHeader("Connection", "close");
      return res.status(413).json({ error: "Payload Too Large" });
    }

    let exceededLimit = false;
    try {
      const limitedStream = req.pipe(createByteLimitStream(MAX_REPORT_BYTES));
      limitedStream.on("error", (err) => {
        if (err.statusCode === 413) exceededLimit = true;
      });

      const url = `http://${req.headers.host || "localhost"}${req.originalUrl || req.url}`;
      const webReq = new Request(url, {
        method: req.method,
        headers: req.headers,
        body: limitedStream,
        duplex: "half"
      });

      const formData = await webReq.formData();
      const fields = {};
      const attachments = [];

      for (const [key, value] of formData.entries()) {
        if (typeof value === "string") {
          fields[key] = value;
        } else if (value && typeof value === "object" && typeof value.arrayBuffer === "function") {
          const buffer = Buffer.from(await value.arrayBuffer());
          attachments.push({
            name: value.name || `${key}.bin`,
            type: value.type || "application/octet-stream",
            buffer
          });
        }
      }

      const account = accountId && accounts?.get ? accounts.get(accountId) : null;
      const displayName = account?.displayName || req.session?.displayName || accountId;

      let subject = String(fields.subject ?? "").trim();
      const feedbackType = String(fields.feedbacktype ?? "");
      const isPlayerReport = /player/i.test(feedbackType) || /^player\s*:/i.test(subject) || Boolean(fields.reportedplayer);

      let reportedPlayer = fields.reportedplayer || fields.reportedplayername || "";
      if (isPlayerReport) {
        if (!reportedPlayer) {
          reportedPlayer = subject.replace(/^player\s*:\s*/i, "").trim();
        }
        subject = reportedPlayer ? `Player: ${reportedPlayer}` : (subject ? (subject.startsWith("Player:") ? subject : `Player: ${subject}`) : "Player: (Unknown)");
      }

      let reportedAccount = null;
      if (reportedPlayer && accounts) {
        reportedAccount = accounts.findByName?.(reportedPlayer) || accounts.get?.(reportedPlayer) || null;
      }

      if (reports?.add) {
        reports.add({
          kind: req.params.kind,
          feedbackType: fields.feedbacktype,
          subject,
          body: fields.feedbackbody,
          accountId,
          displayName,
          claimedAccountId: fields.accountid && fields.accountid !== accountId ? fields.accountid : undefined,
          claimedDisplayName: fields.displayname && fields.displayname !== displayName ? fields.displayname : undefined,
          email: fields.email,
          platform: fields.platform,
          engineVersion: fields.engineversion,
          gameName: fields.gamename,
          subGameName: fields.subgamename,
          gameBackend: fields.gamebackend,
          reportedPlayer: reportedPlayer || undefined,
          reportedAccountId: reportedAccount?.id,
          reportedDisplayName: reportedAccount?.displayName
        }, attachments);
      }
    } catch (error) {
      log("Feedback", `Failed to parse form: ${error?.message || error}`);
      req.resume();
      if (exceededLimit || error?.statusCode === 413 || error?.message?.includes("Payload Too Large")) {
        res.setHeader("Connection", "close");
        return res.status(413).json({ error: "Payload Too Large" });
      }
    }

    res.status(204).end();
  });

  return router;
}
