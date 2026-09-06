import mongoose from "mongoose";

// Short-lived CSRF state tokens used during the Google OAuth flow.
// Each document automatically expires after 10 minutes via the TTL index.
const oauthStateSchema = new mongoose.Schema(
  {
    state: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    // TTL index: MongoDB removes documents automatically after 600 seconds
    createdAt: {
      type: Date,
      default: Date.now,
      expires: 600,
    },
  },
  {
    // Disable automatic timestamps so we control createdAt ourselves
    timestamps: false,
  }
);

export default mongoose.model("OAuthState", oauthStateSchema);
