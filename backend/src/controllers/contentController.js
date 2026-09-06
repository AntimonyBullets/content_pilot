import VideoSession from "../models/VideoSession.js";
import YouTubeConnection from "../models/YouTubeConnection.js";
import {
  generateContentFromTranscript,
  regenerateContentField,
} from "../services/contentGenerationService.js";
import { runAutomationWorkflow } from "../services/youtubePublishingService.js";

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

    // --- Check automation ---
    if (!normalizedSettings.automateEntireProcess) {
      // automateEntireProcess=false: stop after generation, no publishing
      return res.status(200).json({
        message: "Content generated successfully",
        content,
        sessionId,
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
// The settings and sessionId are intentionally ignored for publishing purposes.
// Regeneration is completely independent of YouTube.
// ---------------------------------------------------------------------------

export const regenerateContent = async (req, res) => {
  try {
    const regeneratedField = await regenerateContentField({
      transcript: req.body?.transcript,
      contentType: req.body?.contentType,
      field: req.body?.field,
      currentContent: req.body?.currentContent,
      message: req.body?.message,
      settings: req.body?.settings,
    });

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
