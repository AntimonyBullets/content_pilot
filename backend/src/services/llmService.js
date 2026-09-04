import { GoogleGenAI } from "@google/genai";

const normalizeModelConfig = (llmModel) => {
  const requestedModel = String(llmModel || "gemini").trim();

  if (!requestedModel || requestedModel !== "gemini") {
    const error = new Error(`Unsupported LLM model: ${requestedModel}`);
    error.code = "UNSUPPORTED_LLM_MODEL";
    throw error;
  }

  if (!process.env.GEMINI_MODEL) {
    const error = new Error("GEMINI_MODEL is not configured");
    error.code = "MISSING_GEMINI_MODEL";
    throw error;
  }

  return {
    provider: "gemini",
    modelName: process.env.GEMINI_MODEL,
  };
};

const getGeminiClient = () => {
  if (!process.env.GEMINI_API_KEY) {
    const error = new Error("GEMINI_API_KEY is not configured");
    error.code = "MISSING_GEMINI_API_KEY";
    throw error;
  }

  return new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    apiVersion: "v1beta",
  });
};

const toGeminiInput = (messages) =>
  messages
    .map(([role, text]) => `${role.toUpperCase()}:\n${text}`)
    .join("\n\n");

const parseStructuredOutput = (interaction) => {
  const outputText = interaction?.output_text;

  if (!outputText || typeof outputText !== "string") {
    const error = new Error("Gemini interaction did not return output_text");
    error.code = "INVALID_LLM_RESPONSE";
    throw error;
  }

  try {
    return JSON.parse(outputText);
  } catch {
    const error = new Error("Gemini interaction returned invalid JSON");
    error.code = "INVALID_LLM_RESPONSE";
    throw error;
  }
};

const createGeminiStructuredInteraction = async ({ modelName, schema, messages }) => {
  const client = getGeminiClient();

  const interaction = await client.interactions.create({
    model: modelName,
    input: toGeminiInput(messages),
    store: false,
    response_format: {
      type: "text",
      mime_type: "application/json",
      schema,
    },
  });

  return parseStructuredOutput(interaction);
};

export const generateStructuredOutput = async ({
  llmModel,
  schema,
  messages,
}) => {
  const modelConfig = normalizeModelConfig(llmModel);

  if (modelConfig.provider !== "gemini") {
    const error = new Error(`Unsupported LLM provider: ${modelConfig.provider}`);
    error.code = "UNSUPPORTED_LLM_MODEL";
    throw error;
  }

  try {
    return createGeminiStructuredInteraction({
      modelName: modelConfig.modelName,
      schema,
      messages,
    });
  } catch (error) {
    if (error.code) {
      throw error;
    }

    const providerError = new Error("Gemini content generation failed");
    providerError.code = "LLM_PROVIDER_ERROR";
    providerError.cause = error;
    throw providerError;
  }
};
