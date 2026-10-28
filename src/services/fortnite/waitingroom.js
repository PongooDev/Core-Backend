import express from "express";

// The login's waiting room ("Checking Epic services queue...", LoginWaitingRoom): the client asks
// fortnitewaitingroom-public-service-prod.ol.epicgames.com's waitingroom/api/waitingroom (1.7.2 builds it from the
// service's base URL and "api/waitingroom", WaitingRoomQueryUrl) and only queues when the answer carries
// {retryTime, expectedWait} (0x3A27C10). An empty 204 means there's no queue. The PC client skips the step, but a PS4
// client asks and showed "waiting room unanswered" without it (Core-Backend #65).
export function waitingRoomRoutes() {
  const router = express.Router();

  router.get("/waitingroom/api/waitingroom", (req, res) => {
    res.status(204).end();
  });

  return router;
}
