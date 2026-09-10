import fs from "fs";
import VideoSession from "../models/VideoSession.js";
import { transcribeVideo } from "../services/transcriptionService.js";
import { downloadVideo } from "../services/videoDownloadService.js";

// ---------------------------------------------------------------------------
// Cleanup helper — removes the file only on failure paths.
// After transcription succeeds, the video is retained in the VideoSession.
// ---------------------------------------------------------------------------

const cleanupFile = async (filePath) => {
  if (!filePath) return;

  await fs.promises.rm(filePath, { force: true }).catch((error) => {
    console.error("File cleanup failed:", error.message);
  });
};

// ---------------------------------------------------------------------------
// Map transcription errors to HTTP status/message pairs
// ---------------------------------------------------------------------------

const errorResponse = (error) => {
  if (error.code === "MISSING_GROQ_API_KEY") {
    return [500, "GROQ_API_KEY is not configured"];
  }

  if (error.code === "EMPTY_AUDIO" || error.code === "INVALID_AUDIO") {
    return [422, "The uploaded video does not contain valid transcribable audio"];
  }

  if (error.code === "CHUNK_TOO_LARGE") {
    return [413, "Generated audio chunks are too large. Reduce TRANSCRIPTION_CHUNK_SECONDS."];
  }

  if (/ffmpeg|ffprobe/i.test(error.message)) {
    return [500, "Audio extraction failed"];
  }

  if (/groq/i.test(error.message) || error.status || error.response) {
    return [502, "Groq transcription failed"];
  }

  return [500, "Unable to transcribe video"];
};

// ---------------------------------------------------------------------------
// POST /api/videos/transcribe
//
// Transcribes the uploaded video and creates a VideoSession document that
// retains the source video path for later YouTube publishing and Short
// creation. The source video is NOT deleted after transcription.
//
// Returns:
//   { transcript, sessionId }
//
// The sessionId links all subsequent operations (content generation,
// publishing) to this video.
// ---------------------------------------------------------------------------

export const transcribeUploadedVideo = async (req, res) => {
  let videoPath = req.file?.path;
  let originalFilename = req.file?.originalname || null;

  if (!req.file && !req.body?.videoUrl) {
    return res.status(400).json({ message: "Video file or videoUrl is required" });
  }

  if (req.file && req.body?.videoUrl) {
    return res.status(400).json({ message: "Provide either a video file or videoUrl, not both" });
  }

  if (!req.file) {
    try {
      ({ filePath: videoPath, originalFilename } = await downloadVideo(req.body.videoUrl));
    } catch (error) {
      const status =
        error.code === "VIDEO_TOO_LARGE" ? 413 :
        ["INVALID_VIDEO_URL", "UNSUPPORTED_VIDEO_RESPONSE"].includes(error.code) ? 400 : 502;
      console.error("Video download error:", error.message);
      const message =
        status === 413 ? "Downloaded video is too large" :
        status === 400 ? error.message : "Unable to download video from URL";
      return res.status(status).json({ message });
    }
  }

  let transcript;

  try {
    transcript = await transcribeVideo(videoPath);
  } catch (error) {
    // On transcription failure: clean up the uploaded video and return an error.
    // The video is not needed if transcription failed.
    await cleanupFile(videoPath);

    const [status, message] = errorResponse(error);
    console.error("Video transcription error:", error.message);
    return res.status(status).json({ message });
  }

  // Transcription succeeded — create a VideoSession to track this video's lifecycle.
  // The source video is retained at videoPath for publishing and Short creation.
  let session;

  try {
    session = await VideoSession.create({
      userId: req.user._id,
      originalVideoPath: videoPath,
      originalVideoFilename: originalFilename,
      transcript,
    });
  } catch (sessionError) {
    // If we cannot persist the session, clean up the video to avoid orphaned files
    console.error("VideoSession creation failed:", sessionError.message);
    await cleanupFile(videoPath);
    return res.status(500).json({ message: "Unable to create video session" });
  }

  return res.status(200).json({
    message: "Video transcribed successfully",
    transcript,
    sessionId: session._id,
  });
};
