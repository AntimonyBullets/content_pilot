import fs from "fs";
import VideoSession from "../models/VideoSession.js";
import { cleanupSourceVideo } from "./youtubePublishingService.js";

const DEFAULT_TTL_HOURS = 24;
const DEFAULT_INTERVAL_MS = 60 * 60 * 1000;

const getPositiveNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const getCleanupTtlMs = () =>
  getPositiveNumber(process.env.SOURCE_VIDEO_CLEANUP_TTL_HOURS, DEFAULT_TTL_HOURS) *
  60 *
  60 *
  1000;

const getCleanupIntervalMs = () =>
  getPositiveNumber(process.env.SOURCE_VIDEO_CLEANUP_INTERVAL_MS, DEFAULT_INTERVAL_MS);

export const cleanupStaleSourceVideos = async () => {
  const staleBefore = new Date(Date.now() - getCleanupTtlMs());
  const staleSessions = await VideoSession.find({
    originalVideoPath: { $type: "string", $ne: "" },
    sourceVideoCleanedAt: null,
    updatedAt: { $lte: staleBefore },
    "mainVideo.status": { $ne: "publishing" },
    "short.status": { $ne: "publishing" },
  });

  for (const candidate of staleSessions) {
    // Re-check the session so recent activity during the scan prevents cleanup.
    const session = await VideoSession.findOne({
      _id: candidate._id,
      originalVideoPath: { $type: "string", $ne: "" },
      sourceVideoCleanedAt: null,
      updatedAt: { $lte: staleBefore },
      "mainVideo.status": { $ne: "publishing" },
      "short.status": { $ne: "publishing" },
    });

    if (!session) {
      continue;
    }

    try {
      await fs.promises.access(session.originalVideoPath, fs.constants.F_OK);
    } catch (error) {
      if (error.code !== "ENOENT") {
        console.warn(
          `[Cleanup] Could not inspect source video for session ${session._id}:`,
          error.message
        );
      }
      continue;
    }

    await cleanupSourceVideo(session);
    console.log(`[Cleanup] Removed stale source video for session ${session._id}`);
  }
};

export const startSourceVideoCleanupJob = () => {
  const intervalMs = getCleanupIntervalMs();
  let cleanupRunning = false;

  const runCleanup = async () => {
    if (cleanupRunning) {
      return;
    }

    cleanupRunning = true;
    try {
      await cleanupStaleSourceVideos();
    } catch (error) {
      console.error("[Cleanup] Stale source video cleanup failed:", error.message);
    } finally {
      cleanupRunning = false;
    }
  };

  runCleanup();
  const interval = setInterval(runCleanup, intervalMs);
  interval.unref();

  return interval;
};
