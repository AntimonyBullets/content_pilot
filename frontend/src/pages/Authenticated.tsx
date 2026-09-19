import React from "react";
import { useEffect, useRef, useState } from "react";
import axios from "axios";
import {
  generateContent,
  getGeneratedThumbnail,
  getLatestVideoSession,
  getSourceVideoPreview,
  getShortPreview,
  getYouTubePlaylists,
  publishMainVideo,
  publishShortVideo,
  regenerateContentField,
  transcribeVideo,
  transcribeVideoUrl,
  uploadShortThumbnail,
  uploadThumbnail,
} from "../api/client";
import type { ContentSettings, GeneratedContent, YouTubePlaylist } from "../api/client";
import { getYouTubeConnectUrl } from "../api/client";
import { useAuth } from "../context/AuthContext";

type SettingsTab = "general" | "account";
type RegenerationTarget = {
  contentType: "mainVideo" | "short";
  field: "title" | "description" | "tags" | "hashtags";
  label: string;
};

export const Authenticated: React.FC = () => {
  const {
    user,
    youtubeStatus,
    youtubeLoading,
    youtubeNotice,
    clearNotice,
    logout,
    disconnectYouTube,
  } = useAuth();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const transcriptRef = useRef<Awaited<ReturnType<typeof transcribeVideo>>["transcript"] | null>(
    null
  );
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [videoUrl, setVideoUrl] = useState("");
  const [transcribing, setTranscribing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [hasGeneratedContent, setHasGeneratedContent] = useState(false);
  const [generatedContent, setGeneratedContent] = useState<GeneratedContent | null>(null);
  const [sourceVideoUrl, setSourceVideoUrl] = useState<string | null>(null);
  const [shortPreviewUrl, setShortPreviewUrl] = useState<string | null>(null);
  const [shortPreviewLoading, setShortPreviewLoading] = useState(false);
  const [generatedThumbnailUrl, setGeneratedThumbnailUrl] = useState<string | null>(null);
  const [playlists, setPlaylists] = useState<YouTubePlaylist[]>([]);
  const [selectedPlaylistId, setSelectedPlaylistId] = useState("");
  const [recommendedPlaylistId, setRecommendedPlaylistId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [regenerationTarget, setRegenerationTarget] = useState<RegenerationTarget | null>(null);
  const [regenerationMessage, setRegenerationMessage] = useState("");
  const [regeneratingField, setRegeneratingField] = useState<string | null>(null);
  const [publishingMain, setPublishingMain] = useState(false);
  const [publishingShort, setPublishingShort] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("general");
  const [contentSettings, setContentSettings] = useState<ContentSettings>({
    enableShort: false,
    automateEntireProcess: false,
    createChapters: false,
    addToSuitablePlaylist: false,
    generateThumbnail: false,
    llmModel: "gemini-3.6-flash",
  });
  const isConnected = youtubeStatus?.connected ?? false;

  useEffect(() => {
    if (!youtubeNotice) return;

    const timeoutId = window.setTimeout(clearNotice, 4000);
    return () => window.clearTimeout(timeoutId);
  }, [youtubeNotice, clearNotice]);

  useEffect(() => {
    let cancelled = false;

    const restoreLatestSession = async () => {
      try {
        const response = await getLatestVideoSession();
        const restored = response.session;

        if (cancelled || !restored) return;

        setSessionId(restored.id);
        transcriptRef.current = restored.transcript;
        setGeneratedContent(restored.generatedContent);
        setHasGeneratedContent(Boolean(restored.generatedContent?.mainVideo?.title));
        setContentSettings(restored.settings);
        setSelectedPlaylistId(restored.selectedPlaylistId || "");

        try {
          const sourceVideoBlob = await getSourceVideoPreview(restored.id);
          if (cancelled) return;
          setSourceVideoUrl((current) => {
            if (current?.startsWith("blob:")) URL.revokeObjectURL(current);
            return URL.createObjectURL(sourceVideoBlob);
          });
        } catch {
          if (!cancelled) setSourceVideoUrl(null);
        }

        if (restored.hasGeneratedThumbnail) {
          try {
            const thumbnailBlob = await getGeneratedThumbnail(restored.id);
            if (cancelled) return;
            setGeneratedThumbnailUrl((current) => {
              if (current) URL.revokeObjectURL(current);
              return URL.createObjectURL(thumbnailBlob);
            });
          } catch {
            if (!cancelled) setGeneratedThumbnailUrl(null);
          }
        }
      } catch (requestError) {
        if (!cancelled) {
          console.error("Failed to restore latest video session:", requestError);
        }
      }
    };

    void restoreLatestSession();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (sourceVideoUrl?.startsWith("blob:")) {
        URL.revokeObjectURL(sourceVideoUrl);
      }
    };
  }, [sourceVideoUrl]);

  useEffect(() => {
    return () => {
      if (generatedThumbnailUrl) {
        URL.revokeObjectURL(generatedThumbnailUrl);
      }
    };
  }, [generatedThumbnailUrl]);

  useEffect(() => {
    if (!sessionId || !generatedContent?.short || !contentSettings.enableShort) {
      setShortPreviewUrl(null);
      setShortPreviewLoading(false);
      return;
    }

    let previewUrl: string | null = null;
    let cancelled = false;
    setShortPreviewUrl(null);
    setShortPreviewLoading(true);

    void getShortPreview(sessionId)
      .then((blob) => {
        if (cancelled) return;
        previewUrl = URL.createObjectURL(blob);
        setShortPreviewUrl(previewUrl);
      })
      .catch(() => {
        if (!cancelled) setShortPreviewUrl(null);
      })
      .finally(() => {
        if (!cancelled) setShortPreviewLoading(false);
      });

    return () => {
      cancelled = true;
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [
    sessionId,
    generatedContent?.short?.startTime,
    generatedContent?.short?.endTime,
    contentSettings.enableShort,
  ]);

  useEffect(() => {
    if (!contentSettings.addToSuitablePlaylist || !sessionId) return;
    void loadPlaylists();
  }, [contentSettings.addToSuitablePlaylist, sessionId]);

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
    setGeneratedContent(null);
    setGeneratedThumbnailUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return null;
    });
    setHasGeneratedContent(false);
    setSelectedPlaylistId("");
    setRecommendedPlaylistId(null);
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
      setSourceVideoUrl((current) => {
        if (current?.startsWith("blob:")) URL.revokeObjectURL(current);
        return URL.createObjectURL(file);
      });
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
    setSourceVideoUrl(trimmedUrl);
    void startTranscription(() => transcribeVideoUrl(trimmedUrl));
  };

  const handleGenerateContent = async () => {
    if (!sessionId || !transcriptRef.current) return;

    setError(null);
    setMessage(null);
    setGenerating(true);
    try {
      const response = await generateContent(sessionId, transcriptRef.current, contentSettings);
      setGeneratedContent(response.content);
      if (response.thumbnail?.type === "generated") {
        try {
          const thumbnailBlob = await getGeneratedThumbnail(sessionId);
          setGeneratedThumbnailUrl((current) => {
            if (current) URL.revokeObjectURL(current);
            return URL.createObjectURL(thumbnailBlob);
          });
        } catch {
          setGeneratedThumbnailUrl(null);
        }
      } else {
        setGeneratedThumbnailUrl(null);
      }
      setHasGeneratedContent(true);
      const recommendedId = response.playlist?.id || null;
      setRecommendedPlaylistId(recommendedId);
      setSelectedPlaylistId(recommendedId || "");
      setMessage(
        response.thumbnailError
          ? `Content generated successfully. ${response.thumbnailError}`
          : "Content generated successfully."
      );
    } catch (requestError) {
      setError(getErrorMessage(requestError, "Unable to generate content. Please try again."));
    } finally {
      setGenerating(false);
    }
  };

  const openRegeneration = (target: RegenerationTarget) => {
    setError(null);
    setRegenerationMessage("");
    setRegenerationTarget(target);
  };

  const handleRegenerate = async () => {
    if (!sessionId || !regenerationTarget || regeneratingField) return;

    const target = regenerationTarget;
    const fieldKey = `${target.contentType}.${target.field}`;
    setRegeneratingField(fieldKey);
    setError(null);

    try {
      const response = await regenerateContentField({
        sessionId,
        contentType: target.contentType,
        field: target.field,
        message: regenerationMessage.trim(),
      });
      const value = response.regeneratedField.value;

      setGeneratedContent((current) => {
        if (!current) return current;
        if (target.contentType === "mainVideo") {
          return {
            ...current,
            mainVideo: {
              ...current.mainVideo,
              [target.field]: value,
            },
          };
        }
        if (!current.short) return current;
        return {
          ...current,
          short: {
            ...current.short,
            [target.field]: value,
          },
        };
      });
      setRegenerationTarget(null);
    } catch (requestError) {
      setError(getErrorMessage(requestError, "Unable to regenerate this field."));
    } finally {
      setRegeneratingField(null);
    }
  };

  const handlePublishMain = async () => {
    if (!sessionId || !generatedContent || publishingMain) return;
    setPublishingMain(true);
    setError(null);
    try {
      const response = await publishMainVideo(
        sessionId,
        generatedContent.mainVideo,
        selectedPlaylistId || null
      );
      setMessage(`${response.message} (ID: ${response.youtubeVideoId})`);
    } catch (requestError) {
      setError(getErrorMessage(requestError, "Unable to publish the Main Video."));
    } finally {
      setPublishingMain(false);
    }
  };

  const handlePublishShort = async () => {
    if (!sessionId || !generatedContent?.short || publishingShort) return;
    setPublishingShort(true);
    setError(null);
    try {
      const response = await publishShortVideo(sessionId, generatedContent.short);
      setMessage(`${response.message} (ID: ${response.youtubeVideoId})`);
    } catch (requestError) {
      setError(getErrorMessage(requestError, "Unable to publish the Short."));
    } finally {
      setPublishingShort(false);
    }
  };

  async function loadPlaylists() {
    try {
      const response = await getYouTubePlaylists();
      setPlaylists(response.playlists);
    } catch (requestError) {
      setError(getErrorMessage(requestError, "Unable to load playlists."));
    }
  }

  return (
    <main className="homepage">
      <button
        type="button"
        className="settings-button"
        aria-label="Settings"
        onClick={() => setShowSettings(true)}
      >
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
          <div className="youtube-toast" role="status" onClick={clearNotice}>
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

        {sessionId && !transcribing && sourceVideoUrl && (
          <section className="video-preview-section" aria-label="Source video preview">
            <h2>Source Video</h2>
            <video className="video-preview" src={sourceVideoUrl} controls preload="metadata" />
          </section>
        )}

        {sessionId && !transcribing && (
          <button
            type="button"
            className="generate-button"
            onClick={() => void handleGenerateContent()}
            disabled={generating}
          >
            {generating ? "Generating..." : hasGeneratedContent ? "Regenerate" : "Generate Content"}
          </button>
        )}

        {generatedContent && !transcribing && (
          <section className="generated-content">
            <h2>Main Video</h2>
            <EditableContentField
              label="Title"
              value={generatedContent.mainVideo.title}
              onChange={(value) =>
                setGeneratedContent((current) =>
                  current
                    ? { ...current, mainVideo: { ...current.mainVideo, title: value } }
                    : current
                )
              }
              onRegenerate={() =>
                openRegeneration({
                  contentType: "mainVideo",
                  field: "title",
                  label: "Main Video Title",
                })
              }
              regenerating={regeneratingField === "mainVideo.title"}
            />
            <EditableContentField
              label="Description"
              value={generatedContent.mainVideo.description}
              multiline
              onChange={(value) =>
                setGeneratedContent((current) =>
                  current
                    ? { ...current, mainVideo: { ...current.mainVideo, description: value } }
                    : current
                )
              }
              onRegenerate={() =>
                openRegeneration({
                  contentType: "mainVideo",
                  field: "description",
                  label: "Main Video Description",
                })
              }
              regenerating={regeneratingField === "mainVideo.description"}
            />
            <EditableContentField
              label="Tags"
              value={generatedContent.mainVideo.tags.join(", ")}
              multiline
              onChange={(value) =>
                setGeneratedContent((current) =>
                  current
                    ? {
                        ...current,
                        mainVideo: {
                          ...current.mainVideo,
                          tags: value.split(",").map((tag) => tag.trim()).filter(Boolean),
                        },
                      }
                    : current
                )
              }
              onRegenerate={() =>
                openRegeneration({
                  contentType: "mainVideo",
                  field: "tags",
                  label: "Main Video Tags",
                })
              }
              regenerating={regeneratingField === "mainVideo.tags"}
            />
            {contentSettings.addToSuitablePlaylist && (
              <div className="playlist-control">
                <label htmlFor="playlist-select">Playlist</label>
                <select
                  id="playlist-select"
                  value={selectedPlaylistId}
                  onChange={(event) => setSelectedPlaylistId(event.target.value)}
                  onFocus={() => {
                    if (!playlists.length) void loadPlaylists();
                  }}
                >
                  <option value="">No playlist</option>
                  {playlists.map((playlist) => (
                    <option key={playlist.id} value={playlist.id}>
                      {playlist.title}
                      {playlist.id === recommendedPlaylistId ? " (Recommended)" : ""}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <ThumbnailUpload
              sessionId={sessionId}
              upload={uploadThumbnail}
              recommendedSize="1280 × 720 px"
              generatedPreviewUrl={generatedThumbnailUrl}
            />
            <button
              type="button"
              className="publish-button"
              onClick={() => void handlePublishMain()}
              disabled={publishingMain || publishingShort}
            >
              {publishingMain ? "Publishing..." : "Publish Main Video"}
            </button>

            {contentSettings.enableShort && generatedContent.short && (
              <div className="short-video-section">
                <h2>Short Video</h2>
                {shortPreviewLoading && (
                  <div className="short-preview-status" role="status">
                    Generating Short Preview...
                  </div>
                )}
                {shortPreviewUrl && !shortPreviewLoading && (
                  <video
                    className="video-preview"
                    src={shortPreviewUrl}
                    controls
                    preload="metadata"
                    aria-label="Short video preview"
                  />
                )}
                <EditableContentField
                  label="Title"
                  value={generatedContent.short.title}
                  onChange={(value) =>
                    setGeneratedContent((current) =>
                      current?.short
                        ? { ...current, short: { ...current.short, title: value } }
                        : current
                    )
                  }
                  onRegenerate={() =>
                    openRegeneration({
                      contentType: "short",
                      field: "title",
                      label: "Short Title",
                    })
                  }
                  regenerating={regeneratingField === "short.title"}
                />
                <EditableContentField
                  label="Description"
                  value={generatedContent.short.description}
                  multiline
                  onChange={(value) =>
                    setGeneratedContent((current) =>
                      current?.short
                        ? { ...current, short: { ...current.short, description: value } }
                        : current
                    )
                  }
                  onRegenerate={() =>
                    openRegeneration({
                      contentType: "short",
                      field: "description",
                      label: "Short Description",
                    })
                  }
                  regenerating={regeneratingField === "short.description"}
                />
                <EditableContentField
                  label="Hashtags"
                  value={generatedContent.short.hashtags.join(" ")}
                  onChange={(value) =>
                    setGeneratedContent((current) =>
                      current?.short
                        ? {
                            ...current,
                            short: {
                              ...current.short,
                              hashtags: value.split(/\s+/).map((tag) => tag.trim()).filter(Boolean),
                            },
                          }
                        : current
                    )
                  }
                  onRegenerate={() =>
                    openRegeneration({
                      contentType: "short",
                      field: "hashtags",
                      label: "Short Hashtags",
                    })
                  }
                  regenerating={regeneratingField === "short.hashtags"}
                />
                <ThumbnailUpload
                  sessionId={sessionId}
                  upload={uploadShortThumbnail}
                  recommendedSize="1080 × 1920 px"
                />
                <button
                  type="button"
                  className="publish-button"
                  onClick={() => void handlePublishShort()}
                  disabled={publishingShort || publishingMain}
                >
                  {publishingShort ? "Publishing..." : "Publish Short Video"}
                </button>
              </div>
            )}
          </section>
        )}
      </section>

      {regenerationTarget && (
        <div
          className="regeneration-modal-backdrop"
          role="presentation"
          onMouseDown={() => {
            if (!regeneratingField) setRegenerationTarget(null);
          }}
        >
          <div
            className="regeneration-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="regeneration-modal-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <h2 id="regeneration-modal-title">Regenerate {regenerationTarget.label}</h2>
            <label htmlFor="regeneration-instruction">Optional instruction</label>
            <textarea
              id="regeneration-instruction"
              value={regenerationMessage}
              onChange={(event) => setRegenerationMessage(event.target.value)}
              placeholder="Leave empty to regenerate normally."
              disabled={Boolean(regeneratingField)}
              rows={3}
            />
            {regeneratingField && <small>Regenerating...</small>}
            <div className="regeneration-modal-actions">
              <button
                type="button"
                className="secondary"
                onClick={() => setRegenerationTarget(null)}
                disabled={Boolean(regeneratingField)}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleRegenerate()}
                disabled={Boolean(regeneratingField)}
              >
                {regeneratingField ? "Regenerating..." : "Proceed"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showSettings && (
        <div
          className="settings-modal-backdrop"
          role="presentation"
          onMouseDown={() => setShowSettings(false)}
        >
          <div
            className="settings-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-modal-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="settings-modal-close"
              aria-label="Close settings"
              onClick={() => setShowSettings(false)}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="m6 6 12 12M18 6 6 18" />
              </svg>
            </button>

            <aside className="settings-sidebar">
              <h2 id="settings-modal-title">Settings</h2>
              <button
                type="button"
                className={settingsTab === "general" ? "settings-tab active" : "settings-tab"}
                onClick={() => setSettingsTab("general")}
              >
                General
              </button>
              <button
                type="button"
                className={settingsTab === "account" ? "settings-tab active" : "settings-tab"}
                onClick={() => setSettingsTab("account")}
              >
                Account
              </button>
            </aside>

            <section className="settings-panel">
              {settingsTab === "general" ? (
                <>
                  <h3>General</h3>
                  <div className="settings-list">
                    {([
                      ["enableShort", "Enable Short Video"],
                      ["createChapters", "Create Chapters"],
                      ["addToSuitablePlaylist", "Add to Suitable Playlist"],
                      ["generateThumbnail", "Generate Thumbnail"],
                    ] as const).map(([key, label]) => (
                      <label className="setting-row" key={key}>
                        <span className="setting-copy">
                          <strong>{label}</strong>
                          <small>
                            {key === "enableShort"
                              ? "Generate a short-form version alongside the main video."
                              : key === "createChapters"
                                ? "Add chapter timestamps to the generated video description."
                                : key === "addToSuitablePlaylist"
                                  ? "Choose and add the video to a relevant YouTube playlist."
                                  : key === "generateThumbnail"
                                    ? "Generate an optional AI thumbnail for the Main Video."
                                    : "Automatically continue through generation and publishing when possible."}
                          </small>
                        </span>
                        <input
                          className="toggle-input"
                          type="checkbox"
                          checked={contentSettings[key]}
                          onChange={(event) =>
                            setContentSettings((current) => ({
                              ...current,
                              [key]: event.target.checked,
                            }))
                          }
                        />
                        <span className="toggle-control" aria-hidden="true" />
                      </label>
                    ))}
                    <label className="setting-row" htmlFor="llm-model">
                      <span className="setting-copy">
                        <strong>LLM Model</strong>
                        <small>Select the language model used to generate your content.</small>
                      </span>
                      <select
                        id="llm-model"
                        value={contentSettings.llmModel}
                        onChange={(event) =>
                          setContentSettings((current) => ({
                            ...current,
                            llmModel: event.target.value,
                          }))
                        }
                      >
                        <option value="gemini-3.6-flash">gemini-3.6-flash</option>
                        <option value="openai/gpt-oss-120b">openai/gpt-oss-120b</option>
                      </select>
                    </label>
                    <label className="setting-row">
                      <span className="setting-copy">
                        <strong>Automate Entire Process</strong>
                        <small>
                          Automatically continue through generation and publishing when possible.
                        </small>
                      </span>
                      <input
                        className="toggle-input"
                        type="checkbox"
                        checked={contentSettings.automateEntireProcess}
                        onChange={(event) =>
                          setContentSettings((current) => ({
                            ...current,
                            automateEntireProcess: event.target.checked,
                          }))
                        }
                      />
                      <span className="toggle-control" aria-hidden="true" />
                    </label>
                  </div>
                </>
              ) : (
                <>
                  <h3>Account</h3>
                  <div className="account-settings">
                    <div className="account-email">
                      <span className="account-label">Email</span>
                      <span>{user?.email || "Unknown"}</span>
                    </div>
                    <div className="account-action">
                      <div>
                        <span className="account-label">YouTube</span>
                        <span>{isConnected ? "Connected" : "Not connected"}</span>
                      </div>
                      {isConnected ? (
                        <button
                          type="button"
                          className="account-button"
                          onClick={() => void disconnectYouTube()}
                          disabled={youtubeLoading}
                        >
                          <YouTubeIcon />
                          Disconnect
                        </button>
                      ) : (
                        <a className="account-button" href={getYouTubeConnectUrl()}>
                          <YouTubeIcon />
                          Connect
                        </a>
                      )}
                    </div>
                    <div className="account-action">
                      <div>
                        <span className="account-label">Session</span>
                        <span>Sign out of ContentPilot</span>
                      </div>
                      <button type="button" className="account-button" onClick={() => void logout()}>
                        <LogoutIcon />
                        Logout
                      </button>
                    </div>
                  </div>
                </>
              )}
            </section>
          </div>
        </div>
      )}

      <footer className="homepage-footer">
        ContentPilot by{" "}
        <a href="https://github.com/AntimonyBullets" target="_blank" rel="noreferrer">
          AntimonyBullets (Shashank Khatri)
        </a>
      </footer>
    </main>
  );
};

type ThumbnailUploadProps = {
  sessionId: string | null;
  upload: (sessionId: string, thumbnail: File) => Promise<{ thumbnailPath: string }>;
  recommendedSize: string;
  generatedPreviewUrl?: string | null;
};

const ThumbnailUpload: React.FC<ThumbnailUploadProps> = ({
  sessionId,
  upload,
  recommendedSize,
  generatedPreviewUrl = null,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploaded, setUploaded] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file || !sessionId) return;

    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(URL.createObjectURL(file));
    setFileName(file.name);
    setUploaded(false);
    setUploadError(null);
    setUploading(true);

    try {
      await upload(sessionId, file);
      setUploaded(true);
    } catch (requestError) {
      setUploadError(
        axios.isAxiosError<{ message?: string }>(requestError)
          ? requestError.response?.data?.message || "Unable to upload thumbnail."
          : "Unable to upload thumbnail."
      );
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="thumbnail-upload">
      <span className="thumbnail-upload-label">Thumbnail (Optional)</span>
      <small>Recommended size: {recommendedSize}</small>
      <input
        ref={fileInputRef}
        className="visually-hidden"
        type="file"
        accept="image/jpeg,image/png,image/jpg,.jpg,.jpeg,.png"
        onChange={(event) => void handleFileChange(event)}
        disabled={!sessionId || uploading}
      />
      <button
        type="button"
        className="thumbnail-upload-button"
        onClick={() => fileInputRef.current?.click()}
        disabled={!sessionId || uploading}
      >
        {uploading ? "Uploading..." : fileName ? "Choose a different image" : "Choose image"}
      </button>
      {!previewUrl && generatedPreviewUrl && (
        <div className="thumbnail-upload-preview">
          <img src={generatedPreviewUrl} alt="AI-generated Main Video thumbnail preview" />
          <span>Generated by AI</span>
        </div>
      )}
      {previewUrl && (
        <div className="thumbnail-upload-preview">
          <img src={previewUrl} alt={`${fileName || "Selected"} thumbnail preview`} />
          <span>
            {fileName}
            {uploaded && " · Uploaded"}
          </span>
        </div>
      )}
      {uploadError && <small className="thumbnail-upload-error">{uploadError}</small>}
    </div>
  );
};

type EditableContentFieldProps = {
  label: string;
  value: string;
  multiline?: boolean;
  onChange: (value: string) => void;
  onRegenerate: () => void;
  regenerating?: boolean;
};

const EditableContentField: React.FC<EditableContentFieldProps> = ({
  label,
  value,
  multiline = false,
  onChange,
  onRegenerate,
  regenerating = false,
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea || !multiline) return;

    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [value, multiline]);

  return (
    <label className="content-field">
      <span>{label}</span>
      <div className="content-field-input">
        {multiline ? (
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            rows={1}
          />
        ) : (
          <input value={value} onChange={(event) => onChange(event.target.value)} />
        )}
        <button
          type="button"
          className="field-regenerate"
          onClick={onRegenerate}
          disabled={regenerating}
        >
          {regenerating ? "..." : "Regenerate"}
        </button>
      </div>
    </label>
  );
};

const YouTubeIcon: React.FC = () => (
  <svg className="action-icon youtube-icon" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.4.5A3 3 0 0 0 .5 6.2 31 31 0 0 0 0 12a31 31 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1A31 31 0 0 0 24 12a31 31 0 0 0-.5-5.8Z" />
    <path className="youtube-play" d="m9.6 15.8 6.2-3.8-6.2-3.8v7.6Z" />
  </svg>
);

const LogoutIcon: React.FC = () => (
  <svg className="action-icon" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M10 17v2a2 2 0 0 0 2 2h7a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v2M15 12H3m0 0 4-4m-4 4 4 4" />
  </svg>
);
