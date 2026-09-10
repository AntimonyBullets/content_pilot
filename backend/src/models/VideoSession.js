import mongoose from "mongoose";

// Publishing status enum values
const PUBLISH_STATUSES = ["not_published", "publishing", "published", "failed"];

const publishingStateSchema = new mongoose.Schema(
  {
    status: {
      type: String,
      enum: PUBLISH_STATUSES,
      default: "not_published",
    },
    youtubeVideoId: {
      type: String,
      default: null,
    },
    publishedAt: {
      type: Date,
      default: null,
    },
    errorMessage: {
      type: String,
      default: null,
    },
  },
  { _id: false }
);

// Central lifecycle document for each uploaded video.
// Links the uploaded file path → transcript → generated content → publishing state.
const videoSessionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // Local filesystem path of the retained source video
    originalVideoPath: {
      type: String,
      required: true,
    },
    originalVideoFilename: {
      type: String,
      default: null,
    },

    // Transcription result
    transcript: {
      text: { type: String, default: "" },
      segments: [
        {
          start: { type: Number },
          end: { type: Number },
          text: { type: String },
          _id: false,
        },
      ],
    },

    // AI-generated content (populated after /api/content/generate)
    generatedContent: {
      mainVideo: {
        title: { type: String, default: null },
        description: { type: String, default: null },
        tags: [{ type: String }],
        _id: false,
      },
      short: {
        title: { type: String, default: null },
        description: { type: String, default: null },
        hashtags: [{ type: String }],
        startTime: { type: Number, default: null },
        endTime: { type: Number, default: null },
        _id: false,
      },
    },

    // Settings snapshot from the generate request
    settings: {
      enableShort: { type: Boolean, default: false },
      automateEntireProcess: { type: Boolean, default: false },
      createChapters: { type: Boolean, default: false },
      addToSuitablePlaylist: { type: Boolean, default: false },
      llmModel: { type: String, default: "gemini" },
      _id: false,
    },

    // Per-asset publishing states
    mainVideo: {
      type: publishingStateSchema,
      default: () => ({}),
    },
    short: {
      type: publishingStateSchema,
      default: () => ({}),
    },

    // Optional local path for a user-uploaded custom thumbnail
    thumbnailPath: {
      type: String,
      default: null,
    },

    // Records when the physical source video file was successfully deleted.
    // Kept as historical reference; originalVideoPath is retained regardless.
    sourceVideoCleanedAt: {
      type: Date,
      default: null,
    },

    // Playlist selected for the Main video during content generation (pre-publish).
    // The actual assignment after publishing is tracked separately in assignedPlaylistId.
    selectedPlaylistId: {
      type: String,
      default: null,
    },

    // Playlist that the main video was added to (if any)
    assignedPlaylistId: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

export default mongoose.model("VideoSession", videoSessionSchema);
