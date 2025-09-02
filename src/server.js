import "dotenv/config";
import http from "http";
import app from "./app.js";
import logger from "./logger.js";
import { WSHub } from "./ws/hub.js";
import { createTracker } from "./scheduler/tracker.js";

const PORT = Number(process.env.PORT || 8080);
const WS_PATH = process.env.WS_PATH || "/ws";

const server = http.createServer(app);

// WS hub
const hub = new WSHub(server, WS_PATH);
app.locals.hub = hub;

// Tracker
const tracker = createTracker({
  hub,
  tickMs: Number(process.env.TRACKER_TICK_MS || 5000),
});
tracker.start();
app.locals.tracker = tracker; // expose to routes

server.listen(PORT, () => {
  logger.info({ PORT, WS_PATH }, "HTTP+WS server started");
});
