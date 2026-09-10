import crypto from "crypto";
import OAuthState from "../models/OAuthState.js";
import YouTubeConnection from "../models/YouTubeConnection.js";
import VideoSession from "../models/VideoSession.js";
import {
  generateAuthUrl,
  exchangeCodeForTokens,
  getChannelInfo,
  getUserPlaylists,
  revokeYouTubeAuthorization,
} from "../services/youtubeService.js";
import {
  publishMainVideo as publishMainVideoService,
  publishShort as publishShortService,
} from "../services/youtubePublishingService.js";

// ---------------------------------------------------------------------------
// Safe channel info — never exposes tokens
// ---------------------------------------------------------------------------

const safeChannelInfo = (connection) => ({
  channelId: connection.channelId,
  channelTitle: connection.channelTitle,
  channelThumbnailUrl: connection.channelThumbnailUrl,
  connectedAt: connection.connectedAt,
});

// ---------------------------------------------------------------------------
// GET /api/youtube/connect
// Requires ContentPilot authentication (protect middleware).
// Generates a Google OAuth authorization URL and redirects the user.
// ---------------------------------------------------------------------------

export const connectYouTube = async (req, res) => {
  try {
    // Generate a cryptographically secure random state value for CSRF protection
    const state = crypto.randomBytes(32).toString("hex");

    // Persist the state token associated with the authenticated user
    await OAuthState.create({ state, userId: req.user._id });

    const authUrl = generateAuthUrl(state);

    return res.redirect(authUrl);
  } catch (error) {
    if (error.code === "MISSING_YOUTUBE_CONFIG") {
      return res.status(500).json({ message: error.message });
    }

    console.error("[YouTube] Connect error:", error.message);
    return res.status(500).json({ message: "Unable to initiate YouTube authorization" });
  }
};

// ---------------------------------------------------------------------------
// GET /api/youtube/oauth/callback
// No JWT auth — validated via the OAuth state parameter instead.
// Exchanges the authorization code for tokens and saves the connection.
// ---------------------------------------------------------------------------

