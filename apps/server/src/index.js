import { WebSocketServer } from 'ws';

const PORT = 8080;
const wss = new WebSocketServer({ port: PORT });

console.log(`🚀 ChronoCanvas WebSocket Server running on ws://localhost:${PORT}`);

wss.on('connection', (ws, request) => {
  console.log(`[+] New client connected from ${request.socket.remoteAddress}`);

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      console.log('Received message type:', message.type);

      switch (message.type) {
        case 'crdt-sync':
          console.log(`Syncing document: ${message.docId}`);
          break;
        
        case 'awareness-update':
          console.log(`Awareness update from: ${message.peer?.userName}`);
          break;

        default:
          console.log('Unknown message type received');
      }
    } catch (error) {
      console.error('Failed to parse incoming message:', error);
    }
  });

  ws.on('close', () => {
    console.log('[-] Client disconnected');
  });
});