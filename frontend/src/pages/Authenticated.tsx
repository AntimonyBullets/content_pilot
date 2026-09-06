import React from "react";
import { getYouTubeConnectUrl } from "../api/client";
import { useAuth } from "../context/AuthContext";

export const Authenticated: React.FC = () => {
  const {
    user,
    logout,
    youtubeStatus,
    youtubeLoading,
    youtubeNotice,
    disconnectYouTube,
    clearNotice,
  } = useAuth();

  const handleConnectYouTube = () => {
    // Navigate browser window directly so Google OAuth flow initiates
    window.location.href = getYouTubeConnectUrl();
  };

  const isConnected = youtubeStatus?.connected ?? false;
  const channel = youtubeStatus?.channel;

  return (
    <div className="card">
      <h1>ContentPilot</h1>

      <div style={{ marginBottom: "16px", fontSize: "0.95rem" }}>
        Logged in {user?.email ? `as ${user.email}` : ""}
      </div>

      {youtubeNotice && (
        <div
          className={
            youtubeNotice.toLowerCase().includes("failed") ||
            youtubeNotice.toLowerCase().includes("error")
              ? "alert-error"
              : "alert-success"
          }
          onClick={clearNotice}
          style={{ cursor: "pointer" }}
        >
          {youtubeNotice}
        </div>
      )}

      <div className="status-box">
        <div>
          YouTube:{" "}
          <span
            className={
              isConnected ? "status-value status-connected" : "status-value status-disconnected"
            }
          >
            {youtubeLoading
              ? "Checking..."
              : isConnected
              ? "Connected"
              : "Not Connected"}
          </span>
        </div>

        {isConnected && channel?.channelTitle && (
          <div className="channel-info">Channel: {channel.channelTitle}</div>
        )}
      </div>

      {!isConnected ? (
        <button type="button" onClick={handleConnectYouTube} disabled={youtubeLoading}>
          Connect YouTube
        </button>
      ) : (
        <button
          type="button"
          className="danger"
          onClick={disconnectYouTube}
          disabled={youtubeLoading}
        >
          Disconnect YouTube
        </button>
      )}

      <button type="button" className="secondary" onClick={logout} style={{ marginTop: "12px" }}>
        Logout
      </button>
    </div>
  );
};
