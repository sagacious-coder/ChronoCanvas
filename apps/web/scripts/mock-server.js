import { WebSocketServer } from "ws";

const PORT = 3001;
const wss = new WebSocketServer({ port: PORT });

console.log(`\n======================================================`);
console.log(`[ChronoCanvas Mock Relay Server] Listening on ws://localhost:${PORT}`);
console.log(`======================================================\n`);

let cachedDocumentSnapshot = null;

wss.on("connection", (ws) => {
  console.log(`[Mock Relay] Client connected. Total active clients: ${wss.clients.size}`);

  if (cachedDocumentSnapshot) {
    ws.send(cachedDocumentSnapshot, { binary: true });
    console.log(`[Mock Relay] Sent cached snapshot (${cachedDocumentSnapshot.length} bytes) to new client.`);
  }

  ws.on("message", (data, isBinary) => {
    if (isBinary) {
      cachedDocumentSnapshot = data;
      console.log(`[Mock Relay] Relaying ${data.length} bytes of CRDT delta to other peers.`);
      
      for (const client of wss.clients) {
        if (client !== ws && client.readyState === 1) {
          client.send(data, { binary: true });
        }
      }
    }
  });

  ws.on("close", () => {
    console.log(`[Mock Relay] Client disconnected. Total active clients: ${wss.clients.size}`);
  });
});
