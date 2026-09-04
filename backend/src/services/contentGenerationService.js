import { generateStructuredOutput } from "./llmService.js";
import {
  buildFieldRegenerationMessages,
  buildFullGenerationMessages,
} from "./contentPrompts.js";

const MAIN_VIDEO_FIELDS = ["title", "description", "tags"];
const SHORT_FIELDS = ["title", "description", "hashtags", "startTime", "endTime"];
const MAX_REGENERATION_MESSAGE_LENGTH = 1000;

const arrayOfStringsSchema = {
  type: "array",
  items: { type: "string" },
};

const fieldSchemas = {
  mainVideo: {
    title: { type: "string" },
    description: { type: "string" },
    tags: arrayOfStringsSchema,
  },
  short: {
    title: { type: "string" },
    description: { type: "string" },
    hashtags: arrayOfStringsSchema,
    startTime: { type: "number" },
    endTime: { type: "number" },
  },
};

const normalizeSettings = (settings = {}) => ({
  enableShort: Boolean(settings.enableShort),
  automateEntireProcess: Boolean(settings.automateEntireProcess),
  createChapters: Boolean(settings.createChapters),
  llmModel: settings.llmModel || "gemini",
  addToSuitablePlaylist: Boolean(settings.addToSuitablePlaylist),
});

const isValidSegment = (segment) =>
  segment &&
  Number.isFinite(Number(segment.start)) &&
  Number.isFinite(Number(segment.end)) &&
  Number(segment.end) >= Number(segment.start) &&
  typeof segment.text === "string" &&
  segment.text.trim();

const normalizeTranscript = (transcript) => {
  if (!transcript || typeof transcript !== "object" || !String(transcript.text || "").trim()) {
    const error = new Error("Transcript text is required");
    error.code = "MISSING_TRANSCRIPT";
    throw error;
  }

  const segments = Array.isArray(transcript.segments)
    ? transcript.segments
        .filter(isValidSegment)
        .map((segment) => ({
          start: Number(segment.start),
          end: Number(segment.end),
          text: segment.text.trim(),
        }))
    : [];

  return {
    text: String(transcript.text).trim(),
    segments,
  };
};

const normalizeRegenerationMessage = (message) => {
  if (message === undefined || message === null) {
    return "";
  }

  if (typeof message !== "string") {
    const error = new Error("Regeneration message must be a string");
    error.code = "INVALID_REGENERATION_MESSAGE";
    throw error;
  }

  const normalizedMessage = message.trim();

  if (normalizedMessage.length > MAX_REGENERATION_MESSAGE_LENGTH) {
    const error = new Error(
      `Regeneration message cannot exceed ${MAX_REGENERATION_MESSAGE_LENGTH} characters`
    );
    error.code = "INVALID_REGENERATION_MESSAGE";
    throw error;
  }

  return normalizedMessage;
};

const requireSegments = (transcript) => {
  if (!transcript.segments.length) {
    const error = new Error("Timestamped transcript segments are required for this generation request");
    error.code = "MISSING_TRANSCRIPT_SEGMENTS";
    throw error;
  }
};

const getTranscriptBounds = (segments) => {
  if (!segments.length) {
    return null;
  }

  return {
    start: Math.min(...segments.map((segment) => segment.start)),
    end: Math.max(...segments.map((segment) => segment.end)),
  };
};

const buildFullContentSchema = (enableShort) => {
  const properties = {
    mainVideo: {
      type: "object",
      properties: {
        title: { type: "string" },
        description: { type: "string" },
        tags: arrayOfStringsSchema,
      },
      required: MAIN_VIDEO_FIELDS,
      additionalProperties: false,
    },
  };

  const required = ["mainVideo"];

  if (enableShort) {
    properties.short = {
      type: "object",
      properties: {
        title: { type: "string" },
        description: { type: "string" },
        hashtags: arrayOfStringsSchema,
        startTime: { type: "number" },
        endTime: { type: "number" },
      },
      required: SHORT_FIELDS,
      additionalProperties: false,
    };
    required.push("short");
  }

  return {
    type: "object",
    properties,
    required,
    additionalProperties: false,
  };
};

const buildFieldSchema = (contentType, field) => ({
  type: "object",
  properties: {
    value: fieldSchemas[contentType][field],
  },
  required: ["value"],
  additionalProperties: false,
});

const cleanStringArray = (value) =>
  Array.isArray(value)
    ? value.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 20)
    : [];

const validateString = (value, fieldName) => {
  if (typeof value !== "string" || !value.trim()) {
    const error = new Error(`Invalid LLM response: ${fieldName} must be a non-empty string`);
    error.code = "INVALID_LLM_RESPONSE";
    throw error;
  }

  return value.trim();
};

