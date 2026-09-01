import express from "express";
import { transcribeUploadedVideo } from "../controllers/videoController.js";
import protect from "../middleware/authMiddleware.js";
import { handleVideoUpload } from "../middleware/uploadMiddleware.js";

const router = express.Router();

router.post("/transcribe", protect, handleVideoUpload, transcribeUploadedVideo);

export default router;
