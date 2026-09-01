import fs from "fs";
import { transcribeVideo } from "../services/transcriptionService.js";

const cleanupUploadedVideo = async (filePath) => {
  if (filePath) {
    await fs.promises.rm(filePath, { force: true }).catch((error) => {
      console.error("Uploaded video cleanup failed:", error.message);
    });
  }
};

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

export const transcribeUploadedVideo = async (req, res) => {
  const videoPath = req.file?.path;

  try {
    if (!req.file) {
      return res.status(400).json({ message: "Video file is required" });
    }

    const transcript = await transcribeVideo(videoPath);

    return res.status(200).json({
      message: "Video transcribed successfully",
      transcript,
    });
  } catch (error) {
    const [status, message] = errorResponse(error);

    console.error("Video transcription error:", error.message);
    return res.status(status).json({ message });
  } finally {
    await cleanupUploadedVideo(videoPath);
  }
};