const validateStringArray = (value, fieldName) => {
  const cleaned = cleanStringArray(value);

  if (!cleaned.length) {
    const error = new Error(`Invalid LLM response: ${fieldName} must contain at least one item`);
    error.code = "INVALID_LLM_RESPONSE";
    throw error;
  }

  return cleaned;
};

const validateShortTime = (value, fieldName, transcriptBounds) => {
  const numberValue = Number(value);

  if (!Number.isFinite(numberValue) || numberValue < 0) {
    const error = new Error(`Invalid LLM response: ${fieldName} must be a valid timestamp`);
    error.code = "INVALID_LLM_RESPONSE";
    throw error;
  }

  if (
    transcriptBounds &&
    (numberValue < transcriptBounds.start || numberValue > transcriptBounds.end)
  ) {
    const error = new Error(`Invalid LLM response: ${fieldName} is outside the transcript timeline`);
    error.code = "INVALID_LLM_RESPONSE";
    throw error;
  }

  return numberValue;
};

const validateMainVideo = (mainVideo) => ({
  title: validateString(mainVideo?.title, "mainVideo.title"),
  description: validateString(mainVideo?.description, "mainVideo.description"),
  tags: validateStringArray(mainVideo?.tags, "mainVideo.tags"),
});

const validateShort = (short, transcriptBounds) => {
  const startTime = validateShortTime(short?.startTime, "short.startTime", transcriptBounds);
  const endTime = validateShortTime(short?.endTime, "short.endTime", transcriptBounds);

  if (endTime <= startTime) {
    const error = new Error("Invalid LLM response: short.endTime must be after short.startTime");
    error.code = "INVALID_LLM_RESPONSE";
    throw error;
  }

  return {
    title: validateString(short?.title, "short.title"),
    description: validateString(short?.description, "short.description"),
    hashtags: validateStringArray(short?.hashtags, "short.hashtags"),
    startTime,
    endTime,
  };
};

const validateGeneratedContent = (content, enableShort, transcript) => {
  const validatedContent = {
    mainVideo: validateMainVideo(content?.mainVideo),
    short: null,
  };

  if (enableShort) {
    validatedContent.short = validateShort(content?.short, getTranscriptBounds(transcript.segments));
  }

  return validatedContent;
};

const validateRegeneratedField = ({ contentType, field, value, transcript }) => {
  if (field === "tags" || field === "hashtags") {
    return validateStringArray(value, `${contentType}.${field}`);
  }

  if (field === "startTime" || field === "endTime") {
    return validateShortTime(value, `${contentType}.${field}`, getTranscriptBounds(transcript.segments));
  }

  return validateString(value, `${contentType}.${field}`);
};

export const generateContentFromTranscript = async ({ transcript, settings }) => {
  const normalizedTranscript = normalizeTranscript(transcript);
  const normalizedSettings = normalizeSettings(settings);

  if (normalizedSettings.createChapters || normalizedSettings.enableShort) {
    requireSegments(normalizedTranscript);
  }

  const content = await generateStructuredOutput({
    llmModel: normalizedSettings.llmModel,
    schema: buildFullContentSchema(normalizedSettings.enableShort),
    messages: buildFullGenerationMessages({
      transcript: normalizedTranscript,
      settings: normalizedSettings,
    }),
  });

  return validateGeneratedContent(
    content,
    normalizedSettings.enableShort,
    normalizedTranscript
  );
};

export const regenerateContentField = async ({
  transcript,
  contentType,
  field,
  currentContent,
  message,
  settings,
}) => {
  const normalizedTranscript = normalizeTranscript(transcript);
  const normalizedSettings = normalizeSettings(settings);
  const normalizedMessage = normalizeRegenerationMessage(message);

  if (!fieldSchemas[contentType]) {
    const error = new Error("Unsupported content type");
    error.code = "UNSUPPORTED_CONTENT_TYPE";
    throw error;
  }

  if (!fieldSchemas[contentType][field]) {
    const error = new Error("Unsupported content field");
    error.code = "UNSUPPORTED_CONTENT_FIELD";
    throw error;
  }

  if (
    contentType === "short" ||
    (contentType === "mainVideo" && field === "description" && normalizedSettings.createChapters)
  ) {
    requireSegments(normalizedTranscript);
  }

  const response = await generateStructuredOutput({
    llmModel: normalizedSettings.llmModel,
    schema: buildFieldSchema(contentType, field),
    messages: buildFieldRegenerationMessages({
      transcript: normalizedTranscript,
      contentType,
      field,
      currentContent,
      message: normalizedMessage,
      settings: normalizedSettings,
    }),
  });

  return {
    contentType,
    field,
    value: validateRegeneratedField({
      contentType,
      field,
      value: response?.value,
      transcript: normalizedTranscript,
    }),
  };
};
