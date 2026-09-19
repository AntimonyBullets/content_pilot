import express from "express";
import {
  previewShortVideo,
  streamSourceVideo,
  transcribeUploadedVideo,
} from "../controllers/videoController.js";
import protect from "../middleware/authMiddleware.js";
import { handleVideoUpload } from "../middleware/uploadMiddleware.js";

const router = express.Router();

router.post("/transcribe", protect, handleVideoUpload, transcribeUploadedVideo);
router.get("/source-preview/:sessionId", protect, streamSourceVideo);
router.get("/short-preview/:sessionId", protect, previewShortVideo);

export default router;
