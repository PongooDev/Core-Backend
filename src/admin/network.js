import express from "express";
import { sendError } from "../errors.js";
import { sessionSummary } from "../matchmaking/sessions.js";
import { lanAddresses } from "../network.js";
import { createAdminNetworkGate, createPanelRequestGate } from "./local.js";

// The admin panel's "Play with friends" page: remote access, the public address, and what friends need.
export function networkAdminRoutes({ network, sessions, adminAuth }) {
  const router = express.Router();
  router.use("/admin/api/network", createAdminNetworkGate(adminAuth), createPanelRequestGate(adminAuth));

  const describe = (req) => {
    const resolution = network.resolution();
    return {
      ...network.settings(),
      fixed: network.fixed(),
      publicIp: resolution.address,
      publicAddressError: resolution.error,
      listening: network.listening ?? { host: "", port: req.socket.localPort },
      lanAddresses: lanAddresses(),
      // What a host forwards: the backend's TCP port, and each gameserver's game and beacon ports (UDP).
      servers: sessions.list().map(sessionSummary)
        .map(({ ownerName, serverName, serverAddress, serverPort, beaconPort }) => ({ name: ownerName || serverName, serverAddress, serverPort, beaconPort }))
    };
  };

  router.get("/admin/api/network", (req, res) => res.json(describe(req)));

  router.post("/admin/api/network", (req, res) => {
    try {
      network.update({ remoteAccess: req.body?.remoteAccess, publicAddress: req.body?.publicAddress });
    } catch (error) {
      return sendError(res, 400, "errors.com.epicgames.common.invalid_parameter", error.message);
    }
    res.json(describe(req));
  });

  return router;
}
