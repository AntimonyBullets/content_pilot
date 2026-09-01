import fs from "fs";
import Groq from "groq-sdk";

const GROQ_WHISPER_MODEL = "whisper-large-v3-turbo";

const getGroqClient = () => {
  if (!process.env.GROQ_API_KEY) {
    const error = new Error("GROQ_API_KEY is not configured");
    error.code = "MISSING_GROQ_API_KEY";
    throw error;
  }

  return new Groq({ apiKey: process.env.GROQ_API_KEY });
};

export const transcribeAudioFile = async (audioPath) => {
  const client = getGroqClient();

  return client.audio.transcriptions.create({
    file: fs.createReadStream(audioPath),
    model: GROQ_WHISPER_MODEL,
    response_format: "verbose_json",
    timestamp_granularities: ["segment"],
  });
};
