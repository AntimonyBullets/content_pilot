import express from "express";
import {
  generateContent,
  getGeneratedThumbnail,
  getLatestSession,
  regenerateContent,
} from "../controllers/contentController.js";
import protect from "../middleware/authMiddleware.js";

const router = express.Router();

router.post("/generate", protect, generateContent);
router.post("/regenerate", protect, regenerateContent);
router.get("/session/latest", protect, getLatestSession);
router.get("/thumbnail/:sessionId", protect, getGeneratedThumbnail);

export default router;
