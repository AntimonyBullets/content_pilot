import React from "react";
import { useRef, useState } from "react";
import axios from "axios";
import {
  generateContent,
  transcribeVideo,
  transcribeVideoUrl,
} from "../api/client";
import { useAuth } from "../context/AuthContext";

export const Authenticated: React.FC = () => {
  const {
    youtubeStatus,
    youtubeLoading,
    youtubeNotice,
    clearNotice,
  } = useAuth();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const transcriptRef = useRef<Awaited<ReturnType<typeof transcribeVideo>>["transcript"] | null>(
    null
  );
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [videoUrl, setVideoUrl] = useState("");
  const [transcribing, setTranscribing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isConnected = youtubeStatus?.connected ?? false;

  const getErrorMessage = (requestError: unknown, fallback: string) => {
    if (axios.isAxiosError<{ message?: string }>(requestError)) {
      return requestError.response?.data?.message || fallback;
    }
    return fallback;
  };

  const startTranscription = async (transcribe: () => ReturnType<typeof transcribeVideo>) => {
    setError(null);
    setMessage(null);
    setSessionId(null);
    transcriptRef.current = null;
    setTranscribing(true);

    try {
      const response = await transcribe();
      transcriptRef.current = response.transcript;
      setSessionId(response.sessionId);
      setShowUrlInput(false);
      setMessage("Transcription complete.");
    } catch (requestError) {
      setError(getErrorMessage(requestError, "Unable to transcribe video. Please try again."));
    } finally {
      setTranscribing(false);
    }
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      void startTranscription(() => transcribeVideo(file));
    }
    event.target.value = "";
  };

  const handleUrlSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmedUrl = videoUrl.trim();
    if (!trimmedUrl) {
      setError("Please enter a video URL.");
      return;
    }
    setShowUrlInput(false);
    void startTranscription(() => transcribeVideoUrl(trimmedUrl));
  };

  const handleGenerateContent = async () => {
    if (!sessionId || !transcriptRef.current) return;

    setError(null);
    setMessage(null);
    setGenerating(true);
    try {
      await generateContent(sessionId, transcriptRef.current);
      setMessage("Content generated successfully.");
    } catch (requestError) {
      setError(getErrorMessage(requestError, "Unable to generate content. Please try again."));
    } finally {
      setGenerating(false);
    }
  };

  return (
    <main className="homepage">
      <button type="button" className="settings-button" aria-label="Settings">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 0 0-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 0 0-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 0 0-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 0 0-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 0 0 1.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      </button>

      <section className="homepage-content">
        {!isConnected && !youtubeLoading && (
          <div className="youtube-warning" role="status">
            <span aria-hidden="true">!</span>
            Connect your YouTube channel in Settings → Account to enable automatic uploads.
          </div>
        )}

        {youtubeNotice && (
          <div className="alert-success homepage-message" onClick={clearNotice}>
            {youtubeNotice}
          </div>
        )}

        <div className="video-input-panel">
          <input
            ref={fileInputRef}
            className="visually-hidden"
            type="file"
            accept="video/mp4,video/webm,video/quicktime,video/mpeg,.mp4,.webm,.mov,.mpeg,.mpg"
            onChange={handleFileChange}
            disabled={transcribing || generating}
          />
          <button
            type="button"
            className="upload-button"
            onClick={() => fileInputRef.current?.click()}
            disabled={transcribing || generating}
          >
            Upload Video
            <svg className="upload-button-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 16V4m0 0L7 9m5-5 5 5M5 14v5h14v-5" />
            </svg>
          </button>

          <span
            className="url-toggle"
            role="button"
            tabIndex={0}
            onClick={() => setShowUrlInput((visible) => !visible)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                setShowUrlInput((visible) => !visible);
              }
            }}
            aria-disabled={transcribing || generating}
          >
            or paste a video URL
          </span>

        </div>

        {showUrlInput && (
          <div className="url-modal-backdrop" role="presentation" onMouseDown={() => setShowUrlInput(false)}>
            <div
              className="url-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="url-modal-title"
              onMouseDown={(event) => event.stopPropagation()}
            >
              <h2 id="url-modal-title">Paste a video URL</h2>
              <form className="url-form" onSubmit={handleUrlSubmit}>
                <input
                  type="url"
                  value={videoUrl}
                  onChange={(event) => setVideoUrl(event.target.value)}
                  placeholder="Paste video URL here..."
                  disabled={transcribing || generating}
                  autoFocus
                  required
                />
                <div className="url-modal-actions">
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => setShowUrlInput(false)}
                    disabled={transcribing || generating}
                  >
                    Cancel
                  </button>
                  <button type="submit" disabled={transcribing || generating}>
                    Confirm
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {transcribing && <div className="processing-status">Transcribing video...</div>}
        {error && <div className="alert-error homepage-message">{error}</div>}
        {message && !generating && (
          <div className="alert-success homepage-message">{message}</div>
        )}

        {sessionId && !transcribing && (
          <button
            type="button"
            className="generate-button"
            onClick={() => void handleGenerateContent()}
            disabled={generating}
          >
            {generating ? "Generating Content..." : "Generate Content"}
          </button>
        )}
      </section>

      <footer className="homepage-footer">
        ContentPilot by{" "}
        <a href="https://github.com/AntimonyBullets" target="_blank" rel="noreferrer">
          AntimonyBullets (Shashank Khatri)
        </a>
      </footer>
    </main>
  );
};
