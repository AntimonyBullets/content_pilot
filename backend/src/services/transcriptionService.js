import fs from "fs";
import {
  extractAudioFromVideo,
  getMediaFileSize,
  splitAudioIntoChunks,
} from "./ffmpegService.js";
import { transcribeAudioFile } from "./groqService.js";

const DEFAULT_GROQ_MAX_AUDIO_MB = 24;

const getNumberEnv = (name, fallback) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

const removePath = async (filePath) => {
  if (!filePath) {
    return;
  }

  await fs.promises.rm(filePath, { recursive: true, force: true });
};

const normalizeSegments = (response, offsetSeconds = 0) => {
  const rawSegments = Array.isArray(response?.segments) ? response.segments : [];

  return rawSegments
    .map((segment) => ({
      start: Number(segment.start) + offsetSeconds,
      end: Number(segment.end) + offsetSeconds,
      text: String(segment.text || "").trim(),
    }))
    .filter(
      (segment) =>
        Number.isFinite(segment.start) &&
        Number.isFinite(segment.end) &&
        segment.end >= segment.start &&
        segment.text
    );
};

const mergeChunkTranscripts = (chunkResults, overlapSeconds) => {
  const segments = [];

  chunkResults.forEach((chunkResult, index) => {
    const currentChunk = chunkResult.chunk;
    const nextChunk = chunkResults[index + 1]?.chunk;
    const validFrom = index === 0 ? 0 : currentChunk.startOffsetSeconds + overlapSeconds / 2;
    const validUntil = nextChunk ? nextChunk.startOffsetSeconds + overlapSeconds / 2 : Infinity;

    const adjustedSegments = normalizeSegments(
      chunkResult.response,
      currentChunk.startOffsetSeconds
    ).filter((segment) => {
      const midpoint = (segment.start + segment.end) / 2;
      return midpoint >= validFrom && midpoint < validUntil;
    });

    segments.push(...adjustedSegments);
  });

  segments.sort((a, b) => a.start - b.start);

  return {
    text: segments.map((segment) => segment.text).join(" ").trim(),
    segments,
  };
};

const normalizeSingleTranscript = (response) => {
  const segments = normalizeSegments(response);

  return {
    text: String(response?.text || segments.map((segment) => segment.text).join(" ")).trim(),
    segments,
  };
};

export const transcribeVideo = async (videoPath) => {
  let audioPath;
  let chunks = [];

  try {
    audioPath = await extractAudioFromVideo(videoPath);

    const audioSizeBytes = await getMediaFileSize(audioPath);
    const maxAudioBytes = getNumberEnv("GROQ_MAX_AUDIO_UPLOAD_MB", DEFAULT_GROQ_MAX_AUDIO_MB) * 1024 * 1024;

    if (audioSizeBytes <= 0) {
      const error = new Error("Extracted audio is empty");
      error.code = "EMPTY_AUDIO";
      throw error;
    }

    if (audioSizeBytes <= maxAudioBytes) {
      const response = await transcribeAudioFile(audioPath);
      return normalizeSingleTranscript(response);
    }

    chunks = await splitAudioIntoChunks(audioPath);

    const chunkResults = [];
    for (const chunk of chunks) {
      const chunkSizeBytes = await getMediaFileSize(chunk.path);

      if (chunkSizeBytes > maxAudioBytes) {
        const error = new Error(
          "Generated audio chunk exceeds Groq upload limit. Lower TRANSCRIPTION_CHUNK_SECONDS."
        );
        error.code = "CHUNK_TOO_LARGE";
        throw error;
      }

      const response = await transcribeAudioFile(chunk.path);
      chunkResults.push({ chunk, response });
    }

    const overlapSeconds = getNumberEnv("TRANSCRIPTION_CHUNK_OVERLAP_SECONDS", 5);

    // Groq returns timestamps relative to each chunk. We add the chunk's start
    // offset and keep each overlapped segment only on one side of the boundary
    // so the final transcript stays ordered without duplicated boundary speech.
    return mergeChunkTranscripts(chunkResults, overlapSeconds);
  } finally {
    await Promise.allSettled([
      removePath(audioPath),
      ...chunks.map((chunk) => removePath(chunk.path)),
      ...[...new Set(chunks.map((chunk) => chunk.directory))].map(removePath),
    ]);
  }
};
