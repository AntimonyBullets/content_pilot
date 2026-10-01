import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { TEMP_UPLOAD_DIR } from "../middleware/uploadMiddleware.js";
import crypto from "crypto";

// ---------------------------------------------------------------------------
// Internal helper: spawn a process and capture its output
// ---------------------------------------------------------------------------

const runCommand = (command, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    let stderr = "";
    let stdout = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      reject(new Error(`${command} failed to start: ${error.message}`));
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout.trim());
        return;
      }

      reject(new Error(`${command} exited with code ${code}: ${stderr.trim()}`));
    });
  });

// ---------------------------------------------------------------------------
// Create a 9:16 vertical YouTube Short clip from a source video segment.
//
// Workflow:
//   1. Extract the segment [startTime, endTime] from the source video.
//   2. Re-encode to a 9:16 vertical video suitable for YouTube Shorts. The
//      default blurred canvas preserves the full source frame; callers can
//      opt into the legacy centered crop.
//   3. Writes the output to a temp file and returns its path.
//
// The caller is responsible for cleaning up the returned temp file.
// ---------------------------------------------------------------------------

export const createShortClip = async (
  sourceVideoPath,
  startTime,
  endTime,
  cropSides = false
) => {
  const duration = endTime - startTime;

  if (duration <= 0) {
    const error = new Error(
      `Invalid Short timestamps: endTime (${endTime}) must be greater than startTime (${startTime})`
    );
    error.code = "INVALID_SHORT_TIMESTAMPS";
    throw error;
  }

  await fs.promises.mkdir(TEMP_UPLOAD_DIR, { recursive: true });

  const outputFilename = `short-${Date.now()}-${crypto.randomUUID()}.mp4`;
  const outputPath = path.join(TEMP_UPLOAD_DIR, outputFilename);

  const videoFilter = cropSides
    ? "crop=in_h*9/16:in_h:(in_w-in_h*9/16)/2:0,scale=1080:1920:flags=lanczos"
    : "[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=25:10[bg];" +
      "[0:v]scale=1080:-1:flags=lanczos[fg];" +
      "[bg][fg]overlay=(W-w)/2:(H-h)/2[outv]";

  try {
    await runCommand("ffmpeg", [
      "-y",
      "-ss", String(startTime),
      "-t", String(duration),
      "-i", sourceVideoPath,
      cropSides ? "-vf" : "-filter_complex",
      videoFilter,
      "-map", cropSides ? "0:v" : "[outv]",
      "-map", "0:a?",
      "-c:v", "libx264",
      "-preset", "fast",
      "-crf", "23",
      "-c:a", "aac",
      "-b:a", "128k",
      "-pix_fmt", "yuv420p",
      "-movflags", "+faststart",
      outputPath,
    ]);
  } catch (error) {
    // Clean up partial output on failure
    await fs.promises.rm(outputPath, { force: true }).catch(() => {});

    const wrapped = new Error(`FFmpeg Short clip creation failed: ${error.message}`);
    wrapped.code = "SHORT_CREATION_FAILED";
    wrapped.cause = error;
    throw wrapped;
  }

  // Verify output exists and is non-empty
  let outputSize = 0;
  try {
    const stats = await fs.promises.stat(outputPath);
    outputSize = stats.size;
  } catch {
    const error = new Error("Short clip output file was not created by FFmpeg");
    error.code = "SHORT_CREATION_FAILED";
    throw error;
  }

  if (outputSize <= 0) {
    await fs.promises.rm(outputPath, { force: true }).catch(() => {});
    const error = new Error("Short clip output file is empty");
    error.code = "SHORT_CREATION_FAILED";
    throw error;
  }

  return outputPath;
};

// ---------------------------------------------------------------------------
// Remove a temp Short file, logging any errors without throwing
// ---------------------------------------------------------------------------

export const cleanupShortFile = async (filePath) => {
  if (!filePath) return;

  await fs.promises.rm(filePath, { force: true }).catch((error) => {
    console.warn("Short clip cleanup failed:", error.message);
  });
};
