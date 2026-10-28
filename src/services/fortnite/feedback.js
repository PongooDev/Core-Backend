import express from "express";
import { requireAuth } from "../../accounts/auth.js";

// The front end's Send Feedback (1.7.2, sub_2CF38D0) posts a multipart form: feedbacktype, displayname, email,
// accountid, engineversion, platform, gamebackend, gamename, subgamename, subject, feedbackbody, and a screenshot
// (image/jpg), the zipped client log and the hardware survey.
export function feedbackRoutes({ tokens, reports, accounts }) {
  const router = express.Router();

  router.post("/fortnite/api/feedback/:kind", requireAuth(tokens), async (req, res) => {
    try {
      const url = `http://${req.headers.host || "localhost"}${req.originalUrl || req.url}`;
      const webReq = new Request(url, {
        method: req.method,
        headers: req.headers,
        body: req,
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

      const accountId = fields.accountid || req.session?.accountId;
      const displayName = fields.displayname || req.session?.displayName || (accountId && accounts?.get ? accounts.get(accountId)?.displayName : undefined);

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
    } catch {
      // If parsing fails, resume stream to prevent hanging sockets
      req.resume();
    }

    res.status(204).end();
  });

  return router;
}
