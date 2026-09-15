import crypto from "crypto";
import fs from "fs";
import path from "path";
import { TEMP_UPLOAD_DIR } from "../middleware/uploadMiddleware.js";

const STABILITY_ENDPOINT = "https://api.stability.ai/v2beta/stable-image/generate/sd3";
const STABILITY_MODEL = "sd3.5-flash";

const buildThumbnailPrompt = ({ title, description, tags }) => {
  const tagText = Array.isArray(tags) ? tags.slice(0, 10).join(", ") : "";

  return [
    "Create a professional YouTube thumbnail for the following video.",
    "Use a clear central visual subject, strong contrast, cinematic lighting, and a clean 16:9 composition.",
    "Visually represent the actual topic using an illustrative scene, environment, object, or scenery rather than a person's face.",
    "Do not show human faces, portraits, or close-ups of people. Prefer scenery, locations, objects, diagrams, or atmospheric visuals.",
    "Do not include UI elements, watermarks, logos, or unnecessary text.",
    "Do not place the video title verbatim on the image unless it is essential to the visual concept.",
    `Title: ${title}`,
    `Description: ${description}`,
    `Tags: ${tagText}`,
  ].join("\n");
};

export const generateMainVideoThumbnail = async ({ mainVideo }) => {
  const apiKey = process.env.STABILITY_API_KEY;

  if (!apiKey) {
    const error = new Error("STABILITY_API_KEY is not configured");
    error.code = "MISSING_STABILITY_API_KEY";
    throw error;
  }

  const formData = new FormData();
  formData.append("prompt", buildThumbnailPrompt(mainVideo));
  formData.append("model", STABILITY_MODEL);
  formData.append("aspect_ratio", "16:9");
  formData.append("output_format", "png");

  let response;
  try {
    response = await fetch(STABILITY_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "image/*",
      },
      body: formData,
    });
  } catch (error) {
    const wrapped = new Error(`Stability thumbnail request failed: ${error.message}`);
    wrapped.code = "STABILITY_REQUEST_FAILED";
    wrapped.cause = error;
    throw wrapped;
  }

  if (!response.ok) {
    const error = new Error(`Stability thumbnail generation failed with status ${response.status}`);
    error.code = "STABILITY_API_ERROR";
    throw error;
  }

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.startsWith("image/")) {
    const error = new Error("Stability returned an invalid thumbnail response");
    error.code = "INVALID_STABILITY_IMAGE";
    throw error;
  }

  const imageBuffer = Buffer.from(await response.arrayBuffer());
  if (!imageBuffer.length) {
    const error = new Error("Stability returned an empty thumbnail");
    error.code = "INVALID_STABILITY_IMAGE";
    throw error;
  }

  await fs.promises.mkdir(TEMP_UPLOAD_DIR, { recursive: true });
  const outputPath = path.join(
    TEMP_UPLOAD_DIR,
    `thumbnail-generated-${Date.now()}-${crypto.randomUUID()}.png`
  );
  try {
    await fs.promises.writeFile(outputPath, imageBuffer);
  } catch (error) {
    await fs.promises.rm(outputPath, { force: true }).catch(() => {});
    const wrapped = new Error(`Unable to save generated thumbnail: ${error.message}`);
    wrapped.code = "STABILITY_IMAGE_WRITE_FAILED";
    wrapped.cause = error;
    throw wrapped;
  }

  return outputPath;
};
