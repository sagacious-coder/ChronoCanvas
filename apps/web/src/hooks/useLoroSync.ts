import { useEffect, useRef, useState, useCallback } from "react";
import { LoroDoc } from "loro-crdt";
import { LoroSyncClient, ConnectionStatus, SyncStats } from "../services/loroSync";
import { AgentTaskStatus, PeerAwareness, AuthSuccessMessage, AuthErrorMessage } from "../types/shared";

export function useLoroSync(
  doc: LoroDoc,
  serverUrl = "ws://localhost:3001",
  docId = "chrono-canvas-default",
  peerId?: string,
  authToken = "dev-dummy-token",
  apiKey?: string,
) {
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [stats, setStats] = useState<SyncStats>({
    bytesSent: 0,
    bytesReceived: 0,
    updatesSent: 0,
    updatesReceived: 0,
    lastSyncAt: null,
  });
  const [agentStatus, setAgentStatus] = useState<AgentTaskStatus | null>(null);
  const [remotePeers, setRemotePeers] = useState<Map<string, PeerAwareness>>(new Map());

  const clientRef = useRef<LoroSyncClient | null>(null);

  const handleRemoteAwareness = useCallback((peer: PeerAwareness) => {
    setRemotePeers((prev) => {
      const next = new Map(prev);
      next.set(peer.peerId, peer);
      return next;
    });
  }, []);

  const handleAuthSuccess = useCallback((_msg: AuthSuccessMessage) => {
    setIsAuthenticated(true);
    setAuthError(null);
  }, []);

  const handleAuthError = useCallback((msg: AuthErrorMessage) => {
    setIsAuthenticated(false);
    setAuthError(msg.error);
  }, []);

  useEffect(() => {
    const client = new LoroSyncClient(doc, {
      url: serverUrl,
      docId,
      peerId,
      authToken,
      apiKey,
      onStatusChange: setStatus,
      onStatsChange: setStats,
      onAgentStatusChange: setAgentStatus,
      onRemoteAwareness: handleRemoteAwareness,
      onAuthSuccess: handleAuthSuccess,
      onAuthError: handleAuthError,
    });

    clientRef.current = client;
    client.connect();

    return () => {
      client.destroy();
      clientRef.current = null;
    };
  }, [doc, serverUrl, docId, peerId, authToken, apiKey, handleRemoteAwareness, handleAuthSuccess, handleAuthError]);

  const dispatchAgentTask = useCallback((prompt: string, simulateFailure = false, taskApiKey?: string) => {
    clientRef.current?.dispatchAgentTask(prompt, simulateFailure, taskApiKey);
  }, []);

  const clearAgentStatus = useCallback(() => {
    setAgentStatus(null);
  }, []);

  const broadcastAwareness = useCallback((peer: PeerAwareness) => {
    clientRef.current?.sendAwareness(peer);
  }, []);

  const getFrontierString = useCallback(() => {
    return clientRef.current?.getFrontierString() || "Latest";
  }, []);

  return {
    status,
    isAuthenticated,
    authError,
    stats,
    agentStatus,
    remotePeers,
    dispatchAgentTask,
    clearAgentStatus,
    broadcastAwareness,
    getFrontierString,
    reconnect: () => clientRef.current?.connect(),
    sendUpdate: () => clientRef.current?.exportAndSendUpdate(),
  };
}
