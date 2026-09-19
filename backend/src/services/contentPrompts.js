const formatTimestamp = (seconds) => {
  const safeSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const remainingSeconds = safeSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
  }

  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
};

const formatSegments = (segments = []) =>
  segments
    .map(
      (segment) =>
        `[${formatTimestamp(segment.start)}-${formatTimestamp(segment.end)}] ${segment.text}`
    )
    .join("\n");

const baseSystemPrompt = [
  "You generate YouTube publishing metadata from a video transcript.",
  "The transcript is the only source material. Do not invent facts, names, outcomes, links, sponsors, or claims that are not supported by it.",
  "Write natural, engaging YouTube-oriented metadata.",
  "Titles must be concise and compelling without misleading clickbait.",
  "Descriptions must accurately summarize the video.",
  "Tags and hashtags must be relevant to the actual content.",
  "Do not perform or suggest YouTube API operations.",
].join(" ");

const chapterRules = [
  "YouTube chapter requirements are strict:",
  "the first chapter timestamp must be exactly 0:00",
  "include at least 3 chapter timestamps",
  "timestamps must be in strictly ascending chronological order",
  "every chapter must be at least 10 seconds long, so the difference between each timestamp and the next timestamp must be at least 10 seconds",
  "ensure the final chapter also has at least 10 seconds of video remaining",
  "use the timestamped transcript segments to choose meaningful topic transitions",
].join(" ");

export const buildFullGenerationMessages = ({ transcript, settings }) => {
  const chapterInstruction = settings.createChapters
    ? `Include suitable YouTube chapter timestamp lines in the main video description. ${chapterRules}.`
    : "Do not include chapter timestamp lines in the main video description.";

  const shortInstruction = settings.enableShort
    ? "Generate Short metadata and choose startTime and endTime for a concise, meaningful, self-contained segment from the original video. The timestamps must correspond to the provided transcript timeline."
    : "Do not generate Short metadata.";
  const thumbnailInstruction = settings.generateThumbnail
    ? [
        "Also generate thumbnailPrompt as an internal visual concept for the Main Video thumbnail.",
        "Act as a professional YouTube thumbnail art director.",
        "Describe only what should be visible: the primary subject, setting, composition, depth, perspective, lighting, mood, and visual symbolism when appropriate.",
        "Adapt the concept to the actual transcript topic and generated metadata; do not make it generic.",
        "Do not include people, human faces, portraits, close-up people, animals, or wildlife. Use environments, locations, objects, architecture, scenery, or symbolic imagery instead.",
        "The image must contain absolutely no words, letters, numbers, captions, headlines, typography, readable signs, logos, watermarks, or UI elements.",
        "Do not reserve empty space for text. Communicate the topic entirely through visual elements.",
      ].join(" ")
    : "Do not generate thumbnailPrompt.";

  return [
    ["system", baseSystemPrompt],
    [
      "user",
      [
        "Generate structured content for the provided transcript.",
        chapterInstruction,
        shortInstruction,
        thumbnailInstruction,
        "",
        "Transcript text:",
        transcript.text,
        "",
        "Timestamped segments:",
        formatSegments(transcript.segments),
      ].join("\n"),
    ],
  ];
};

export const buildFieldRegenerationMessages = ({
  transcript,
  contentType,
  field,
  currentContent,
  message,
  settings,
}) => {
  const chapterInstruction =
  contentType === "mainVideo" && field === "description"
    ? settings.createChapters
      ? `Include suitable YouTube chapter timestamp lines that correspond to meaningful topic transitions in the timestamped transcript segments. ${chapterRules}.`
      : "Do not include any chapter timestamp lines, timestamps, or chapter sections in the main video description. If the current content contains existing chapters or timestamps, remove them from the regenerated description."
    : "Only regenerate the requested field.";

  const shortInstruction =
    contentType === "short"
      ? "For Short fields, stay consistent with the selected short-form segment when currentContent includes startTime and endTime. If regenerating startTime or endTime, choose a timestamp that keeps the Short coherent and useful on its own."
      : "";

  const userRegenerationInstruction = message
    ? [
        "USER'S REGENERATION INSTRUCTION:",
        "The user wants the regenerated field to follow this additional instruction:",
        message,
        "",
        "Follow this instruction while still respecting the transcript as the source of truth. Do not invent facts or claims that are not supported by the transcript.",
      ].join("\n")
    : "";

  return [
    ["system", baseSystemPrompt],
    [
      "user",
      [
        `Regenerate only the ${contentType}.${field} field.`,
        "Return only the requested field value in the required structured shape.",
        chapterInstruction,
        shortInstruction,
        "",
        "Current content:",
        JSON.stringify(currentContent || {}, null, 2),
        ...(userRegenerationInstruction ? ["", userRegenerationInstruction] : []),
        "",
        "Transcript text:",
        transcript.text,
        "",
        "Timestamped segments:",
        formatSegments(transcript.segments),
      ].join("\n"),
    ],
  ];
};
