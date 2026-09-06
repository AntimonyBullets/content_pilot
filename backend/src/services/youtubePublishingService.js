import fs from "fs";
import VideoSession from "../models/VideoSession.js";
import YouTubeConnection from "../models/YouTubeConnection.js";
import {
  uploadVideo,
  setThumbnail,
  getUserPlaylists,
  addVideoToPlaylist,
} from "./youtubeService.js";
import { createShortClip, cleanupShortFile } from "./shortGenerationService.js";
import { generateStructuredOutput } from "./llmService.js";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const assertYouTubeConnected = async (userId) => {
  const connection = await YouTubeConnection.findOne({ userId });

  if (!connection) {
    const error = new Error("YouTube is not connected. Please connect your YouTube account first.");
    error.code = "YOUTUBE_NOT_CONNECTED";
    throw error;
  }
};

const assertSessionOwnership = async (userId, sessionId) => {
  const session = await VideoSession.findOne({ _id: sessionId, userId });

  if (!session) {
    const error = new Error("Video session not found");
    error.code = "SESSION_NOT_FOUND";
    throw error;
  }

  return session;
};

const assertSourceVideoExists = (session) => {
  if (!session.originalVideoPath) {
    const error = new Error("Source video path is not recorded on this session");
    error.code = "MISSING_SOURCE_VIDEO";
    throw error;
  }
};

const checkSourceVideoAccessible = async (session) => {
  assertSourceVideoExists(session);

  try {
    await fs.promises.access(session.originalVideoPath, fs.constants.R_OK);
  } catch {
    const error = new Error(
      `Source video file is not accessible at: ${session.originalVideoPath}`
    );
    error.code = "MISSING_SOURCE_VIDEO";
    throw error;
  }
};

// ---------------------------------------------------------------------------
// Playlist selection via LLM
//
// Provides real playlist data to the LLM and validates the selection against
// actual playlist IDs. Returns null if selection is invalid or unavailable.
// ---------------------------------------------------------------------------

const selectPlaylistWithLLM = async (playlists, videoMetadata, llmModel) => {
  if (!playlists.length) {
    console.log("[Playlist] No playlists available — skipping assignment");
    return null;
  }

  const playlistSummary = playlists
    .map((p) => `ID: ${p.id} | Title: ${p.title} | Description: ${p.description}`)
    .join("\n");

  const schema = {
    type: "object",
    properties: {
      playlistId: { type: "string" },
      reasoning: { type: "string" },
    },
    required: ["playlistId", "reasoning"],
    additionalProperties: false,
  };

  const messages = [
    [
      "system",
      [
        "You select the most suitable YouTube playlist for a video from a provided list.",
        "You must choose a playlist ID from the list exactly as shown.",
        "If no playlist is suitable, return an empty string for playlistId.",
        "Never invent or guess a playlist ID.",
      ].join(" "),
    ],
    [
      "user",
      [
        "Select the most suitable playlist for this video.",
        "",
        "Video title:",
        videoMetadata.title,
        "",
        "Video description (excerpt):",
        String(videoMetadata.description || "").slice(0, 500),
        "",
        "Available playlists:",
        playlistSummary,
        "",
        "Return the exact playlistId from the list above, or an empty string if none is suitable.",
      ].join("\n"),
    ],
  ];

  let result;

  try {
    result = await generateStructuredOutput({ llmModel, schema, messages });
  } catch (llmError) {
    console.warn("[Playlist] LLM selection failed:", llmError.message);
    return null;
  }

  const selectedId = String(result?.playlistId || "").trim();

  if (!selectedId) {
    console.log("[Playlist] LLM found no suitable playlist — skipping assignment");
    return null;
  }

  // CRITICAL: Validate against real playlist IDs — never trust the LLM alone
  const validPlaylist = playlists.find((p) => p.id === selectedId);

  if (!validPlaylist) {
    console.warn(
      `[Playlist] LLM returned an invalid playlist ID "${selectedId}" — skipping assignment`
    );
    return null;
  }

  console.log(`[Playlist] LLM selected playlist: "${validPlaylist.title}" (${validPlaylist.id})`);
  return validPlaylist.id;
};

// ---------------------------------------------------------------------------
// Attempt optional playlist assignment after main video upload.
// Failures here are non-fatal — the main video stays published.
// ---------------------------------------------------------------------------

