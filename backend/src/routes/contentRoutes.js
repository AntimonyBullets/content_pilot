import express from "express";
import {
  generateContent,
  getGeneratedThumbnail,
  regenerateContent,
} from "../controllers/contentController.js";
import protect from "../middleware/authMiddleware.js";

const router = express.Router();

router.post("/generate", protect, generateContent);
router.post("/regenerate", protect, regenerateContent);
router.get("/thumbnail/:sessionId", protect, getGeneratedThumbnail);

export default router;
