import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import dgram from "node:dgram";
import { once } from "node:events";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { createServer } from "../src/server.js";
import { buildRtp, createMedia, parseRtp, ulawDecode, ulawEncode } from "../src/vivox/media.js";
import { buildResponse, chooseCodec, header, headers, param, parseSdp, parseSip, splitStream, uriOf } from "../src/vivox/sip.js";
import { accountUri, channelUri, createVivoxKeys, decodeToken, signToken, userOf, verifyToken } from "../src/vivox/tokens.js";
import { dedicatedServerToken, send, userLogin } from "./helpers.js";

const agentOf = (version, changelist) => `game=Fortnite, engine=UE4, build=++Fortnite+Release-${version}-CL-${changelist}`;
const v700 = agentOf("7.00", 4629139);
const v510 = agentOf("5.10", 4225813);
const v50 = agentOf("5.0", 4214610);

// A backend whose Vivox SIP server runs too (on a free port), as main.js starts it.
async function startVivoxBackend(config = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-backend-"));
  const server = await createServer({ dataDir, requestLog: false, emptyServerWaitMs: 0, earnScoreWaitMs: 0, ...config });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const sip = config.withSip === false ? null : await server.vivox.start(0);
  return {
    dataDir,
    port: server.address().port,
    sipPort: sip?.port ?? null,
    vivox: server.vivox,
    close() {
      server.vivox.close();
      server.closeAllConnections();
      server.close();
      fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  };
}

const getAs = (port, urlPath, agent, token, extra = {}) => send({ host: "127.0.0.1", port, path: urlPath,
  headers: { "User-Agent": agent, ...(token ? { Authorization: `bearer ${token}` } : {}), ...extra } });

test("tokens: Vivox's format, e30.<base64url payload>.<base64url HMAC-SHA256>, the contract's test vector", () => {
  const payload = { iss: "core", exp: 1700000000, vxa: "login", vxi: 1, f: "sip:.abc.@core.vivox.invalid" };
  const token = signToken("test-key", payload);
  // The vector in H:\CoreWork\vivox\contract.md, checked against Python's hmac as well.
  assert.equal(token, "e30.eyJpc3MiOiJjb3JlIiwiZXhwIjoxNzAwMDAwMDAwLCJ2eGEiOiJsb2dpbiIsInZ4aSI6MSwiZiI6InNpcDouYWJjLkBjb3JlLnZpdm94LmludmFsaWQifQ.InhINmldXJHde7uN4qr-wzShXhyBSeL769h8bKoP7oA");
  const [head, body, signature] = token.split(".");
  assert.equal(head, Buffer.from("{}").toString("base64url"));
  assert.doesNotMatch(token, /[=+/]/, "base64url without padding");
  assert.deepEqual(JSON.parse(Buffer.from(body, "base64url").toString()), payload);
  assert.equal(signature, crypto.createHmac("sha256", "test-key").update(`${head}.${body}`).digest("base64url"));
  assert.deepEqual(decodeToken(token), payload);

  const at = 1700000000 * 1000 - 1000;
  assert.equal(verifyToken("test-key", token, { vxa: "login", user: ".abc.", now: at }).ok, true);
  assert.equal(verifyToken("test-key", token, { vxa: "login", user: "sip:.abc.@other", now: at }).ok, true, "the user part is what counts");
  assert.match(verifyToken("other-key", token, { now: at }).reason, /bad signature/);
  assert.match(verifyToken("test-key", token, { vxa: "join", now: at }).reason, /action login/);
  assert.match(verifyToken("test-key", token, { user: ".xyz.", now: at }).reason, /for sip:\.abc\./);
  assert.match(verifyToken("test-key", token, { now: (1700000000 + 61) * 1000 }).reason, /expired/);
  assert.equal(verifyToken("test-key", token, { now: (1700000000 + 59) * 1000 }).ok, true, "a minute of clock skew");
  assert.match(verifyToken("test-key", token, { issuer: "fnwp", now: at }).reason, /issuer core/);
  const tampered = `${head}.${Buffer.from(JSON.stringify({ ...payload, f: "sip:.xyz.@core.vivox.invalid" })).toString("base64url")}.${signature}`;
  assert.match(verifyToken("test-key", tampered, { now: at }).reason, /bad signature/);
  assert.match(verifyToken("test-key", "nope", { now: at }).reason, /not a Vivox token/);

  // FVivox's URIs: the account ".<id>.", a channel name made a URI unless it is one (7.00 0x999620).
  assert.equal(accountUri("abc", "d.invalid"), "sip:.abc.@d.invalid");
  assert.equal(accountUri(".abc.", "d.invalid"), "sip:.abc.@d.invalid");
  assert.equal(channelUri("confctl-g-Party-p1", "d.invalid"), "sip:confctl-g-Party-p1@d.invalid");
  assert.equal(channelUri("SIP:confctl-g-x@elsewhere", "d.invalid"), "SIP:confctl-g-x@elsewhere");
  assert.equal(userOf("<sip:.abc.@d;transport=udp>"), "abc");
});

test("tokens: the key is made once in the data folder and kept; mint signs login and join tokens with it", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-vivox-"));
  try {
    const keys = createVivoxKeys(dataDir);
    const saved = JSON.parse(fs.readFileSync(path.join(dataDir, "vivox.json"), "utf8"));
    assert.equal(saved.key, keys.key);
    assert.ok(keys.key.length >= 40);
    assert.equal(saved.issuer, "core");
    assert.equal(saved.domain, "core.vivox.invalid");
    assert.equal(createVivoxKeys(dataDir).key, keys.key, "the same key after a restart");

    const login = keys.mint({ action: "login", player: ".acc1." });
    const join = keys.mint({ action: "join", player: "acc1", channel: "confctl-g-match.team1" });
    assert.deepEqual(Object.keys(decodeToken(login)), ["iss", "exp", "vxa", "vxi", "f"]);
    assert.deepEqual(Object.keys(decodeToken(join)), ["iss", "exp", "vxa", "vxi", "f", "t"]);
    assert.equal(decodeToken(join).t, "sip:confctl-g-match.team1@core.vivox.invalid");
    assert.ok(decodeToken(join).vxi > decodeToken(login).vxi);
    assert.equal(keys.verify(login, { vxa: "login", user: ".acc1." }).ok, true);
    assert.equal(keys.verify(join, { vxa: "join", user: "acc1", to: "sip:confctl-g-match.team1@core.vivox.invalid" }).ok, true);
    assert.equal(keys.sipPassword(".acc1."), keys.sipPassword("acc1"));
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("lobby voice token routes: 5.10+ get {token} for their own account; older builds and the switch off keep the unknown route", async () => {
  const backend = await startVivoxBackend({ withSip: false });
  try {
    const { token, accountId } = await userLogin(backend.port, "VoicePlayer");
    const keys = createVivoxKeys(backend.dataDir);

    const login = await getAs(backend.port, `/fortnite/api/game/v2/voice/${accountId}/login`, v700, token);
    assert.equal(login.status, 200);
    assert.deepEqual(Object.keys(login.body), ["token"]);
    const loginCheck = keys.verify(login.body.token, { vxa: "login", user: `.${accountId}.` });
    assert.equal(loginCheck.ok, true, loginCheck.reason);
    assert.equal(loginCheck.payload.f, `sip:.${accountId}.@core.vivox.invalid`);

    const join = await getAs(backend.port, `/fortnite/api/game/v2/voice/${accountId}/join/abc123party`, v510, token);
    assert.equal(join.status, 200);
    const joinCheck = keys.verify(join.body.token, { vxa: "join", user: accountId });
    assert.equal(joinCheck.ok, true, joinCheck.reason);
    assert.equal(joinCheck.payload.t, "sip:confctl-g-Party-abc123party@core.vivox.invalid");

    // Another account's token, none, a bad party id.
    assert.equal((await getAs(backend.port, "/fortnite/api/game/v2/voice/someoneelse/login", v700, token)).status, 403);
    assert.equal((await getAs(backend.port, `/fortnite/api/game/v2/voice/${accountId}/login`, v700)).status, 401);
    assert.equal((await getAs(backend.port, `/fortnite/api/game/v2/voice/${accountId}/join/bad%20id`, v700, token)).status, 400);

    // 5.0's Vivox URL is in its exe: its requests stay unknown, as before.
    const old = await getAs(backend.port, `/fortnite/api/game/v2/voice/${accountId}/login`, v50, token);
    assert.equal(old.status, 404);
    assert.equal(old.body.errorCode, "errors.com.epicgames.common.not_found");

    assert.equal((await send({ host: "127.0.0.1", port: backend.port, method: "POST", path: "/admin/api/settings",
      headers: { "Content-Type": "application/json" } }, JSON.stringify({ vivoxVoice: false }))).status, 200);
    assert.equal((await getAs(backend.port, `/fortnite/api/game/v2/voice/${accountId}/login`, v700, token)).status, 404);
  } finally {
    backend.close();
  }
});

test("the gameservers' signing: a DedicatedServer token gets the key, a player's doesn't; off, enabled false", async () => {
  const backend = await startVivoxBackend({ withSip: false });
  try {
    const server = await dedicatedServerToken(backend.port);
    const player = await userLogin(backend.port, "NotAServer");
    const signing = await getAs(backend.port, "/core/api/voice/vivox/signing", v700, server);
    assert.equal(signing.status, 200);
    const keys = createVivoxKeys(backend.dataDir);
    assert.deepEqual(signing.body, { enabled: true, issuer: "core", domain: "core.vivox.invalid", key: keys.key, algorithm: "HMAC-SHA256", tokenLifetimeSeconds: 300 });
    assert.equal((await getAs(backend.port, "/core/api/voice/vivox/signing", v700, player.token)).status, 403);

    // A token the server signs as the contract says verifies here.
    const now = Math.floor(Date.now() / 1000);
    const signed = signToken(signing.body.key, { iss: "core", exp: now + 300, vxa: "join", vxi: 7, f: `sip:.${player.accountId}.@core.vivox.invalid`,
      t: "sip:confctl-g-match1.team2@core.vivox.invalid" });
    assert.equal(keys.verify(signed, { vxa: "join", user: player.accountId }).ok, true);

    const minted = await send({ host: "127.0.0.1", port: backend.port, method: "POST", path: "/core/api/voice/vivox/token",
      headers: { "User-Agent": v700, Authorization: `bearer ${server}`, "Content-Type": "application/json" } },
      JSON.stringify({ action: "join", player: `.${player.accountId}.`, channel: "confctl-g-match1.team2" }));
    assert.equal(minted.status, 200);
    assert.equal(decodeToken(minted.body.token).t, "sip:confctl-g-match1.team2@core.vivox.invalid");

    await send({ host: "127.0.0.1", port: backend.port, method: "POST", path: "/admin/api/settings", headers: { "Content-Type": "application/json" } },
      JSON.stringify({ vivoxVoice: false }));
    assert.deepEqual((await getAs(backend.port, "/core/api/voice/vivox/signing", v700, server)).body, { enabled: false });
  } finally {
    backend.close();
  }
});

test("prelogin and signin: the SIP proxy is the emulator's; a good token gets SIP credentials, a bad one an error", async () => {
  const backend = await startVivoxBackend();
  try {
    const sdk = { "User-Agent": "Vivox-SDK-4.9.0002.30406" };
    const prelogin = await send({ host: "127.0.0.1", port: backend.port, path: "/api2/viv_get_prelogin.php", headers: sdk });
    assert.equal(prelogin.status, 200);
    assert.match(prelogin.headers["content-type"], /^text\/xml/);
    const xml = prelogin.body;
    assert.match(xml, /^<\?xml version="1\.0" encoding="utf-8"\?>\r\n<VCConfiguration>/);
    assert.match(xml, new RegExp(`<DefaultSIPProxy>127\\.0\\.0\\.1:${backend.sipPort}</DefaultSIPProxy>`));
    assert.match(xml, /<DefaultRealm>core\.vivox\.invalid<\/DefaultRealm>/);
    assert.match(xml, /<DefaultAttemptUseSTUN>false<\/DefaultAttemptUseSTUN>/);
    assert.match(xml, /<PermittedCodecs>1<\/PermittedCodecs>/);
    assert.match(xml, /<WatsonSampleRate>0<\/WatsonSampleRate>/);
    assert.doesNotMatch(xml, /vivox\.com/);

    const { accountId } = await userLogin(backend.port, "SigninPlayer");
    const token = backend.vivox.keys.mint({ action: "login", player: accountId });
    const form = (fields) => send({ host: "127.0.0.1", port: backend.port, method: "POST", path: "/api2/viv_signin.php",
      headers: { ...sdk, "Content-Type": "application/x-www-form-urlencoded" } }, new URLSearchParams(fields).toString());
    const signin = await form({ userid: `.${accountId}.`, access_token: token, displayname: "SigninPlayer", send_sip_creds: "1" });
    assert.equal(signin.status, 200);
    const field = (name) => new RegExp(`<${name}>([^<]*)</${name}>`).exec(signin.body)?.[1];
    assert.equal(field("status"), "OK");
    assert.equal(field("code"), "200");
    assert.equal(field("sip_uri"), `sip:.${accountId}.@core.vivox.invalid`);
    assert.equal(field("displayname"), "SigninPlayer");
    assert.match(field("account_id"), /^\d+$/);
    assert.equal(field("enableSRTP"), "0");
    assert.equal(field("enableDeflate"), "0");
    const password = field("sip_password");
    assert.ok(password.length >= 16);
    assert.equal(field("sip_ha1"), crypto.createHash("md5").update(`.${accountId}.:core.vivox.invalid:${password}`).digest("hex"));

    // Someone else's token, a join token, a forged one, none.
    const other = backend.vivox.keys.mint({ action: "login", player: "someoneelse" });
    for (const fields of [{ userid: `.${accountId}.`, access_token: other }, { userid: `.${accountId}.`, access_token: backend.vivox.keys.mint({ action: "join", player: accountId, channel: "c" }) },
      { userid: `.${accountId}.`, access_token: signToken("not-the-key", decodeToken(token)) }, { userid: `.${accountId}.` }]) {
      const refused = await form(fields);
      assert.equal(refused.status, 403);
      assert.match(refused.body, /<status>ERR<\/status>/);
    }

    // Anything else under /api2/ is logged and answered OK.
    const other2 = await send({ host: "127.0.0.1", port: backend.port, method: "POST", path: "/api2/viv_call_stats.php", headers: sdk }, "a=1");
    assert.equal(other2.status, 200);
    const logged = fs.readFileSync(path.join(backend.dataDir, "logs", "vivox.log"), "utf8");
    assert.match(logged, /HTTP GET \/api2\/viv_get_prelogin\.php from 127\.0\.0\.1 \(User-Agent: Vivox-SDK-4\.9\.0002\.30406\)/);
    assert.match(logged, /signin of \.[0-9a-f]+\.: token \(access_token\) OK/);
    assert.match(logged, /viv_call_stats\.php: not emulated, answered OK/);
    assert.doesNotMatch(logged, new RegExp(token.split(".")[2]), "no whole token in the log");
  } finally {
    backend.close();
  }
});

test("hotfix: 5.10+ get [Vivox] ServerUrl (quoted) and Domain; older builds' files are byte for byte what they were", async () => {
  const backend = await startVivoxBackend({ withSip: false });
  try {
    const { token } = await userLogin(backend.port, "HotfixPlayer");
    const gameIni = async (agent, extra) => (await getAs(backend.port, "/fortnite/api/cloudstorage/system/DefaultGame.ini", agent, token, extra)).body;
    const setVoice = (on) => send({ host: "127.0.0.1", port: backend.port, method: "POST", path: "/admin/api/settings",
      headers: { "Content-Type": "application/json" } }, JSON.stringify({ vivoxVoice: on }));
    const section = `[Vivox]\r\nServerUrl="http://127.0.0.1:${backend.port}/api2/"\r\nDomain=core.vivox.invalid\r\n`;

    const builds = [agentOf("1.7.2", 3700114), agentOf("2.2", 3841827), agentOf("4.5", 4166199), v50, v510, agentOf("5.41", 4363240), agentOf("6.31", 4573279), v700];
    const on = {};
    for (const agent of builds) on[agent] = await gameIni(agent);
    await setVoice(false);
    for (const agent of builds) {
      const off = await gameIni(agent);
      assert.doesNotMatch(off, /\[Vivox\]/, agent);
      if (Number(/CL-(\d+)/.exec(agent)[1]) < 4225813) assert.equal(on[agent], off, `${agent}: unchanged`);
      else {
        assert.ok(on[agent].includes(section), `${agent}: has the section`);
        assert.equal(on[agent].replace(section, ""), off, `${agent}: only the section added`);
      }
    }
    await setVoice(true);
    // The address the game sent the request to (CoreRedirect's, a friend's backend).
    assert.match(await gameIni(v700, { Host: "play.example.org:40123" }), /\r\nServerUrl="http:\/\/play\.example\.org:40123\/api2\/"\r\nDomain=core\.vivox\.invalid\r\n/);
  } finally {
    backend.close();
  }
});

test("8.20+ (UE 4.23's VivoxVoiceChat): [VoiceChat.Vivox] in DefaultEngine.ini, no [Vivox]; POST createLoginToken and createJoinToken", async () => {
  const backend = await startVivoxBackend({ withSip: false });
  try {
    const { token, accountId } = await userLogin(backend.port, "SeasonEightPlayer");
    const keys = createVivoxKeys(backend.dataDir);
    const v800 = agentOf("8.00", 5203069);
    const v830 = agentOf("8.30", 5793395);
    const file = async (name, agent) => (await getAs(backend.port, `/fortnite/api/cloudstorage/system/${name}`, agent, token)).body;
    const engineSection = `[VoiceChat.Vivox]\r\nServerUrl="http://127.0.0.1:${backend.port}/api2/"\r\nDomain=core.vivox.invalid\r\nIssuer=core\r\nNamespace=core\r\n`;

    for (const agent of [agentOf("8.20", 5625478), v830, agentOf("8.40", 6005771)]) {
      assert.ok((await file("DefaultEngine.ini", agent)).includes(engineSection), agent);
      assert.doesNotMatch(await file("DefaultGame.ini", agent), /\[Vivox\]/, agent);
    }
    // 8.00 is still FVivox: [Vivox] in the game ini, nothing in the engine ini.
    assert.match(await file("DefaultGame.ini", v800), /\[Vivox\]\r\nServerUrl=/);
    assert.doesNotMatch(await file("DefaultEngine.ini", v800), /VoiceChat\.Vivox/);

    const post = (urlPath, agent, body) => send({ host: "127.0.0.1", port: backend.port, method: "POST", path: urlPath,
      headers: { "User-Agent": agent, Authorization: `bearer ${token}`, "Content-Type": "application/json" } }, JSON.stringify(body ?? {}));
    const login = await post(`/fortnite/api/game/v2/voice/${accountId}/createLoginToken`, v830);
    assert.equal(login.status, 200);
    const loginCheck = keys.verify(login.body.token, { vxa: "login", user: `.core.${accountId}.` });
    assert.equal(loginCheck.ok, true, loginCheck.reason);
    assert.equal(loginCheck.payload.f, `sip:.core.${accountId}.@core.vivox.invalid`);

    const join = await post(`/fortnite/api/game/v2/voice/${accountId}/createJoinToken`, v830, { channelType: "party", channelName: "abc123party" });
    assert.equal(join.status, 200);
    const joinCheck = keys.verify(join.body.token, { vxa: "join" });
    assert.equal(joinCheck.ok, true, joinCheck.reason);
    assert.equal(joinCheck.payload.t, "sip:confctl-g-core.abc123party@core.vivox.invalid");
    const echo = await post(`/fortnite/api/game/v2/voice/${accountId}/createJoinToken`, v830, { channelType: "echo", channelName: "echo1" });
    assert.equal(decodeToken(echo.body.token).t, "sip:confctl-e-core.echo1@core.vivox.invalid");

    assert.equal((await post(`/fortnite/api/game/v2/voice/${accountId}/createJoinToken`, v830, { channelType: "party", channelName: "bad name" })).status, 400);
    assert.equal((await post("/fortnite/api/game/v2/voice/someoneelse/createLoginToken", v830)).status, 403);
  } finally {
    backend.close();
  }
});

// Canned messages as a SIP client sends them (compact headers, a folded line, the SDP offer).
const register = [
  "REGISTER sip:core.vivox.invalid SIP/2.0",
  "v: SIP/2.0/UDP 192.168.1.20:50000;branch=z9hG4bK-reg1;rport",
  "Max-Forwards: 70",
  "f: <sip:.acc1.@core.vivox.invalid>;tag=a1",
  "t: <sip:.acc1.@core.vivox.invalid>",
  "i: reg-call-1",
  "CSeq: 1 REGISTER",
  "m: <sip:.acc1.@192.168.1.20:50000>",
  "X-Example: first part",
  " second part",
  "Expires: 600",
  "User-Agent: Vivox-SDK-4.9.0002.30406",
  "l: 0",
  "", ""].join("\r\n");
const offer = (port, formats = "0 101", maps = ["a=rtpmap:0 PCMU/8000", "a=rtpmap:101 telephone-event/8000"]) => [
  "v=0", "o=- 1 1 IN IP4 127.0.0.1", "s=-", "c=IN IP4 127.0.0.1", "t=0 0", `m=audio ${port} RTP/AVP ${formats}`, ...maps, "a=sendrecv", ""].join("\r\n");
const invite = (callId, port, { channel = "confctl-g-Party-p1", user = "acc1", body = offer(port), via = "SIP/2.0/UDP 127.0.0.1:50001;branch=z9hG4bK-inv1;rport", extra = [] } = {}) => [
  `INVITE sip:${channel}@core.vivox.invalid SIP/2.0`,
  `Via: ${via}`,
  `From: <sip:.${user}.@core.vivox.invalid>;tag=f-${callId}`,
  `To: <sip:${channel}@core.vivox.invalid>`,
  `Call-ID: ${callId}`,
  "CSeq: 1 INVITE",
  `Contact: <sip:.${user}.@127.0.0.1:50001>`,
  ...extra,
  "Content-Type: application/sdp",
  `Content-Length: ${Buffer.byteLength(body)}`,
  "", body].join("\r\n");

test("SIP parsing: compact and folded headers, SDP offers, the codec answered, responses back where the request came from", () => {
  const message = parseSip(register);
  assert.equal(message.kind, "request");
  assert.equal(message.method, "REGISTER");
  assert.equal(message.uri, "sip:core.vivox.invalid");
  assert.equal(header(message, "via"), "SIP/2.0/UDP 192.168.1.20:50000;branch=z9hG4bK-reg1;rport");
  assert.equal(header(message, "Call-ID"), "reg-call-1");
  assert.equal(uriOf(header(message, "contact")), "sip:.acc1.@192.168.1.20:50000");
  assert.equal(header(message, "x-example"), "first part second part");
  assert.equal(param(header(message, "from"), "tag"), "a1");
  assert.equal(param(header(message, "via"), "rport"), "");

  const response = parseSip(buildResponse(message, 200, "OK", { source: { address: "203.0.113.9", port: 61000 }, toTag: "tt" }));
  assert.equal(response.kind, "response");
  assert.equal(response.status, 200);
  assert.equal(header(response, "via"), "SIP/2.0/UDP 192.168.1.20:50000;branch=z9hG4bK-reg1;rport=61000;received=203.0.113.9");
  assert.equal(header(response, "to"), "<sip:.acc1.@core.vivox.invalid>;tag=tt");
  assert.equal(header(response, "cseq"), "1 REGISTER");
  assert.equal(header(response, "content-length"), "0");

  const inv = parseSip(invite("c1", 40000));
  assert.equal(inv.method, "INVITE");
  const sdp = parseSdp(inv.body);
  assert.equal(sdp.media[0].port, 40000);
  assert.equal(sdp.media[0].connection, "127.0.0.1");
  assert.deepEqual(sdp.media[0].formats, ["0", "101"]);
  const pcmu = chooseCodec(sdp);
  assert.equal(pcmu.pt, 0);
  assert.equal(pcmu.mixable, true);
  // A dynamic PCMU, and an offer without it: its first codec, forwarded as is.
  assert.equal(chooseCodec(parseSdp(offer(1, "96 0", ["a=rtpmap:96 opus/48000/2", "a=rtpmap:0 PCMU/8000"]))).pt, 0);
  const opus = chooseCodec(parseSdp(offer(1, "101 96", ["a=rtpmap:101 telephone-event/8000", "a=rtpmap:96 opus/48000/2", "a=fmtp:96 useinbandfec=1"])));
  assert.deepEqual([opus.pt, opus.name, opus.rate, opus.mixable, opus.fmtp], [96, "opus", 48000, false, "useinbandfec=1"]);
  assert.equal(chooseCodec(parseSdp("v=0\r\n")), null);

  // TCP: messages split by Content-Length, keep-alive CRLFs dropped, a partial one kept for later.
  const stream = Buffer.from(`\r\n\r\n${register}${invite("c2", 1)}${invite("c3", 1).slice(0, 50)}`);
  const { messages, rest } = splitStream(stream);
  assert.equal(messages.length, 2);
  assert.equal(parseSip(messages[1]).body, offer(1));
  assert.equal(rest.toString(), invite("c3", 1).slice(0, 50));
  assert.equal(parseSip("\r\n\r\n"), null);
  assert.equal(headers(parseSip(invite("c4", 1, { extra: ["Via: SIP/2.0/UDP 10.0.0.1;branch=z9hG4bK-2"] })), "via").length, 2);
});

test("mu-law: encode and decode agree within the codec's step; RTP headers round-trip", () => {
  for (const sample of [0, 1, -1, 100, -100, 1000, -1000, 8000, -8000, 32000, -32000]) {
    const back = ulawDecode(ulawEncode(sample));
    assert.ok(Math.abs(back - sample) <= Math.max(8, Math.abs(sample) / 16), `${sample} -> ${back}`);
  }
  assert.equal(ulawEncode(0), 0xff);
  const packet = buildRtp({ payloadType: 0, sequence: 65535, timestamp: 4294967295, ssrc: 1234, marker: true, payload: Buffer.from([1, 2, 3]) });
  assert.deepEqual({ ...parseRtp(packet), payload: [...parseRtp(packet).payload] },
    { version: 2, marker: true, payloadType: 0, sequence: 65535, timestamp: 4294967295, ssrc: 1234, payload: [1, 2, 3] });
});

async function udpClient() {
  const socket = dgram.createSocket("udp4");
  await new Promise((resolve) => socket.bind(0, "127.0.0.1", resolve));
  const inbox = [];
  const waiters = [];
  socket.on("message", (packet) => {
    inbox.push(packet);
    while (waiters.length) waiters.shift()();
  });
  return {
    socket,
    port: socket.address().port,
    send: (text, port) => socket.send(Buffer.from(text), port, "127.0.0.1"),
    async next(match = () => true, timeoutMs = 3000) {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const index = inbox.findIndex((packet) => match(packet));
        if (index >= 0) return inbox.splice(index, 1)[0];
        if (Date.now() > deadline) throw new Error("nothing came");
        await new Promise((resolve) => {
          waiters.push(resolve);
          setTimeout(resolve, 50);
        });
      }
    },
    close: () => socket.close()
  };
}

test("SIP server: REGISTER, INVITE answered with PCMU on a port of the call's own, ACK, OPTIONS, BYE, over UDP and TCP", async () => {
  const backend = await startVivoxBackend();
  const client = await udpClient();
  try {
    const status = (packet) => parseSip(packet)?.status;
    client.send(register, backend.sipPort);
    const registered = parseSip(await client.next());
    assert.equal(registered.status, 200);
    assert.equal(header(registered, "expires"), "600");
    assert.match(header(registered, "via"), new RegExp(`rport=${client.port};received=127\\.0\\.0\\.1$`));
    assert.match(header(registered, "to"), /;tag=/);

    client.send(invite("call-1", 40000, { extra: [`X-Vivox-Access-Token: ${backend.vivox.keys.mint({ action: "join", player: "acc1", channel: "confctl-g-Party-p1" })}`] }), backend.sipPort);
    assert.equal(status(await client.next((packet) => status(packet) === 100)), 100);
    const answered = parseSip(await client.next((packet) => status(packet) === 200));
    assert.equal(header(answered, "cseq"), "1 INVITE");
    const answer = parseSdp(answered.body);
    assert.equal(answer.media[0].formats[0], "0");
    assert.equal(answer.media[0].connection, "127.0.0.1");
    assert.ok(answer.media[0].port >= 5062 && answer.media[0].port <= 5199, `RTP port ${answer.media[0].port}`);
    assert.match(header(answered, "contact"), new RegExp(`^<sip:confctl-g-Party-p1@127\\.0\\.0\\.1:${backend.sipPort}>$`));
    const toTag = param(header(answered, "to"), "tag");
    assert.ok(toTag);
    // The same INVITE again (a UDP retransmission): the same answer, not a second call.
    client.send(invite("call-1", 40000), backend.sipPort);
    const again = parseSip(await client.next((packet) => status(packet) === 200));
    assert.equal(param(header(again, "to"), "tag"), toTag);
    assert.equal(parseSdp(again.body).media[0].port, answer.media[0].port);
    client.send(["ACK sip:confctl-g-Party-p1@127.0.0.1 SIP/2.0", "Via: SIP/2.0/UDP 127.0.0.1:50001;branch=z9hG4bK-ack1", "From: <sip:.acc1.@core.vivox.invalid>;tag=f-call-1",
      `To: <sip:confctl-g-Party-p1@core.vivox.invalid>;tag=${toTag}`, "Call-ID: call-1", "CSeq: 1 ACK", "Content-Length: 0", "", ""].join("\r\n"), backend.sipPort);

    client.send(["OPTIONS sip:core.vivox.invalid SIP/2.0", "Via: SIP/2.0/UDP 127.0.0.1:50001;branch=z9hG4bK-opt1", "From: <sip:.acc1.@core.vivox.invalid>;tag=o1",
      "To: <sip:core.vivox.invalid>", "Call-ID: opt-1", "CSeq: 7 OPTIONS", "Content-Length: 0", "", ""].join("\r\n"), backend.sipPort);
    const options = parseSip(await client.next((packet) => header(parseSip(packet), "cseq") === "7 OPTIONS"));
    assert.equal(options.status, 200);
    assert.match(header(options, "allow"), /INVITE.*BYE/);

    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.deepEqual(backend.vivox.status().calls, [{ callId: "call-1", channel: "confctl-g-Party-p1", acked: true }]);
    client.send(["BYE sip:confctl-g-Party-p1@127.0.0.1 SIP/2.0", "Via: SIP/2.0/UDP 127.0.0.1:50001;branch=z9hG4bK-bye1", "From: <sip:.acc1.@core.vivox.invalid>;tag=f-call-1",
      `To: <sip:confctl-g-Party-p1@core.vivox.invalid>;tag=${toTag}`, "Call-ID: call-1", "CSeq: 2 BYE", "Content-Length: 0", "", ""].join("\r\n"), backend.sipPort);
    assert.equal(parseSip(await client.next((packet) => header(parseSip(packet), "cseq") === "2 BYE")).status, 200);
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.deepEqual(backend.vivox.status().calls, []);

    // TCP, the same server port.
    const tcp = net.connect(backend.sipPort, "127.0.0.1");
    await once(tcp, "connect");
    tcp.write(register.replace("SIP/2.0/UDP", "SIP/2.0/TCP"));
    const [chunk] = await once(tcp, "data");
    assert.equal(parseSip(chunk).status, 200);
    tcp.destroy();

    const logged = fs.readFileSync(path.join(backend.dataDir, "logs", "vivox.log"), "utf8");
    assert.match(logged, /SIP in from 127\.0\.0\.1:\d+\/udp\n {4}REGISTER sip:core\.vivox\.invalid SIP\/2\.0/);
    assert.match(logged, /INVITE from 127\.0\.0\.1:\d+\/udp: token in X-Vivox-Access-Token: OK/);
    assert.match(logged, /token channel sip:confctl-g-Party-p1@core\.vivox\.invalid matches the INVITE's/);
    assert.match(logged, /join confctl-g-Party-p1 by sip:\.acc1\.@core\.vivox\.invalid, offered 0 PCMU\/8000, 101 telephone-event\/8000; answering PCMU\/8000/);
    assert.match(logged, /Channel confctl-g-Party-p1: sip:\.acc1\.@core\.vivox\.invalid left \(BYE\)/);
  } finally {
    client.close();
    backend.close();
  }
});

test("media: two PCMU members hear each other through the mixer; echo lets one alone hear itself", async () => {
  const media = createMedia({ range: { min: 5300, max: 5399 }, host: "127.0.0.1" });
  const a = await udpClient();
  const b = await udpClient();
  try {
    const codec = { pt: 0, name: "PCMU", rate: 8000, rtpmap: "PCMU/8000", mixable: true };
    const joinedA = await media.join({ callId: "a", channel: "room", label: "A", codec, remote: { address: "127.0.0.1", port: a.port } });
    const joinedB = await media.join({ callId: "b", channel: "room", label: "B", codec, remote: { address: "127.0.0.1", port: b.port } });
    assert.notEqual(joinedA.port, joinedB.port);
    // A talks: a loud square wave, 6 packets of 20 ms. B also sends (silence), which latches its address.
    const loud = Buffer.alloc(160);
    for (let i = 0; i < 160; i++) loud[i] = ulawEncode(i % 20 < 10 ? 8000 : -8000);
    for (let seq = 0; seq < 6; seq++) {
      a.socket.send(buildRtp({ payloadType: 0, sequence: seq, timestamp: seq * 160, ssrc: 11, payload: loud }), joinedA.port, "127.0.0.1");
      b.socket.send(buildRtp({ payloadType: 0, sequence: seq, timestamp: seq * 160, ssrc: 22, payload: Buffer.alloc(160, 0xff) }), joinedB.port, "127.0.0.1");
    }
    const heard = parseRtp(await b.next((packet) => {
      const rtp = parseRtp(packet);
      return rtp && Math.max(...[...rtp.payload].map((byte) => Math.abs(ulawDecode(byte)))) > 4000;
    }));
    assert.equal(heard.payloadType, 0);
    assert.equal(heard.payload.length, 160);
    assert.notEqual(heard.ssrc, 11, "B's own stream from the mixer, not A's packets");
    media.leave("a");
    media.leave("b");

    const echo = createMedia({ range: { min: 5400, max: 5499 }, host: "127.0.0.1", echo: true });
    const alone = await echo.join({ callId: "c", channel: "solo", label: "C", codec, remote: { address: "127.0.0.1", port: a.port } });
    for (let seq = 0; seq < 6; seq++) a.socket.send(buildRtp({ payloadType: 0, sequence: seq, timestamp: seq * 160, ssrc: 33, payload: loud }), alone.port, "127.0.0.1");
    const back = parseRtp(await a.next((packet) => {
      const rtp = parseRtp(packet);
      return rtp && rtp.ssrc !== 11 && Math.max(...[...rtp.payload].map((byte) => Math.abs(ulawDecode(byte)))) > 4000;
    }));
    assert.equal(back.payload.length, 160);
    echo.close();
  } finally {
    media.close();
    a.close();
    b.close();
  }
});
