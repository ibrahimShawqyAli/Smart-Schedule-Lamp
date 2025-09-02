import { WebSocketServer } from "ws";
import logger from "../logger.js";

/**
 * Simple WS hub keyed by device_id.
 * No headers/query; devices must send a first JSON:
 * { "type": "hello", "device_id": 123 }
 */
export class WSHub {
  constructor(server, path) {
    this.wss = new WebSocketServer({ server, path });
    this.clients = new Map(); // device_id -> ws

    this.wss.on("connection", (ws) => {
      let deviceId = null;

      ws.on("message", (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === "hello" && typeof msg.device_id === "number") {
            deviceId = msg.device_id;
            this.clients.set(deviceId, ws);
            logger.info({ deviceId }, "WS device connected");
            ws.send(JSON.stringify({ type: "hello_ack", device_id: deviceId }));
            return;
          }
          if (!deviceId) {
            ws.send(
              JSON.stringify({
                type: "error",
                error: "send hello with device_id first",
              })
            );
            return;
          }
          // Device ACK / telemetry etc.
          if (msg.type === "ack") {
            logger.info({ deviceId, ack: msg }, "ACK from device");
          }
        } catch (e) {
          logger.warn({ e }, "WS message parse error");
        }
      });

      ws.on("close", () => {
        if (deviceId && this.clients.get(deviceId) === ws) {
          this.clients.delete(deviceId);
          logger.info({ deviceId }, "WS device disconnected");
        }
      });
    });

    logger.info({ path }, "WS server ready");
  }

  sendState(deviceId, payload) {
    const ws = this.clients.get(deviceId);
    if (!ws || ws.readyState !== 1) {
      return false;
    }
    ws.send(JSON.stringify(payload));
    return true;
  }
}
