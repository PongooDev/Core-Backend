import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { get, post, send, startBackend, userLogin } from "./helpers.js";
import { clearFeedbackRateLimits } from "../src/services/fortnite/feedback.js";

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
    assert.equal(attRes.headers["x-content-type-options"], "nosniff");
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

test("path traversal attempts with .. or . in report ID are rejected and do not delete or access dataDir", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-traversal-test-"));
  const backend = await startBackend({ dataDir });

  try {
    // Attempt to DELETE /admin/api/reports/..
    const delDotDot = await send({
      host: "127.0.0.1",
      port: backend.port,
      method: "DELETE",
      path: "/admin/api/reports/..",
      headers: { "Content-Type": "application/json" }
    });
    assert.equal(delDotDot.status, 404);
    assert.ok(fs.existsSync(dataDir), "dataDir must not be deleted");

    // Attempt to DELETE /admin/api/reports/.
    const delDot = await send({
      host: "127.0.0.1",
      port: backend.port,
      method: "DELETE",
      path: "/admin/api/reports/.",
      headers: { "Content-Type": "application/json" }
    });
    assert.equal(delDot.status, 404);

    // Attempt to GET /admin/api/reports/..
    const getDotDot = await get(backend.port, "/admin/api/reports/..");
    assert.equal(getDotDot.status, 404);

    // Attempt to access attachment via traversal
    const getAtt = await get(backend.port, "/admin/api/reports/../attachment/report.json");
    assert.equal(getAtt.status, 404);
  } finally {
    backend.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("feedback upload rejects oversized payloads over 32 MB cap", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-oversized-test-"));
  const backend = await startBackend({ dataDir });

  try {
    const player = await userLogin(backend.port, "BigUploader");

    // 1. Rejected via Content-Length > 32 MB
    const resHeader = await send({
      host: "127.0.0.1",
      port: backend.port,
      method: "POST",
      path: "/fortnite/api/feedback/usertext",
      headers: {
        Authorization: `bearer ${player.token}`,
        "Content-Type": "multipart/form-data; boundary=testboundary",
        "Content-Length": 35 * 1024 * 1024,
        Connection: "close"
      }
    }, "");
    assert.equal(resHeader.status, 413);

    // 2. Rejected via streaming chunks > 32 MB without Content-Length
    const boundary = "---------------------------boundaryHuge";
    const resStream = await new Promise((resolve) => {
      const clientReq = http.request({
        host: "127.0.0.1",
        port: backend.port,
        method: "POST",
        path: "/fortnite/api/feedback/usertext",
        headers: {
          Authorization: `bearer ${player.token}`,
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "Transfer-Encoding": "chunked",
          Connection: "close"
        }
      }, (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve({ status: res.statusCode, body: data }));
      });

      clientReq.on("error", () => {});

      clientReq.write(`--${boundary}\r\nContent-Disposition: form-data; name="bigfile"; filename="huge.bin"\r\n\r\n`);
      const chunk = Buffer.alloc(1024 * 1024, 0x61); // 1 MB chunk
      for (let i = 0; i < 33; i++) {
        clientReq.write(chunk);
      }
      clientReq.write(`\r\n--${boundary}--\r\n`);
      clientReq.end();
    });

    assert.equal(resStream.status, 413);

    // Ensure no report was written
    const listRes = await admin(backend, "/reports");
    assert.equal(listRes.body.length, 0);
  } finally {
    backend.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("reporter cannot be spoofed via client form fields", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-spoof-test-"));
  const backend = await startBackend({ dataDir });

  try {
    const player = await userLogin(backend.port, "ActualReporter");
    const boundary = "---------------------------boundarySpoof";
    const body = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="accountid"',
      "",
      "SpoofedVictimAccountId123",
      `--${boundary}`,
      'Content-Disposition: form-data; name="displayname"',
      "",
      "SpoofedVictimName",
      `--${boundary}`,
      'Content-Disposition: form-data; name="subject"',
      "",
      "Fake bug report",
      `--${boundary}`,
      'Content-Disposition: form-data; name="feedbackbody"',
      "",
      "Attempting to impersonate someone else",
      `--${boundary}--`,
      ""
    ].join("\r\n");

    const res = await send({
      host: "127.0.0.1",
      port: backend.port,
      method: "POST",
      path: "/fortnite/api/feedback/usertext",
      headers: {
        Authorization: `bearer ${player.token}`,
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        "Content-Length": Buffer.byteLength(body)
      }
    }, body);

    assert.equal(res.status, 204);

    const reports = (await admin(backend, "/reports")).body;
    assert.equal(reports.length, 1);
    assert.equal(reports[0].accountId, player.accountId);
    assert.equal(reports[0].displayName, "ActualReporter");

    const detail = (await admin(backend, `/reports/${reports[0].id}`)).body;
    assert.equal(detail.accountId, player.accountId);
    assert.equal(detail.displayName, "ActualReporter");
  } finally {
    backend.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("rate limits feedback submissions per player account", async () => {
  clearFeedbackRateLimits();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-ratelimit-test-"));
  const backend = await startBackend({ dataDir });

  try {
    const playerA = await userLogin(backend.port, "SpammerPlayer");
    const playerB = await userLogin(backend.port, "NormalPlayer");

    const boundary = "---------------------------boundaryRate";
    const body = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="subject"',
      "",
      "Rate test",
      `--${boundary}--`,
      ""
    ].join("\r\n");

    const sendReport = (token) => send({
      host: "127.0.0.1",
      port: backend.port,
      method: "POST",
      path: "/fortnite/api/feedback/usertext",
      headers: {
        Authorization: `bearer ${token}`,
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        "Content-Length": Buffer.byteLength(body)
      }
    }, body);

    // Player A sends 5 reports successfully
    for (let i = 0; i < 5; i++) {
      const res = await sendReport(playerA.token);
      assert.equal(res.status, 204);
    }

    // 6th report from Player A is rate limited
    const res6 = await sendReport(playerA.token);
    assert.equal(res6.status, 429);

    // Player B can still submit
    const resB = await sendReport(playerB.token);
    assert.equal(resB.status, 204);
  } finally {
    backend.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("attachment serving sends security headers, unique filenames, and reserves report.json", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-attach-sec-test-"));
  const backend = await startBackend({ dataDir });

  try {
    const player = await userLogin(backend.port, "AttachTester");
    const boundary = "---------------------------boundaryAttach";

    const multipart = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="subject"',
      "",
      "Attachment test",
      `--${boundary}`,
      'Content-Disposition: form-data; name="file1"; filename="duplicate.txt"',
      "Content-Type: text/plain",
      "",
      "first file content",
      `--${boundary}`,
      'Content-Disposition: form-data; name="file2"; filename="duplicate.txt"',
      "Content-Type: text/plain",
      "",
      "second file content",
      `--${boundary}`,
      'Content-Disposition: form-data; name="file3"; filename="report.json"',
      "Content-Type: application/json",
      "",
      '{"fake":"report"}',
      `--${boundary}`,
      'Content-Disposition: form-data; name="file4"; filename="xss.html"',
      "Content-Type: text/html",
      "",
      "<script>alert(1)</script>",
      `--${boundary}`,
      'Content-Disposition: form-data; name="file5"; filename="screenshot.png"',
      "Content-Type: image/png",
      "",
      "fake image bytes",
      `--${boundary}--`,
      ""
    ].join("\r\n");

    const res = await send({
      host: "127.0.0.1",
      port: backend.port,
      method: "POST",
      path: "/fortnite/api/feedback/usertext",
      headers: {
        Authorization: `bearer ${player.token}`,
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        "Content-Length": Buffer.byteLength(multipart)
      }
    }, multipart);
    assert.equal(res.status, 204);

    const reports = (await admin(backend, "/reports")).body;
    assert.equal(reports.length, 1);
    const detail = (await admin(backend, `/reports/${reports[0].id}`)).body;

    const names = detail.attachments.map((a) => a.name);
    // duplicate.txt was renamed to duplicate_1.txt for the second file
    assert.ok(names.includes("duplicate.txt"));
    assert.ok(names.includes("duplicate_1.txt"));
    // report.json attachment was renamed so it didn't overwrite metadata
    assert.ok(names.includes("report_1.json"));
    assert.ok(!names.includes("report.json"));

    // Check downloading xss.html
    const htmlRes = await get(backend.port, `/admin/api/reports/${detail.id}/attachment/xss.html`);
    assert.equal(htmlRes.status, 200);
    assert.equal(htmlRes.headers["x-content-type-options"], "nosniff");
    assert.equal(htmlRes.headers["content-disposition"], 'attachment; filename="xss.html"');

    // Check downloading report.json directly as an attachment is rejected (404)
    const reportJsonRes = await get(backend.port, `/admin/api/reports/${detail.id}/attachment/report.json`);
    assert.equal(reportJsonRes.status, 404);

    // Check downloading screenshot.png does not force attachment disposition
    const pngRes = await get(backend.port, `/admin/api/reports/${detail.id}/attachment/screenshot.png`);
    assert.equal(pngRes.status, 200);
    assert.equal(pngRes.headers["x-content-type-options"], "nosniff");
    assert.equal(pngRes.headers["content-disposition"], undefined);
  } finally {
    backend.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
