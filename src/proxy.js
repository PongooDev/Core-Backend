import tls from "node:tls";
import selfsigned from "selfsigned";

export async function enableProxy(server) {
  const base = await selfsigned.generate([{ name: "commonName", value: "Core-Backend" }], { algorithm: "sha256" });
  const keyPair = { privateKey: base.private, publicKey: base.public };
  const contexts = new Map();

  function contextFor(host) {
    if (!contexts.has(host)) {
      const pems = selfsigned.generate([{ name: "commonName", value: host }], { algorithm: "sha256", keyPair });
      contexts.set(host, pems.then(({ cert }) => tls.createSecureContext({ key: keyPair.privateKey, cert })));
    }
    return contexts.get(host);
  }

  server.on("connect", async (req, socket, head) => {
    socket.on("error", () => socket.destroy());
    const secureContext = await contextFor(req.url.replace(/:\d+$/, ""));

    socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    if (head.length) socket.unshift(head);

    const tlsSocket = new tls.TLSSocket(socket, { isServer: true, secureContext });
    tlsSocket.on("error", () => socket.destroy());
    server.emit("connection", tlsSocket);
  });
}

export function originForm(req, res, next) {
  if (!req.url.startsWith("/")) {
    const url = new URL(req.url);
    req.url = url.pathname + url.search;
    req.originalUrl = req.url;
  }
  next();
}