export const oauthCallback = async (req, res) => {
  const { code, state, error: oauthError } = req.query;

  // Handle user-denied access or other OAuth errors from Google
  if (oauthError) {
    console.warn("[YouTube] OAuth denied/error:", oauthError);
    return res.redirect(
      `${process.env.FRONTEND_ORIGIN || "http://localhost:5173"}?youtube_auth=error&reason=${encodeURIComponent(oauthError)}`
    );
  }

  if (!state || !code) {
    return res.status(400).json({ message: "Missing OAuth state or code" });
  }

  // Validate and consume the state token (one-time use)
  const stateDoc = await OAuthState.findOneAndDelete({ state });

  if (!stateDoc) {
    console.warn("[YouTube] Invalid or expired OAuth state:", state);
    return res.status(400).json({ message: "Invalid or expired OAuth state. Please try connecting again." });
  }

  const userId = stateDoc.userId;

  try {
    // Exchange authorization code for tokens
    const tokens = await exchangeCodeForTokens(code);

    if (!tokens.refresh_token) {
      // This can happen if the user previously granted access without the prompt: consent option.
      // Since we always request prompt: consent in generateAuthUrl, this should be rare.
      console.warn("[YouTube] No refresh_token returned from Google. Tokens:", Object.keys(tokens));
    }

    // Retrieve the user's YouTube channel information
    let channelInfo = null;

    try {
      channelInfo = await getChannelInfo(tokens);
    } catch (channelError) {
      console.warn("[YouTube] Failed to retrieve channel info:", channelError.message);
    }

    // Upsert the YouTube connection (one per ContentPilot user)
    await YouTubeConnection.findOneAndUpdate(
      { userId },
      {
        userId,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        tokenExpiryDate: new Date(tokens.expiry_date),
        channelId: channelInfo?.channelId || null,
        channelTitle: channelInfo?.channelTitle || null,
        channelThumbnailUrl: channelInfo?.channelThumbnailUrl || null,
        connectedAt: new Date(),
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    console.log(`[YouTube] Connection saved for user ${userId}`);

    // Redirect back to the frontend with a success indicator
    return res.redirect(
      `${process.env.FRONTEND_ORIGIN || "http://localhost:5173"}?youtube_auth=success`
    );
  } catch (error) {
    console.error("[YouTube] OAuth callback error:", error.message);
    return res.redirect(
      `${process.env.FRONTEND_ORIGIN || "http://localhost:5173"}?youtube_auth=error&reason=server_error`
    );
  }
};

// ---------------------------------------------------------------------------
// GET /api/youtube/status
// Requires ContentPilot authentication.
// Returns whether YouTube is connected and safe channel metadata.
// ---------------------------------------------------------------------------

export const getYouTubeStatus = async (req, res) => {
  try {
    const connection = await YouTubeConnection.findOne({ userId: req.user._id });

    if (!connection) {
      return res.status(200).json({ connected: false, channel: null });
    }

    return res.status(200).json({
      connected: true,
      channel: safeChannelInfo(connection),
    });
  } catch (error) {
    console.error("[YouTube] Status error:", error.message);
    return res.status(500).json({ message: "Unable to fetch YouTube connection status" });
  }
};

// ---------------------------------------------------------------------------
// GET /api/youtube/playlists
// Requires ContentPilot authentication.
// Returns the currently connected YouTube account's playlists.
// ---------------------------------------------------------------------------

export const getUserPlaylistsHandler = async (req, res) => {
  try {
    const playlists = await getUserPlaylists(req.user._id);

    return res.status(200).json({ playlists });
  } catch (error) {
    return handlePublishError(error, res, "playlists");
  }
};

// ---------------------------------------------------------------------------
// POST /api/youtube/disconnect
// Requires ContentPilot authentication.
// Removes the current user's YouTube connection.
// ---------------------------------------------------------------------------

export const disconnectYouTube = async (req, res) => {
  try {
    const connection = await YouTubeConnection.findOne({ userId: req.user._id });

    if (connection) {
      await revokeYouTubeAuthorization(connection);
      await YouTubeConnection.deleteOne({ _id: connection._id });
    }

    return res.status(200).json({ message: "YouTube disconnected successfully" });
  } catch (error) {
    console.error("[YouTube] Disconnect error:", error.message);
    return res.status(500).json({ message: "Unable to disconnect YouTube" });
  }
};

// ---------------------------------------------------------------------------
// POST /api/youtube/publish/main
// Requires ContentPilot authentication.
// Body: { sessionId }
// Publishes the main video for the given session to YouTube.
// ---------------------------------------------------------------------------

export const publishMainVideo = async (req, res) => {
  try {
    const { sessionId } = req.body;

    if (!sessionId) {
      return res.status(400).json({ message: "sessionId is required" });
    }

    const result = await publishMainVideoService(req.user._id, sessionId, null);

    return res.status(200).json({
      message: "Main video published to YouTube successfully",
      youtubeVideoId: result.youtubeVideoId,
      title: result.title,
      publishedAt: result.publishedAt,
      assignedPlaylistId: result.assignedPlaylistId,
    });
  } catch (error) {
    return handlePublishError(error, res, "main video");
  }
};

// ---------------------------------------------------------------------------
// POST /api/youtube/publish/short
// Requires ContentPilot authentication.
// Body: { sessionId }
// Creates and publishes the YouTube Short for the given session.
// ---------------------------------------------------------------------------

export const publishShort = async (req, res) => {
  try {
    const { sessionId } = req.body;

    if (!sessionId) {
      return res.status(400).json({ message: "sessionId is required" });
    }

    const result = await publishShortService(req.user._id, sessionId);

    return res.status(200).json({
      message: "Short published to YouTube successfully",
      youtubeVideoId: result.youtubeVideoId,
      title: result.title,
      publishedAt: result.publishedAt,
    });
  } catch (error) {
    return handlePublishError(error, res, "Short");
  }
};

// ---------------------------------------------------------------------------
// POST /api/youtube/thumbnail/:sessionId
// Requires ContentPilot authentication + thumbnail upload middleware.
// Saves the uploaded thumbnail path to the session for use during publishing.
// ---------------------------------------------------------------------------

export const saveThumbnail = async (req, res) => {
  try {
    const { sessionId } = req.params;

    if (!req.file) {
      return res.status(400).json({ message: "Thumbnail image file is required" });
    }

    const session = await VideoSession.findOne({
      _id: sessionId,
      userId: req.user._id,
    });

    if (!session) {
      return res.status(404).json({ message: "Video session not found" });
    }

    // Save the new thumbnail path, replacing any previous one
    session.thumbnailPath = req.file.path;
    await session.save();

    return res.status(200).json({
      message: "Thumbnail saved successfully",
      thumbnailPath: req.file.path,
    });
  } catch (error) {
    console.error("[YouTube] Thumbnail save error:", error.message);
    return res.status(500).json({ message: "Unable to save thumbnail" });
  }
};

// ---------------------------------------------------------------------------
// Internal error handler for publishing endpoints
// ---------------------------------------------------------------------------

const handlePublishError = (error, res, assetLabel) => {
  if (error.code === "YOUTUBE_NOT_CONNECTED") {
    return res.status(403).json({ message: error.message });
  }

  if (error.code === "SESSION_NOT_FOUND") {
    return res.status(404).json({ message: "Video session not found" });
  }

  if (error.code === "ALREADY_PUBLISHED") {
    return res.status(409).json({ message: error.message });
  }

  if (error.code === "ALREADY_PUBLISHING") {
    return res.status(409).json({ message: error.message });
  }

  if (error.code === "MISSING_GENERATED_CONTENT" || error.code === "MISSING_SHORT_DATA") {
    return res.status(400).json({ message: error.message });
  }

  if (error.code === "MISSING_SOURCE_VIDEO") {
    return res.status(404).json({ message: error.message });
  }

  if (error.code === "INVALID_SHORT_TIMESTAMPS") {
    return res.status(400).json({ message: error.message });
  }

  if (error.code === "TOKEN_REFRESH_FAILED") {
    return res.status(401).json({ message: error.message });
  }

  if (error.code === "SHORT_CREATION_FAILED" || error.code === "YOUTUBE_UPLOAD_FAILED") {
    return res.status(502).json({ message: `${assetLabel} publishing failed: ${error.message}` });
  }

  console.error(`[YouTube] ${assetLabel} publish error:`, error.message);
  return res.status(500).json({ message: `Unable to publish ${assetLabel}` });
};
