import VideoSession from "../models/VideoSession.js";
import YouTubeConnection from "../models/YouTubeConnection.js";
import {
  generateContentFromTranscript,
  regenerateContentField,
} from "../services/contentGenerationService.js";
import {
  runAutomationWorkflow,
  selectPlaylistForVideo,
} from "../services/youtubePublishingService.js";
import { getUserPlaylists } from "../services/youtubeService.js";

// ---------------------------------------------------------------------------
// Map content generation errors to HTTP status/message pairs
// ---------------------------------------------------------------------------

const errorResponse = (error) => {
  if (error.code === "MISSING_TRANSCRIPT") {
    return [400, "Transcript text is required"];
  }

  if (error.code === "MISSING_TRANSCRIPT_SEGMENTS") {
    return [400, "Timestamped transcript segments are required for this request"];
  }

  if (
    error.code === "UNSUPPORTED_LLM_MODEL" ||
    error.code === "UNSUPPORTED_CONTENT_TYPE" ||
    error.code === "UNSUPPORTED_CONTENT_FIELD" ||
    error.code === "INVALID_REGENERATION_MESSAGE"
  ) {
    return [400, error.message];
  }

  if (error.code === "MISSING_GEMINI_API_KEY" || error.code === "MISSING_GEMINI_MODEL") {
    return [500, "Gemini is not configured"];
  }

  if (error.code === "INVALID_LLM_RESPONSE") {
    return [502, "The LLM returned an invalid content response"];
  }

  if (error.code === "LLM_PROVIDER_ERROR") {
    return [502, "Gemini content generation failed"];
  }

  return [500, "Unable to generate content"];
};

// ---------------------------------------------------------------------------
// Playlist selection during generation.
// Returns the selected playlist object or null. Never throws — playlist
// selection must not prevent content generation from succeeding.
// ---------------------------------------------------------------------------

const selectPlaylistDuringGenerate = async (userId, session) => {
  if (!session.settings?.addToSuitablePlaylist) {
    return null;
  }

  const connection = await YouTubeConnection.findOne({ userId });

  if (!connection) {
    console.warn("[Playlist] YouTube not connected — skipping playlist selection during generate");
    return null;
  }

  let playlists;

  try {
    playlists = await getUserPlaylists(userId);
  } catch (error) {
    console.warn("[Playlist] Failed to retrieve playlists during generate:", error.message);
    return null;
  }

  const selected = await selectPlaylistForVideo({
    playlists,
    videoMetadata: {
      title: session.generatedContent.mainVideo.title,
      description: session.generatedContent.mainVideo.description,
    },
    llmModel: session.settings.llmModel,
  });

  if (!selected) {
    return null;
  }

  session.selectedPlaylistId = selected.id;
  await session.save();

  return {
    id: selected.id,
    title: selected.title,
    description: selected.description,
  };
};

// ---------------------------------------------------------------------------
// POST /api/content/generate
//
// Generates content from the provided transcript.
//
// If `sessionId` is provided:
//   - Loads and verifies session ownership
//   - Persists generated content and settings to the session
//   - If automateEntireProcess=true and YouTube is connected:
//       → Runs the full automation workflow and returns publishing results
//
// If `sessionId` is absent:
//   - Behaves exactly as before (stateless, backward-compatible)
// ---------------------------------------------------------------------------

