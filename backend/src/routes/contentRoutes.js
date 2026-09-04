import express from "express";
import {
  generateContent,
  regenerateContent,
} from "../controllers/contentController.js";
import protect from "../middleware/authMiddleware.js";

const router = express.Router();

router.post("/generate", protect, generateContent);
router.post("/regenerate", protect, regenerateContent);

export default router;
