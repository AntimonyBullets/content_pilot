import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { TEMP_UPLOAD_DIR } from "../middleware/uploadMiddleware.js";

const DEFAULT_AUDIO_SAMPLE_RATE = 16000;
const DEFAULT_CHUNK_DURATION_SECONDS = 600;
const DEFAULT_CHUNK_OVERLAP_SECONDS = 5;

const getNumberEnv = (name, fallback) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

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

export const getMediaFileSize = async (filePath) => {
  const stats = await fs.promises.stat(filePath);
  return stats.size;
};

export const extractAudioFromVideo = async (videoPath) => {
  await fs.promises.mkdir(TEMP_UPLOAD_DIR, { recursive: true });

  const audioPath = path.join(TEMP_UPLOAD_DIR, `${path.parse(videoPath).name}.flac`);
  const sampleRate = getNumberEnv("TRANSCRIPTION_AUDIO_SAMPLE_RATE", DEFAULT_AUDIO_SAMPLE_RATE);

  try {
    await runCommand("ffmpeg", [
      "-y",
      "-i",
      videoPath,
      "-vn",
      "-map",
      "0:a:0",
      "-ac",
      "1",
      "-ar",
      String(sampleRate),
      "-c:a",
      "flac",
      audioPath,
    ]);
  } catch (error) {
    if (/matches no streams|does not contain any stream|invalid input/i.test(error.message)) {
      error.code = "INVALID_AUDIO";
    }

    throw error;
  }

  const audioSize = await getMediaFileSize(audioPath);

  if (audioSize <= 0) {
    const error = new Error("Extracted audio is empty");
    error.code = "EMPTY_AUDIO";
    throw error;
  }

  return audioPath;
};

export const getAudioDurationSeconds = async (audioPath) => {
  const output = await runCommand("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    audioPath,
  ]);

  const duration = Number(output);

  if (!Number.isFinite(duration) || duration <= 0) {
    const error = new Error("Unable to determine audio duration");
    error.code = "INVALID_AUDIO";
    throw error;
  }

  return duration;
};

export const splitAudioIntoChunks = async (audioPath) => {
  const chunkDuration = getNumberEnv("TRANSCRIPTION_CHUNK_SECONDS", DEFAULT_CHUNK_DURATION_SECONDS);
  const overlap = getNumberEnv("TRANSCRIPTION_CHUNK_OVERLAP_SECONDS", DEFAULT_CHUNK_OVERLAP_SECONDS);

  if (overlap >= chunkDuration) {
    throw new Error("TRANSCRIPTION_CHUNK_OVERLAP_SECONDS must be smaller than TRANSCRIPTION_CHUNK_SECONDS");
  }

  const totalDuration = await getAudioDurationSeconds(audioPath);
  const sampleRate = getNumberEnv("TRANSCRIPTION_AUDIO_SAMPLE_RATE", DEFAULT_AUDIO_SAMPLE_RATE);
  const chunkDir = path.join(TEMP_UPLOAD_DIR, `${path.parse(audioPath).name}-chunks`);
  const chunks = [];

  await fs.promises.mkdir(chunkDir, { recursive: true });

  let start = 0;
  let index = 0;
  const step = chunkDuration - overlap;

  while (start < totalDuration) {
    const duration = Math.min(chunkDuration, totalDuration - start);
    const outputPath = path.join(chunkDir, `chunk-${String(index).padStart(4, "0")}.flac`);

    // Each chunk is re-encoded to the same speech-friendly format as the full
    // extracted audio. Overlap protects words near boundaries; the merge step
    // later assigns each segment back to its original timeline position.
    await runCommand("ffmpeg", [
      "-y",
      "-ss",
      String(start),
      "-t",
      String(duration),
      "-i",
      audioPath,
      "-ac",
      "1",
      "-ar",
      String(sampleRate),
      "-c:a",
      "flac",
      outputPath,
    ]);

    const size = await getMediaFileSize(outputPath);

    if (size <= 0) {
      const error = new Error("Generated audio chunk is empty");
      error.code = "EMPTY_AUDIO";
      throw error;
    }

    chunks.push({
      path: outputPath,
      directory: chunkDir,
      startOffsetSeconds: start,
      durationSeconds: duration,
    });

    if (start + duration >= totalDuration) {
      break;
    }

    start += step;
    index += 1;
  }

  return chunks;
};