export const generateContent = async (req, res) => {
  const { transcript, settings, sessionId } = req.body || {};

  try {
    const content = await generateContentFromTranscript({ transcript, settings });

    // --- Stateless path (no sessionId) — preserve existing behavior ---
    if (!sessionId) {
      return res.status(200).json({
        message: "Content generated successfully",
        content,
      });
    }

    // --- Stateful path (sessionId provided) ---

    // Load and verify session ownership
    const session = await VideoSession.findOne({
      _id: sessionId,
      userId: req.user._id,
    });

    if (!session) {
      return res.status(404).json({ message: "Video session not found" });
    }

    // Normalize settings (reuse the same normalizeBool logic applied in contentGenerationService)
    const normalizeBool = (v) => v === true || v === "true" || v === 1 || v === "1";

    const normalizedSettings = {
      enableShort: normalizeBool(settings?.enableShort),
      automateEntireProcess: normalizeBool(settings?.automateEntireProcess),
      createChapters: normalizeBool(settings?.createChapters),
      addToSuitablePlaylist: normalizeBool(settings?.addToSuitablePlaylist),
      llmModel: settings?.llmModel || "gemini",
    };

    // Persist generated content and settings snapshot to the session
    session.generatedContent = {
      mainVideo: content.mainVideo,
      short: content.short || null,
    };
    session.settings = normalizedSettings;
    await session.save();

    // Playlist selection happens during generate (Main video only)
    const playlist = await selectPlaylistDuringGenerate(req.user._id, session);

    // --- Check automation ---
    if (!normalizedSettings.automateEntireProcess) {
      // automateEntireProcess=false: stop after generation, no publishing
      return res.status(200).json({
        message: "Content generated successfully",
        content,
        sessionId,
        playlist,
      });
    }

    // automateEntireProcess=true: verify YouTube is connected
    const ytConnection = await YouTubeConnection.findOne({ userId: req.user._id });

    if (!ytConnection) {
      // YouTube not connected — return generated content without publishing
      console.warn(
        "[Automation] automateEntireProcess=true but YouTube is not connected — skipping auto-publish"
      );
      return res.status(200).json({
        message:
          "Content generated successfully. Automatic publishing was skipped because YouTube is not connected.",
        content,
        sessionId,
        playlist,
        automationSkipped: true,
        automationSkipReason: "YouTube not connected",
      });
    }

    // Run the full automation workflow inline
    console.log("[Automation] Running automation workflow for session", sessionId);
    let automationResult;

    try {
      automationResult = await runAutomationWorkflow(req.user._id, sessionId);
    } catch (automationError) {
      // Automation crashed unexpectedly — content is already saved, return partial result
      console.error("[Automation] Workflow error:", automationError.message);
      return res.status(200).json({
        message: "Content generated successfully, but automation encountered an error.",
        content,
        sessionId,
        playlist,
        automation: {
          attempted: true,
          mainVideo: null,
          short: null,
          errors: [{ step: "automation", message: automationError.message }],
        },
      });
    }

    const hasErrors = automationResult.errors.length > 0;
    const message = hasErrors
      ? "Content generated. Automation completed with some errors."
      : "Content generated and published automatically.";

    return res.status(200).json({
      message,
      content,
      sessionId,
      playlist,
      automation: {
        attempted: true,
        mainVideo: automationResult.mainVideo,
        short: automationResult.short,
        errors: automationResult.errors,
      },
    });
  } catch (error) {
    const [status, message] = errorResponse(error);
    console.error("Content generation error:", error.message);
    return res.status(status).json({ message });
  }
};

// ---------------------------------------------------------------------------
// POST /api/content/regenerate
//
// Regenerates a specific metadata field.
//
// MUST NEVER:
//   - publish the main video
//   - publish the Short
//   - create a Short clip
//   - upload a thumbnail
//   - add anything to a playlist
//   - trigger automateEntireProcess
//   - call YouTube publishing operations
//   - regenerate startTime or endTime
//
// Regeneration is session-aware: transcript, current content, and settings are
// read from the authoritative VideoSession (not from the client). The updated
// field is persisted back into session.generatedContent.
// ---------------------------------------------------------------------------

export const regenerateContent = async (req, res) => {
  const { sessionId, contentType, field } = req.body || {};

  try {
    // Regeneration is session-aware: server-side session is authoritative.
    if (!sessionId) {
      return res.status(400).json({ message: "sessionId is required" });
    }

    // Short timestamps are fixed at generation time and must never be regenerated.
    if (field === "startTime" || field === "endTime") {
      const error = new Error("Short startTime/endTime cannot be regenerated");
      error.code = "UNSUPPORTED_CONTENT_FIELD";
      throw error;
    }

    // Load and verify session ownership
    const session = await VideoSession.findOne({
      _id: sessionId,
      userId: req.user._id,
    });

    if (!session) {
      return res.status(404).json({ message: "Video session not found" });
    }

    if (!session.generatedContent?.[contentType]) {
      const error = new Error("Unsupported content type");
      error.code = "UNSUPPORTED_CONTENT_TYPE";
      throw error;
    }

    const regeneratedField = await regenerateContentField({
      transcript: session.transcript,
      contentType,
      field,
      currentContent: session.generatedContent[contentType],
      message: req.body?.message,
      settings: session.settings,
    });

    // Persist the regenerated field back into the session so it becomes the
    // source of truth for future publishing.
    session.generatedContent[contentType][regeneratedField.field] =
      regeneratedField.value;
    await session.save();

    return res.status(200).json({
      message: "Content field regenerated successfully",
      regeneratedField,
    });
  } catch (error) {
    const [status, message] = errorResponse(error);
    console.error("Content regeneration error:", error.message);
    return res.status(status).json({ message });
  }
};
