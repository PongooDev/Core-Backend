import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { get, post, send, startBackend, userLogin } from "./helpers.js";

const admin = (backend, path, body) => (body === undefined
  ? get(backend.port, `/admin/api${path}`)
  : post(backend.port, `/admin/api${path}`, undefined, body));

test("Send Feedback saves report and attachments, accessible and manageable via admin panel", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-reports-test-"));
  const backend = await startBackend({ dataDir });

  try {
    const player = await userLogin(backend.port, "ReportPlayer");
    const boundary = "---------------------------testboundary12345";
    const sampleJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);

    const multipartBody = Buffer.concat([
      Buffer.from([
        `--${boundary}`,
        'Content-Disposition: form-data; name="feedbacktype"',
        "",
        "Bug",
        `--${boundary}`,
        'Content-Disposition: form-data; name="subject"',
        "",
        "Falling through floor in Stonewood",
        `--${boundary}`,
        'Content-Disposition: form-data; name="feedbackbody"',
        "",
        "When jumping near the storm shield console, the player fell into the void.",
        `--${boundary}`,
        'Content-Disposition: form-data; name="platform"',
        "",
        "Windows",
        `--${boundary}`,
        'Content-Disposition: form-data; name="subgamename"',
        "",
        "Campaign",
        `--${boundary}`,
        'Content-Disposition: form-data; name="screenshot"; filename="stonewood_bug.jpg"',
        "Content-Type: image/jpeg",
        "",
        ""
      ].join("\r\n")),
      sampleJpeg,
      Buffer.from(`\r\n--${boundary}--\r\n`)
    ]);

    // 1. Post feedback as authenticated client
    const response = await send({
      host: "127.0.0.1",
      port: backend.port,
      method: "POST",
      path: "/fortnite/api/feedback/usertext",
      headers: {
        Authorization: `bearer ${player.token}`,
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        "Content-Length": multipartBody.length
      }
    }, multipartBody);

    assert.equal(response.status, 204);

    // 2. Admin lists reports
    const listRes = await admin(backend, "/reports");
    assert.equal(listRes.status, 200);
    assert.equal(listRes.body.length, 1);
    const summary = listRes.body[0];
    assert.equal(summary.subject, "Falling through floor in Stonewood");
    assert.equal(summary.feedbackType, "Bug");
    assert.equal(summary.platform, "Windows");
    assert.equal(summary.displayName, "ReportPlayer");
    assert.equal(summary.hasScreenshot, true);
    assert.equal(summary.attachmentsCount, 1);

    // 3. Admin gets full report details
    const detailRes = await admin(backend, `/reports/${summary.id}`);
    assert.equal(detailRes.status, 200);
    assert.equal(detailRes.body.id, summary.id);
    assert.equal(detailRes.body.body, "When jumping near the storm shield console, the player fell into the void.");
    assert.equal(detailRes.body.subGameName, "Campaign");
    assert.equal(detailRes.body.attachments.length, 1);
    assert.equal(detailRes.body.attachments[0].name, "stonewood_bug.jpg");

    // 4. Admin downloads attachment
    const attRes = await get(backend.port, `/admin/api/reports/${summary.id}/attachment/stonewood_bug.jpg`);
    assert.equal(attRes.status, 200);
    assert.ok(attRes.headers["content-type"].includes("image/jpeg"));
    assert.ok(attRes.body);

    // 5. Admin deletes report
    const delRes = await send({
      host: "127.0.0.1",
      port: backend.port,
      method: "DELETE",
      path: `/admin/api/reports/${summary.id}`,
      headers: { "Content-Type": "application/json" }
    });
    assert.equal(delRes.status, 200);

    // 6. Verify list is now empty and attachment is 404
    const emptyList = await admin(backend, "/reports");
    assert.equal(emptyList.body.length, 0);

    const att404 = await get(backend.port, `/admin/api/reports/${summary.id}/attachment/stonewood_bug.jpg`);
    assert.equal(att404.status, 404);
  } finally {
    backend.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("reporting a player prefixes subject with 'Player: ' and resolves the target player account", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-player-reports-test-"));
  const backend = await startBackend({ dataDir });

  try {
    const reporter = await userLogin(backend.port, "HonestPlayer");
    const target = await userLogin(backend.port, "CheaterJones");

    const boundary = "---------------------------boundary98765";
    const bodyText = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="feedbacktype"',
      "",
      "Player",
      `--${boundary}`,
      'Content-Disposition: form-data; name="subject"',
      "",
      "CheaterJones",
      `--${boundary}`,
      'Content-Disposition: form-data; name="feedbackbody"',
      "",
      "Using speed hacks in Battle Royale",
      `--${boundary}--`,
      ""
    ].join("\r\n");

    const res = await send({
      host: "127.0.0.1",
      port: backend.port,
      method: "POST",
      path: "/fortnite/api/feedback/usertext",
      headers: {
        Authorization: `bearer ${reporter.token}`,
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        "Content-Length": Buffer.byteLength(bodyText)
      }
    }, bodyText);

    assert.equal(res.status, 204);

    // Verify in admin reports list
    const reports = (await admin(backend, "/reports")).body;
    assert.equal(reports.length, 1);
    assert.equal(reports[0].subject, "Player: CheaterJones");
    assert.equal(reports[0].reportedPlayer, "CheaterJones");
    assert.equal(reports[0].reportedAccountId, target.accountId);
    assert.equal(reports[0].reportedDisplayName, "CheaterJones");

    // Verify in report details
    const detail = (await admin(backend, `/reports/${reports[0].id}`)).body;
    assert.equal(detail.subject, "Player: CheaterJones");
    assert.equal(detail.reportedPlayer, "CheaterJones");
    assert.equal(detail.reportedAccountId, target.accountId);
    assert.equal(detail.reportedDisplayName, "CheaterJones");

    // Report a non-existent player
    const nonExistentBody = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="feedbacktype"',
      "",
      "Player",
      `--${boundary}`,
      'Content-Disposition: form-data; name="subject"',
      "",
      "NonExistentGhost",
      `--${boundary}`,
      'Content-Disposition: form-data; name="feedbackbody"',
      "",
      "Some report",
      `--${boundary}--`,
      ""
    ].join("\r\n");

    await send({
      host: "127.0.0.1",
      port: backend.port,
      method: "POST",
      path: "/fortnite/api/feedback/usertext",
      headers: {
        Authorization: `bearer ${reporter.token}`,
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        "Content-Length": Buffer.byteLength(nonExistentBody)
      }
    }, nonExistentBody);

    const ghostReport = (await admin(backend, "/reports")).body.find((r) => r.reportedPlayer === "NonExistentGhost");
    assert.ok(ghostReport);
    assert.equal(ghostReport.subject, "Player: NonExistentGhost");
    assert.equal(ghostReport.reportedAccountId, undefined);
  } finally {
    backend.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
