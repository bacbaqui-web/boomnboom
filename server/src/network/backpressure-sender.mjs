import { WebSocket } from "ws";

export const DEFAULT_MAX_BUFFERED_AMOUNT = 512 * 1024;

export function sendWithBackpressure(
  socket,
  message,
  {
    maxBufferedAmount = DEFAULT_MAX_BUFFERED_AMOUNT,
    metrics = null,
    readBufferedAmount = (target) => target.bufferedAmount,
  } = {},
) {
  if (socket.readyState !== WebSocket.OPEN) return false;
  if (readBufferedAmount(socket) > maxBufferedAmount) {
    if (metrics) metrics.backpressureDisconnects += 1;
    socket.close(1013, "backpressure");
    return false;
  }

  const serialized = typeof message === "string" ? message : JSON.stringify(message);
  socket.send(serialized);
  if (metrics) {
    metrics.outboundMessages += 1;
    metrics.outboundBytes += Buffer.byteLength(serialized);
  }
  return true;
}
