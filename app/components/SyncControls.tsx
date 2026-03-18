"use client";

import { useState, useEffect, useCallback } from "react";

interface AuthStatus {
  connected: boolean;
  hasGithubToken: boolean;
  hasVercelToken: boolean;
  canSync: boolean;
}

interface SyncResult {
  status: string;
  tokenRefreshed?: boolean;
  summary?: {
    total: number;
    successful: number;
    failed: number;
    totalTodos: number;
  };
  error?: string;
}

export default function SyncControls() {
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [loading, setLoading] = useState(true);

  const checkStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/status");
      const data = await res.json();
      setAuthStatus(data);
    } catch {
      setAuthStatus(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  const handleSyncAll = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch("/api/sync", { method: "POST" });
      const data = await res.json();
      setSyncResult(data);
    } catch (e) {
      setSyncResult({
        status: "error",
        error: e instanceof Error ? e.message : "Sync request failed",
      });
    } finally {
      setSyncing(false);
    }
  };

  if (loading) return null;

  return (
    <div className="mt-6 flex flex-wrap items-center gap-3">
      {/* Connection status */}
      {authStatus?.connected ? (
        <>
          <span
            className="flex items-center gap-2 rounded-sm px-3 py-1.5 text-xs font-medium"
            style={{
              backgroundColor: "rgba(45, 106, 79, 0.15)",
              color: "#2d6a4f",
            }}
          >
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: "#2d6a4f" }}
            />
            Basecamp Connected
          </span>

          <button
            onClick={handleSyncAll}
            disabled={syncing || !authStatus.canSync}
            className="rounded-sm px-4 py-1.5 text-xs font-semibold uppercase tracking-wider transition-opacity hover:opacity-80 disabled:opacity-50"
            style={{ backgroundColor: "#C8A882", color: "#0a0a0a" }}
          >
            {syncing ? "Syncing..." : "Sync All Clients"}
          </button>

          {!authStatus.hasGithubToken && (
            <span
              className="text-xs"
              style={{ color: "#b08d57" }}
            >
              GITHUB_TOKEN not set — data will not be committed
            </span>
          )}
        </>
      ) : (
        <a
          href="/api/auth/login"
          className="rounded-sm px-4 py-1.5 text-xs font-semibold uppercase tracking-wider transition-opacity hover:opacity-80"
          style={{ backgroundColor: "#C8A882", color: "#0a0a0a" }}
        >
          Connect Basecamp
        </a>
      )}

      {/* Sync result feedback */}
      {syncResult && (
        <div
          className="w-full mt-3 rounded-sm px-4 py-3 text-xs"
          style={{
            backgroundColor:
              syncResult.status === "complete"
                ? "rgba(45, 106, 79, 0.1)"
                : "rgba(200, 50, 50, 0.1)",
            color:
              syncResult.status === "complete" ? "#2d6a4f" : "#cc4444",
          }}
        >
          {syncResult.status === "complete" && syncResult.summary ? (
            <span>
              Sync complete: {syncResult.summary.successful}/
              {syncResult.summary.total} projects synced,{" "}
              {syncResult.summary.totalTodos} total todos fetched.
              {syncResult.summary.failed > 0 && (
                <span style={{ color: "#cc4444" }}>
                  {" "}
                  {syncResult.summary.failed} failed.
                </span>
              )}
              {syncResult.tokenRefreshed && " (token was auto-refreshed)"}
            </span>
          ) : (
            <span>Sync error: {syncResult.error}</span>
          )}
        </div>
      )}
    </div>
  );
}