const attemptPlaylistAssignment = async (userId, session, youtubeVideoId) => {
  if (!session.settings.addToSuitablePlaylist) {
    return;
  }

  let playlists;

  try {
    playlists = await getUserPlaylists(userId);
  } catch (playlistError) {
    console.warn("[Playlist] Failed to retrieve playlists:", playlistError.message);
    return;
  }

  const selectedPlaylistId = await selectPlaylistWithLLM(
    playlists,
    {
      title: session.generatedContent.mainVideo.title,
      description: session.generatedContent.mainVideo.description,
    },
    session.settings.llmModel
  );

  if (!selectedPlaylistId) {
    return;
  }

  try {
    await addVideoToPlaylist(userId, youtubeVideoId, selectedPlaylistId);
    session.assignedPlaylistId = selectedPlaylistId;
    await session.save();
    console.log(`[Playlist] Added video to playlist ${selectedPlaylistId}`);
  } catch (insertError) {
    console.warn("[Playlist] Failed to add video to playlist:", insertError.message);
    // Non-fatal — main video is already published
  }
};

// ---------------------------------------------------------------------------
// Publish the main video
// ---------------------------------------------------------------------------

export const publishMainVideo = async (userId, sessionId, thumbnailPath) => {
  await assertYouTubeConnected(userId);

  const session = await assertSessionOwnership(userId, sessionId);

  // Duplicate protection
  if (session.mainVideo.status === "published") {
    const error = new Error(
      `Main video has already been published to YouTube (ID: ${session.mainVideo.youtubeVideoId})`
    );
    error.code = "ALREADY_PUBLISHED";
    throw error;
  }

  if (session.mainVideo.status === "publishing") {
    const error = new Error("Main video upload is already in progress");
    error.code = "ALREADY_PUBLISHING";
    throw error;
  }

  // Validate required content
  if (!session.generatedContent?.mainVideo?.title) {
    const error = new Error("Generated content is missing — run content generation first");
    error.code = "MISSING_GENERATED_CONTENT";
    throw error;
  }

  await checkSourceVideoAccessible(session);

  // Mark as in-progress to prevent concurrent duplicate uploads
  session.mainVideo.status = "publishing";
  session.mainVideo.errorMessage = null;
  await session.save();

  const { title, description, tags } = session.generatedContent.mainVideo;

  let youtubeVideoId;

  try {
    youtubeVideoId = await uploadVideo(userId, session.originalVideoPath, {
      title,
      description,
      tags,
    });
  } catch (uploadError) {
    session.mainVideo.status = "failed";
    session.mainVideo.errorMessage = uploadError.message;
    await session.save();
    throw uploadError;
  }

  // Mark as published before attempting optional thumbnail/playlist
  session.mainVideo.status = "published";
  session.mainVideo.youtubeVideoId = youtubeVideoId;
  session.mainVideo.publishedAt = new Date();
  session.mainVideo.errorMessage = null;
  await session.save();

  // Optional: set custom thumbnail (non-fatal if it fails)
  const effectiveThumbnailPath = thumbnailPath || session.thumbnailPath || null;

  if (effectiveThumbnailPath) {
    try {
      await setThumbnail(userId, youtubeVideoId, effectiveThumbnailPath);
    } catch (thumbError) {
      console.warn("[Thumbnail] Failed to set custom thumbnail:", thumbError.message);
    }
  }

  // Optional: playlist assignment (non-fatal)
  await attemptPlaylistAssignment(userId, session, youtubeVideoId);

  return {
    youtubeVideoId,
    title,
    publishedAt: session.mainVideo.publishedAt,
    assignedPlaylistId: session.assignedPlaylistId || null,
  };
};

// ---------------------------------------------------------------------------
// Publish the YouTube Short
// ---------------------------------------------------------------------------

