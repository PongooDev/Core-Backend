import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { readJson, writeJson } from "../json-file.js";

const REPORT_ID_PATTERN = /^\d+_[0-9a-f]{8}$/;

export function createReportStore(dataDir) {
  const dir = dataDir && path.join(dataDir, "reports");
  if (dir && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  return {
    add(fields, attachments = []) {
      const id = `${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
      const reportDir = dir && path.join(dir, id);
      if (reportDir) fs.mkdirSync(reportDir, { recursive: true });

      const savedAttachments = [];
      const usedNames = new Set(["report.json"]);
      for (const att of attachments) {
        if (!att?.name || !att?.buffer) continue;
        let baseName = path.basename(att.name).replace(/[^a-zA-Z0-9._-]/g, "_");
        if (!baseName || baseName === "." || baseName === "..") baseName = "attachment.bin";

        const ext = path.extname(baseName);
        const stem = path.basename(baseName, ext);
        let safeName = baseName;
        let counter = 1;
        while (usedNames.has(safeName.toLowerCase())) {
          safeName = `${stem}_${counter++}${ext}`;
        }
        usedNames.add(safeName.toLowerCase());

        if (reportDir) {
          fs.writeFileSync(path.join(reportDir, safeName), att.buffer);
        }
        savedAttachments.push({
          name: safeName,
          size: att.buffer.length,
          type: att.type || "application/octet-stream"
        });
      }

      const report = {
        id,
        time: fields.time || new Date().toISOString(),
        kind: String(fields.kind ?? "usertext"),
        feedbackType: fields.feedbackType ? String(fields.feedbackType) : undefined,
        subject: String(fields.subject ?? ""),
        body: String(fields.body ?? fields.feedbackbody ?? ""),
        accountId: fields.accountId ? String(fields.accountId) : undefined,
        displayName: fields.displayName ? String(fields.displayName) : undefined,
        claimedAccountId: fields.claimedAccountId ? String(fields.claimedAccountId) : undefined,
        claimedDisplayName: fields.claimedDisplayName ? String(fields.claimedDisplayName) : undefined,
        email: fields.email ? String(fields.email) : undefined,
        platform: fields.platform ? String(fields.platform) : undefined,
        engineVersion: fields.engineVersion ? String(fields.engineVersion) : undefined,
        gameName: fields.gameName ? String(fields.gameName) : undefined,
        subGameName: fields.subGameName ? String(fields.subGameName) : undefined,
        gameBackend: fields.gameBackend ? String(fields.gameBackend) : undefined,
        reportedPlayer: fields.reportedPlayer ? String(fields.reportedPlayer) : undefined,
        reportedAccountId: fields.reportedAccountId ? String(fields.reportedAccountId) : undefined,
        reportedDisplayName: fields.reportedDisplayName ? String(fields.reportedDisplayName) : undefined,
        attachments: savedAttachments
      };

      if (reportDir) {
        writeJson(path.join(reportDir, "report.json"), report);
      }
      return report;
    },

    list() {
      if (!dir || !fs.existsSync(dir)) return [];
      const list = [];
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        if (!REPORT_ID_PATTERN.test(entry.name)) continue;
        const reportFile = path.join(dir, entry.name, "report.json");
        if (!fs.existsSync(reportFile)) continue;
        try {
          const report = readJson(reportFile);
          list.push({
            id: report.id,
            time: report.time,
            kind: report.kind,
            feedbackType: report.feedbackType,
            subject: report.subject,
            bodySnippet: report.body?.slice(0, 100),
            accountId: report.accountId,
            displayName: report.displayName,
            platform: report.platform,
            subGameName: report.subGameName,
            reportedPlayer: report.reportedPlayer,
            reportedAccountId: report.reportedAccountId,
            reportedDisplayName: report.reportedDisplayName,
            attachmentsCount: report.attachments?.length ?? 0,
            hasScreenshot: Boolean(report.attachments?.some((a) => /\.(jpe?g|png|webp)$/i.test(a.name)))
          });
        } catch {
          // Ignore corrupted files
        }
      }
      list.sort((a, b) => String(b.time).localeCompare(String(a.time)));
      return list;
    },

    get(id) {
      if (!dir || typeof id !== "string" || !REPORT_ID_PATTERN.test(id)) return null;
      const reportFile = path.join(dir, id, "report.json");
      if (!fs.existsSync(reportFile)) return null;
      try {
        return readJson(reportFile);
      } catch {
        return null;
      }
    },

    delete(id) {
      if (!dir || typeof id !== "string" || !REPORT_ID_PATTERN.test(id)) return false;
      const reportDir = path.join(dir, id);
      if (!fs.existsSync(reportDir)) return false;
      fs.rmSync(reportDir, { recursive: true, force: true });
      return true;
    },

    attachmentPath(id, filename) {
      if (!dir || typeof id !== "string" || !REPORT_ID_PATTERN.test(id) || typeof filename !== "string") return null;
      const safeFile = path.basename(filename);
      if (safeFile.toLowerCase() === "report.json") return null;
      const filePath = path.join(dir, id, safeFile);
      if (fs.existsSync(filePath)) return filePath;
      return null;
    }
  };
}
