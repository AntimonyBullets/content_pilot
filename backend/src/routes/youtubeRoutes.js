import express from "express";
import protect from "../middleware/authMiddleware.js";
import { handleThumbnailUpload } from "../middleware/uploadMiddleware.js";
import {
  connectYouTube,
  oauthCallback,
  getYouTubeStatus,
  disconnectYouTube,
  publishMainVideo,
  publishShort,
  saveThumbnail,
} from "../controllers/youtubeController.js";

const router = express.Router();

// OAuth flow
router.get("/connect", protect, connectYouTube);
router.get("/oauth/callback", oauthCallback); // auth via OAuth state, not JWT

// Connection management
router.get("/status", protect, getYouTubeStatus);
router.post("/disconnect", protect, disconnectYouTube);

// Publishing
router.post("/publish/main", protect, publishMainVideo);
router.post("/publish/short", protect, publishShort);

// Thumbnail upload (separate from publish for flexibility)
router.post("/thumbnail/:sessionId", protect, handleThumbnailUpload, saveThumbnail);

export default router;