export const publishShort = async (userId, sessionId) => {
  await assertYouTubeConnected(userId);

  const session = await assertSessionOwnership(userId, sessionId);

  // Duplicate protection
  if (session.short.status === "published") {
    const error = new Error(
      `Short has already been published to YouTube (ID: ${session.short.youtubeVideoId})`
    );
    error.code = "ALREADY_PUBLISHED";
    throw error;
  }

  if (session.short.status === "publishing") {
    const error = new Error("Short upload is already in progress");
    error.code = "ALREADY_PUBLISHING";
    throw error;
  }

  // Validate Short content exists
  const shortData = session.generatedContent?.short;

  if (!shortData?.title) {
    const error = new Error(
      "Short metadata is missing — make sure content was generated with enableShort=true"
    );
    error.code = "MISSING_SHORT_DATA";
    throw error;
  }

  if (
    shortData.startTime === null ||
    shortData.startTime === undefined ||
    shortData.endTime === null ||
    shortData.endTime === undefined
  ) {
    const error = new Error("Short startTime/endTime are missing from generated content");
    error.code = "INVALID_SHORT_TIMESTAMPS";
    throw error;
  }

  if (shortData.endTime <= shortData.startTime) {
    const error = new Error(
      `Short endTime (${shortData.endTime}) must be greater than startTime (${shortData.startTime})`
    );
    error.code = "INVALID_SHORT_TIMESTAMPS";
    throw error;
  }

  await checkSourceVideoAccessible(session);

  // Mark as in-progress
  session.short.status = "publishing";
  session.short.errorMessage = null;
  await session.save();

  // Build Short description with hashtags appended
  const hashtagLine = shortData.hashtags
    .map((tag) => (tag.startsWith("#") ? tag : `#${tag}`))
    .join(" ");
  const shortDescription = shortData.description
    ? `${shortData.description}\n\n${hashtagLine}`
    : hashtagLine;

  let shortClipPath = null;
  let youtubeVideoId;

  try {
    // Step 1: Create the Short clip using the AI-selected timestamps
    // (Never ask the LLM for new timestamps here)
    console.log(
      `[Short] Creating clip from ${shortData.startTime}s to ${shortData.endTime}s`
    );
    shortClipPath = await createShortClip(
      session.originalVideoPath,
      shortData.startTime,
      shortData.endTime
    );

    // Step 2: Upload to YouTube
    console.log("[Short] Uploading Short to YouTube");
    youtubeVideoId = await uploadVideo(userId, shortClipPath, {
      title: shortData.title,
      description: shortDescription,
      tags: shortData.hashtags,
      categoryId: "22",
    });
  } catch (error) {
    session.short.status = "failed";
    session.short.errorMessage = error.message;
    await session.save();

    // Always clean up temp file on failure
    await cleanupShortFile(shortClipPath);
    throw error;
  }

  // Step 3: Persist success state
  session.short.status = "published";
  session.short.youtubeVideoId = youtubeVideoId;
  session.short.publishedAt = new Date();
  session.short.errorMessage = null;
  await session.save();

  // Step 4: Clean up temp Short clip (always, after successful upload)
  await cleanupShortFile(shortClipPath);

  return {
    youtubeVideoId,
    title: shortData.title,
    publishedAt: session.short.publishedAt,
  };
};

// ---------------------------------------------------------------------------
// Full automation workflow — called when automateEntireProcess = true
//
// Flow:
//   Publish Main → Playlist (if enabled) → Short (if enableShort=true) → Done
//
// Partial failures are handled gracefully:
//   - Playlist failure does not affect main video published status
//   - Short failure does not affect main video published status
// ---------------------------------------------------------------------------

export const runAutomationWorkflow = async (userId, sessionId) => {
  const result = {
    mainVideo: null,
    short: null,
    errors: [],
  };

  // Publish main video
  try {
    console.log("[Automation] Publishing main video");
    result.mainVideo = await publishMainVideo(userId, sessionId, null);
    console.log("[Automation] Main video published:", result.mainVideo.youtubeVideoId);
  } catch (mainError) {
    console.error("[Automation] Main video publishing failed:", mainError.message);
    result.errors.push({ step: "mainVideo", message: mainError.message });
    // Cannot proceed to Short if main video failed
    return result;
  }

  // Reload session to check settings
  const session = await VideoSession.findById(sessionId);

  if (!session?.settings?.enableShort) {
    console.log("[Automation] enableShort=false — skipping Short publishing");
    return result;
  }

  // Publish Short
  try {
    console.log("[Automation] Publishing Short");
    result.short = await publishShort(userId, sessionId);
    console.log("[Automation] Short published:", result.short.youtubeVideoId);
  } catch (shortError) {
    console.error("[Automation] Short publishing failed:", shortError.message);
    result.errors.push({ step: "short", message: shortError.message });
    // Main video is already published — partial success is preserved
  }

  return result;
};

// ---------------------------------------------------------------------------
// Clean up the source video file for a session.
// Called when both main video and Short are published (or Short is not needed).
// ---------------------------------------------------------------------------

export const cleanupSourceVideo = async (session) => {
  if (!session.originalVideoPath) return;

  await fs.promises.rm(session.originalVideoPath, { force: true }).catch((error) => {
    console.warn("[Cleanup] Source video cleanup failed:", error.message);
  });
};
