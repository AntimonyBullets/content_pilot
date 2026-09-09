import { google } from "googleapis";
import YouTubeConnection from "../models/YouTubeConnection.js";
import fs from "fs";
import path from "path";

// ---------------------------------------------------------------------------
// OAuth2 client factory
// ---------------------------------------------------------------------------

const getOAuth2Client = () => {
  const clientId = process.env.YOUTUBE_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
  const redirectUri = process.env.YOUTUBE_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    const error = new Error(
      "YouTube OAuth credentials are not configured. Set YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, and YOUTUBE_REDIRECT_URI."
    );
    error.code = "MISSING_YOUTUBE_CONFIG";
    throw error;
  }

  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
};

// ---------------------------------------------------------------------------
// Generate OAuth authorization URL (used by the /connect endpoint)
// ---------------------------------------------------------------------------

export const generateAuthUrl = (state) => {
  const oauth2Client = getOAuth2Client();

  return oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: ["https://www.googleapis.com/auth/youtube"],
    state,
    prompt: "consent", // Force consent screen so refresh_token is always returned
  });
};

// ---------------------------------------------------------------------------
// Exchange authorization code for tokens (used by /oauth/callback)
// ---------------------------------------------------------------------------

export const exchangeCodeForTokens = async (code) => {
  const oauth2Client = getOAuth2Client();
  const { tokens } = await oauth2Client.getToken(code);
  return tokens;
};

// ---------------------------------------------------------------------------
// Retrieve channel information using a freshly-authorized client
// ---------------------------------------------------------------------------

export const getChannelInfo = async (tokens) => {
  const oauth2Client = getOAuth2Client();
  oauth2Client.setCredentials(tokens);

  const youtube = google.youtube({ version: "v3", auth: oauth2Client });

  const response = await youtube.channels.list({
    part: ["snippet"],
    mine: true,
  });

  const channel = response.data.items?.[0];

  if (!channel) {
    return null;
  }

  return {
    channelId: channel.id,
    channelTitle: channel.snippet?.title || null,
    channelThumbnailUrl: channel.snippet?.thumbnails?.default?.url || null,
  };
};

// ---------------------------------------------------------------------------
// Build an authenticated YouTube API client for a given ContentPilot user.
// Automatically refreshes the access token if it has expired and persists
// the new token back to the database.
// ---------------------------------------------------------------------------

const getAuthenticatedYouTubeClient = async (userId) => {
  const connection = await YouTubeConnection.findOne({ userId });

  if (!connection) {
    const error = new Error("YouTube is not connected for this user");
    error.code = "YOUTUBE_NOT_CONNECTED";
    throw error;
  }

  const oauth2Client = getOAuth2Client();

  oauth2Client.setCredentials({
    access_token: connection.accessToken,
    refresh_token: connection.refreshToken,
    expiry_date: connection.tokenExpiryDate?.getTime() ?? null,
  });

  // Automatically refresh token when expired or close to expiry (within 5 min)
  const expiryDate = connection.tokenExpiryDate?.getTime() ?? 0;
  const needsRefresh = Date.now() >= expiryDate - 5 * 60 * 1000;

  if (needsRefresh) {
    try {
      const { credentials } = await oauth2Client.refreshAccessToken();

      // Persist refreshed credentials
      connection.accessToken = credentials.access_token;
      if (credentials.refresh_token) {
        connection.refreshToken = credentials.refresh_token;
      }
      connection.tokenExpiryDate = new Date(credentials.expiry_date);
      await connection.save();

      oauth2Client.setCredentials(credentials);
    } catch (refreshError) {
      const error = new Error("Failed to refresh YouTube access token. Please reconnect YouTube.");
      error.code = "TOKEN_REFRESH_FAILED";
      error.cause = refreshError;
      throw error;
    }
  }

  return google.youtube({ version: "v3", auth: oauth2Client });
};

// ---------------------------------------------------------------------------
// Upload a video file to YouTube
// ---------------------------------------------------------------------------

export const uploadVideo = async (userId, filePath, { title, description, tags, categoryId = "22" }) => {
  const youtube = await getAuthenticatedYouTubeClient(userId);

  const fileSize = (await fs.promises.stat(filePath)).size;
  const fileStream = fs.createReadStream(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const mimeType = ext === ".webm" ? "video/webm" : "video/mp4";

  const response = await youtube.videos.insert({
    part: ["snippet", "status"],
    requestBody: {
      snippet: {
        title,
        description,
        tags: Array.isArray(tags) ? tags : [],
        categoryId,
      },
      status: {
        privacyStatus: "unlisted",
        selfDeclaredMadeForKids: false,
      },
    },
    media: {
      mimeType,
      body: fileStream,
    },
  }, {
    // Use resumable upload for large files
    onUploadProgress: () => {},
  });

  const videoId = response.data.id;

  if (!videoId) {
    const error = new Error("YouTube video upload did not return a video ID");
    error.code = "YOUTUBE_UPLOAD_FAILED";
    throw error;
  }

  return videoId;
};

// ---------------------------------------------------------------------------
// Set a custom thumbnail for an already-uploaded YouTube video
// ---------------------------------------------------------------------------

export const setThumbnail = async (userId, youtubeVideoId, thumbnailPath) => {
  const youtube = await getAuthenticatedYouTubeClient(userId);

  const ext = path.extname(thumbnailPath).toLowerCase();
  const mimeType = ext === ".png" ? "image/png" : "image/jpeg";

  await youtube.thumbnails.set({
    videoId: youtubeVideoId,
    media: {
      mimeType,
      body: fs.createReadStream(thumbnailPath),
    },
  });
};

// ---------------------------------------------------------------------------
// Retrieve the authenticated user's YouTube playlists
// ---------------------------------------------------------------------------

export const getUserPlaylists = async (userId) => {
  const youtube = await getAuthenticatedYouTubeClient(userId);

  const playlists = [];
  let pageToken = undefined;

  do {
    const response = await youtube.playlists.list({
      part: ["snippet"],
      mine: true,
      maxResults: 50,
      ...(pageToken ? { pageToken } : {}),
    });

    const items = response.data.items || [];

    for (const item of items) {
      playlists.push({
        id: item.id,
        title: item.snippet?.title || "",
        description: item.snippet?.description || "",
      });
    }

    pageToken = response.data.nextPageToken;
  } while (pageToken);

  return playlists;
};

// ---------------------------------------------------------------------------
// Add a video to a specific YouTube playlist
// ---------------------------------------------------------------------------

export const addVideoToPlaylist = async (userId, youtubeVideoId, playlistId) => {
  const youtube = await getAuthenticatedYouTubeClient(userId);

  await youtube.playlistItems.insert({
    part: ["snippet"],
    requestBody: {
      snippet: {
        playlistId,
        resourceId: {
          kind: "youtube#video",
          videoId: youtubeVideoId,
        },
      },
    },
  });
};
