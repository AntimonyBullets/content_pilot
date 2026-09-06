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
//   2. Re-encode to a 9:16 vertical crop (1080x1920 target, cropped from
//      center of the original frame) suitable for YouTube Shorts.
//   3. Writes the output to a temp file and returns its path.
//
// The caller is responsible for cleaning up the returned temp file.
// ---------------------------------------------------------------------------

export const createShortClip = async (sourceVideoPath, startTime, endTime) => {
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

  // FFmpeg filter chain:
  //   - crop to the largest centered square, then scale to 1080x1920
  //   - This produces a 9:16 portrait video suitable for Shorts
  //   - We use crop=ih:ih (square crop from width) then scale to 1080x1920
  //   Note: For landscape source videos, we crop the center square and scale
  //   vertically. This is the standard approach for landscape→Short conversion.
  const videoFilter =
    "crop=in_h*9/16:in_h:(in_w-in_h*9/16)/2:0,scale=1080:1920:flags=lanczos";

  try {
    await runCommand("ffmpeg", [
      "-y",
      "-ss", String(startTime),
      "-t", String(duration),
      "-i", sourceVideoPath,
      "-vf", videoFilter,
      "-c:v", "libx264",
      "-preset", "fast",
      "-crf", "23",
      "-c:a", "aac",
      "-b:a", "128k",
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
