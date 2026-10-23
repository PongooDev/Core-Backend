import { log } from "./log.js";

export const describeHost = (host) => (host === undefined ? "every interface" : host);

function listenOnce(server, port, host) {
  return new Promise((resolve, reject) => {
    const failed = (error) => reject(error);
    server.once("error", failed);
    server.listen(port, host, () => {
      server.off("error", failed);
      resolve(server.address().port);
    });
  });
}

// Listens where the network settings say (network.js bindAddress: 127.0.0.1 unless remote access is on) and moves when
// they change: turning remote access on or off in the admin panel takes effect at once, on the same port. Connections
// already open stay (server.js drops other machines' ones when remote access goes off). Resolves with the port.
export async function listen(server, network, port) {
  let host = network.bindAddress();
  const bound = await listenOnce(server, port, host);
  network.listening = { host: host ?? "", port: bound };

  let moving = Promise.resolve();
  network.onChange(() => {
    moving = moving.then(async () => {
      const next = network.bindAddress();
      if (next === host || !server.listening) return;
      server.close();
      try {
        await listenOnce(server, bound, next);
        host = next;
        log("Core", `Now listening on ${describeHost(host)}, port ${bound}`);
      } catch (error) {
        log("Core", `Couldn't listen on ${describeHost(next)}, port ${bound} (${error.message}); staying on ${describeHost(host)}`);
        await listenOnce(server, bound, host).catch((again) => log("Core", `Couldn't listen again: ${again.message}`));
      }
      network.listening = { host: host ?? "", port: bound };
    });
  });
  return bound;
}
