import dns from "dns/promises";
import fs from "fs";
import net from "net";
import path from "path";
import { pipeline } from "stream/promises";
import { Readable } from "stream";
import crypto from "crypto";
import { TEMP_UPLOAD_DIR } from "../middleware/uploadMiddleware.js";

const MAX_REDIRECTS = 5;
const DEFAULT_MAX_VIDEO_UPLOAD_MB = 250;
const allowedVideoExtensions = new Set([".mp4", ".webm", ".mov", ".mpeg", ".mpg"]);

const getMaxVideoBytes = () => {
  const configured = Number(process.env.MAX_VIDEO_UPLOAD_MB || DEFAULT_MAX_VIDEO_UPLOAD_MB);
  return (Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_MAX_VIDEO_UPLOAD_MB) * 1024 * 1024;
};

const isPrivateAddress = (address) => {
  if (net.isIPv4(address)) {
    const octets = address.split(".").map(Number);
    return (
      octets[0] === 10 ||
      octets[0] === 127 ||
      (octets[0] === 169 && octets[1] === 254) ||
      (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
      (octets[0] === 192 && octets[1] === 168) ||
      octets[0] === 0
    );
  }

  const normalized = address.toLowerCase();
  return (
    normalized === "::1" ||
    normalized === "::" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb")
  );
};

const validateUrl = async (value) => {
  let url;
  try {
    url = new URL(value);
  } catch {
    const error = new Error("Invalid video URL");
    error.code = "INVALID_VIDEO_URL";
    throw error;
  }

  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    const error = new Error("Video URL must use HTTP or HTTPS without credentials");
    error.code = "INVALID_VIDEO_URL";
    throw error;
  }

  if (url.hostname === "localhost" || url.hostname.endsWith(".localhost") || url.hostname.endsWith(".local")) {
    const error = new Error("Video URL host is not allowed");
    error.code = "INVALID_VIDEO_URL";
    throw error;
  }

  const addresses = net.isIP(url.hostname)
    ? [url.hostname]
    : (await dns.lookup(url.hostname, { all: true })).map(({ address }) => address);

  if (!addresses.length || addresses.some(isPrivateAddress)) {
    const error = new Error("Video URL host is not allowed");
    error.code = "INVALID_VIDEO_URL";
    throw error;
  }

  return url;
};

const getFilename = (url, response) => {
  const contentDisposition = response.headers.get("content-disposition") || "";
  const dispositionMatch = contentDisposition.match(/filename\*?=(?:UTF-8'')?["']?([^"';]+)["']?/i);
  const headerFilename = dispositionMatch?.[1] ? decodeURIComponent(dispositionMatch[1]) : "";
  const urlFilename = path.basename(url.pathname);
  const candidate = path.basename(headerFilename || urlFilename || "video.mp4");
  const extension = path.extname(candidate).toLowerCase();

  return {
    originalFilename: candidate,
    extension: allowedVideoExtensions.has(extension) ? extension : ".mp4",
  };
};

const fetchVideo = async (url, redirectCount = 0) => {
  const safeUrl = await validateUrl(url);
  const response = await fetch(safeUrl, { redirect: "manual" });

  if ([301, 302, 303, 307, 308].includes(response.status)) {
    if (redirectCount >= MAX_REDIRECTS || !response.headers.get("location")) {
      const error = new Error("Video URL has too many redirects");
      error.code = "VIDEO_DOWNLOAD_FAILED";
      throw error;
    }
    return fetchVideo(new URL(response.headers.get("location"), safeUrl).toString(), redirectCount + 1);
  }

  if (!response.ok || !response.body) {
    const error = new Error(`Video URL returned HTTP ${response.status}`);
    error.code = "VIDEO_DOWNLOAD_FAILED";
    throw error;
  }

  const contentType = (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (contentType && !contentType.startsWith("video/") && contentType !== "application/octet-stream") {
    const error = new Error("Video URL response is not a supported video");
    error.code = "UNSUPPORTED_VIDEO_RESPONSE";
    throw error;
  }

  if (!contentType && !allowedVideoExtensions.has(path.extname(safeUrl.pathname).toLowerCase())) {
    const error = new Error("Video URL response is missing a supported video type");
    error.code = "UNSUPPORTED_VIDEO_RESPONSE";
    throw error;
  }

  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > getMaxVideoBytes()) {
    const error = new Error("Downloaded video is too large");
    error.code = "VIDEO_TOO_LARGE";
    throw error;
  }

  return { url: safeUrl, response };
};

export const downloadVideo = async (videoUrl) => {
  const { url, response } = await fetchVideo(videoUrl);
  const { originalFilename, extension } = getFilename(url, response);
  const filePath = path.join(TEMP_UPLOAD_DIR, `${Date.now()}-${crypto.randomUUID()}${extension}`);
  let bytes = 0;

  await fs.promises.mkdir(TEMP_UPLOAD_DIR, { recursive: true });

  try {
    const limitedStream = Readable.fromWeb(response.body).map((chunk) => {
      bytes += chunk.length;
      if (bytes > getMaxVideoBytes()) {
        const error = new Error("Downloaded video is too large");
        error.code = "VIDEO_TOO_LARGE";
        throw error;
      }
      return chunk;
    });

    await pipeline(limitedStream, fs.createWriteStream(filePath, { flags: "wx" }));
    return { filePath, originalFilename };
  } catch (error) {
    await fs.promises.rm(filePath, { force: true });
    throw error;
  }
};
