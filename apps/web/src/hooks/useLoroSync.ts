import { useEffect, useRef, useState, useCallback } from "react";
import { LoroDoc } from "loro-crdt";
import { LoroSyncClient, ConnectionStatus, SyncStats } from "../services/loroSync";
import { AgentTaskStatus, PeerAwareness, AuthSuccessMessage, AuthErrorMessage, ByokConfig } from "../types/shared";
import { loadUserSettings, getActiveApiKey, LlmProvider } from "../components/SettingsModal";

export function useLoroSync(
  doc: LoroDoc,
  serverUrl = "ws://localhost:3001",
  docId = "chrono-canvas-default",
  peerId?: string,
  authToken?: string,
  apiKey?: string,
  provider?: LlmProvider,
) {
  // If not supplied directly via props, dynamically resolve from browser localStorage settings
  const localSettings = loadUserSettings();
  const effectiveAuthToken = authToken !== undefined ? authToken : (localSettings.jwtToken || "dev-dummy-token");
  const effectiveApiKey = apiKey !== undefined ? apiKey : getActiveApiKey(localSettings);
  const effectiveProvider = provider !== undefined ? provider : localSettings.selectedProvider;

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
      authToken: effectiveAuthToken,
      apiKey: effectiveApiKey,
      provider: effectiveProvider,
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
  }, [
    doc,
    serverUrl,
    docId,
    peerId,
    handleRemoteAwareness,
    handleAuthSuccess,
    handleAuthError,
  ]);

  const updateCredentials = useCallback(
    (newAuthToken: string, newApiKey?: string, newProvider?: LlmProvider) => {
      clientRef.current?.updateCredentials(newAuthToken, newApiKey, newProvider);
    },
    [],
  );

  const dispatchAgentTask = useCallback(
    (
      prompt: string,
      simulateFailure = false,
      failureType: "syntax" | "assertion" = "syntax",
      enableSelfHealing = false,
      byokConfig?: ByokConfig,
      authTokenParam?: string,
      taskApiKey?: string,
      taskProvider?: LlmProvider,
    ) => {
      clientRef.current?.dispatchAgentTask(
        prompt,
        simulateFailure,
        failureType,
        enableSelfHealing,
        byokConfig,
        authTokenParam || effectiveAuthToken,
        taskApiKey || byokConfig?.apiKey || effectiveApiKey,
        taskProvider || effectiveProvider,
      );
    },
    [effectiveAuthToken, effectiveApiKey, effectiveProvider],
  );

  const clearAgentStatus = useCallback(() => {
    setAgentStatus(null);
  }, []);

  const broadcastAwareness = useCallback((peer: PeerAwareness) => {
    clientRef.current?.sendAwareness(peer);
  }, []);

  const getFrontierString = useCallback(() => {
    return clientRef.current?.getFrontierString() || "Latest";
  }, []);

  const getFrontierEntries = useCallback(() => {
    return clientRef.current?.getFrontierEntries() || [];
  }, []);

  const reconnect = useCallback(() => {
    if (clientRef.current) {
      clientRef.current.setCredentials(effectiveAuthToken, effectiveApiKey, effectiveProvider);
      clientRef.current.disconnect();
      clientRef.current.connect();
    }
  }, [effectiveAuthToken, effectiveApiKey, effectiveProvider]);

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
    getFrontierEntries,
    reconnect,
    updateCredentials,
    sendUpdate: () => clientRef.current?.exportAndSendUpdate(),
  };
}
