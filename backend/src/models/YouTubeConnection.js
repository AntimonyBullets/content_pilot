import mongoose from "mongoose";

// Stores a ContentPilot user's Google/YouTube OAuth connection.
// Enforces one connection per user via the unique index on userId.
// Access and refresh tokens are never returned in API responses.
const youTubeConnectionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },

    // OAuth tokens — never exposed in API responses
    accessToken: {
      type: String,
      required: true,
    },
    refreshToken: {
      type: String,
      required: true,
    },
    tokenExpiryDate: {
      type: Date,
      required: true,
    },

    // YouTube channel metadata — safe to return
    channelId: {
      type: String,
      default: null,
    },
    channelTitle: {
      type: String,
      default: null,
    },
    channelThumbnailUrl: {
      type: String,
      default: null,
    },

    connectedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

export default mongoose.model("YouTubeConnection", youTubeConnectionSchema);
