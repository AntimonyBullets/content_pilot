import { GoogleGenAI } from "@google/genai";
import Groq from "groq-sdk";

const normalizeModelConfig = (llmModel) => {
  const requestedModel = String(llmModel || "gemini-3.6-flash").trim();

  if (requestedModel === "gemini-3.6-flash" || requestedModel === "gemini") {
    if (!process.env.GEMINI_MODEL) {
      const error = new Error("GEMINI_MODEL is not configured");
      error.code = "MISSING_GEMINI_MODEL";
      throw error;
    }

    return {
      provider: "gemini",
      modelName: process.env.GEMINI_MODEL,
    };
  }

  if (requestedModel === "openai/gpt-oss-120b") {
    return {
      provider: "groq",
      modelName: "openai/gpt-oss-120b",
    };
  }

  if (!requestedModel) {
    const error = new Error(`Unsupported LLM model: ${requestedModel}`);
    error.code = "UNSUPPORTED_LLM_MODEL";
    throw error;
  }
  const error = new Error(`Unsupported LLM model: ${requestedModel}`);
  error.code = "UNSUPPORTED_LLM_MODEL";
  throw error;
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

const parseStructuredOutput = (interaction, provider) => {
  const outputText = interaction?.output_text;

  if (!outputText || typeof outputText !== "string") {
    const error = new Error(`${provider} interaction did not return structured output`);
    error.code = "INVALID_LLM_RESPONSE";
    throw error;
  }

  try {
    return JSON.parse(outputText);
  } catch {
    const error = new Error(`${provider} interaction returned invalid JSON`);
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

  return parseStructuredOutput(interaction, "Gemini");
};

const getGroqClient = () => {
  if (!process.env.GROQ_API_KEY) {
    const error = new Error("GROQ_API_KEY is not configured");
    error.code = "MISSING_GROQ_API_KEY";
    throw error;
  }

  return new Groq({ apiKey: process.env.GROQ_API_KEY });
};

const toGroqMessages = (messages) =>
  messages.map(([role, content]) => ({ role, content }));

const createGroqStructuredInteraction = async ({ modelName, schema, messages }) => {
  const client = getGroqClient();
  const response = await client.chat.completions.create({
    model: modelName,
    messages: toGroqMessages(messages),
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "content_generation",
        strict: true,
        schema,
      },
    },
  });
  const outputText = response?.choices?.[0]?.message?.content;
  return parseStructuredOutput({ output_text: outputText }, "Groq");
};

export const generateStructuredOutput = async ({
  llmModel,
  schema,
  messages,
}) => {
  const modelConfig = normalizeModelConfig(llmModel);

  try {
    if (modelConfig.provider === "gemini") {
      return await createGeminiStructuredInteraction({
        modelName: modelConfig.modelName,
        schema,
        messages,
      });
    }

    return await createGroqStructuredInteraction({
      modelName: modelConfig.modelName,
      schema,
      messages,
    });
  } catch (error) {
    if (error.code) {
      throw error;
    }

    const providerError = new Error(`${modelConfig.provider} content generation failed`);
    providerError.code = "LLM_PROVIDER_ERROR";
    providerError.cause = error;
    throw providerError;
  }
};
