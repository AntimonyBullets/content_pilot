import crypto from "crypto";
import fs from "fs";
import path from "path";
import multer from "multer";

export const TEMP_UPLOAD_DIR =
  process.env.TEMP_UPLOAD_DIR || path.join(process.cwd(), "uploads", "temp");

const DEFAULT_MAX_VIDEO_UPLOAD_MB = 250;
const maxVideoUploadMb = Number(process.env.MAX_VIDEO_UPLOAD_MB || DEFAULT_MAX_VIDEO_UPLOAD_MB);

const allowedVideoExtensions = new Set([".mp4", ".webm", ".mov", ".mpeg", ".mpg"]);
const allowedVideoMimeTypes = new Set([
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "video/mpeg",
  "application/octet-stream",
]);

const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    try {
      await fs.promises.mkdir(TEMP_UPLOAD_DIR, { recursive: true });
      cb(null, TEMP_UPLOAD_DIR);
    } catch (error) {
      cb(error);
    }
  },
  filename: (req, file, cb) => {
    const extension = path.extname(file.originalname || "").toLowerCase();
    cb(null, `${Date.now()}-${crypto.randomUUID()}${extension}`);
  },
});

const videoFileFilter = (req, file, cb) => {
  const extension = path.extname(file.originalname || "").toLowerCase();
  const hasAllowedExtension = allowedVideoExtensions.has(extension);
  const hasAllowedMimeType = allowedVideoMimeTypes.has(file.mimetype);

  if (!hasAllowedExtension || !hasAllowedMimeType) {
    const error = new Error("Invalid video type. Supported formats: mp4, webm, mov, mpeg.");
    error.code = "INVALID_VIDEO_TYPE";
    return cb(error);
  }

  return cb(null, true);
};

export const uploadVideo = multer({
  storage,
  fileFilter: videoFileFilter,
  limits: {
    fileSize: maxVideoUploadMb * 1024 * 1024,
    files: 1,
  },
}).single("video");

export const handleVideoUpload = (req, res, next) => {
  uploadVideo(req, res, (error) => {
    if (!error) {
      return next();
    }

    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({
        message: `Video upload is too large. Maximum size is ${maxVideoUploadMb} MB.`,
      });
    }

    if (error.code === "INVALID_VIDEO_TYPE") {
      return res.status(400).json({ message: error.message });
    }

    console.error("Video upload error:", error.message);
    return res.status(400).json({ message: "Unable to upload video" });
  });
};
