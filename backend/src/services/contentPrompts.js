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

export const buildFullGenerationMessages = ({ transcript, settings }) => {
  const chapterInstruction = settings.createChapters
    ? "Include suitable YouTube chapter timestamp lines in the main video description. Chapters must correspond to meaningful topic transitions in the timestamped transcript segments."
    : "Do not include chapter timestamp lines in the main video description.";

  const shortInstruction = settings.enableShort
    ? "Generate Short metadata and choose startTime and endTime for a concise, meaningful, self-contained segment from the original video. The timestamps must correspond to the provided transcript timeline."
    : "Do not generate Short metadata.";

  return [
    ["system", baseSystemPrompt],
    [
      "user",
      [
        "Generate structured content for the provided transcript.",
        chapterInstruction,
        shortInstruction,
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
  settings,
}) => {
  const chapterInstruction =
    contentType === "mainVideo" && field === "description" && settings.createChapters
      ? "If regenerating the main video description, include suitable YouTube chapter timestamp lines that correspond to meaningful topic transitions."
      : "Only regenerate the requested field.";

  const shortInstruction =
    contentType === "short"
      ? "For Short fields, stay consistent with the selected short-form segment when currentContent includes startTime and endTime. If regenerating startTime or endTime, choose a timestamp that keeps the Short coherent and useful on its own."
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
