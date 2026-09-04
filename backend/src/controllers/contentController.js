import {
  generateContentFromTranscript,
  regenerateContentField,
} from "../services/contentGenerationService.js";

const errorResponse = (error) => {
  if (error.code === "MISSING_TRANSCRIPT") {
    return [400, "Transcript text is required"];
  }

  if (error.code === "MISSING_TRANSCRIPT_SEGMENTS") {
    return [400, "Timestamped transcript segments are required for this request"];
  }

  if (
    error.code === "UNSUPPORTED_LLM_MODEL" ||
    error.code === "UNSUPPORTED_CONTENT_TYPE" ||
    error.code === "UNSUPPORTED_CONTENT_FIELD" ||
    error.code === "INVALID_REGENERATION_MESSAGE"
  ) {
    return [400, error.message];
  }

  if (error.code === "MISSING_GEMINI_API_KEY" || error.code === "MISSING_GEMINI_MODEL") {
    return [500, "Gemini is not configured"];
  }

  if (error.code === "INVALID_LLM_RESPONSE") {
    return [502, "The LLM returned an invalid content response"];
  }

  if (error.code === "LLM_PROVIDER_ERROR") {
    return [502, "Gemini content generation failed"];
  }

  return [500, "Unable to generate content"];
};

export const generateContent = async (req, res) => {
  try {
    const content = await generateContentFromTranscript({
      transcript: req.body?.transcript,
      settings: req.body?.settings,
    });

    return res.status(200).json({
      message: "Content generated successfully",
      content,
    });
  } catch (error) {
    const [status, message] = errorResponse(error);

    console.error("Content generation error:", error.message);
    return res.status(status).json({ message });
  }
};

export const regenerateContent = async (req, res) => {
  try {
    const regeneratedField = await regenerateContentField({
      transcript: req.body?.transcript,
      contentType: req.body?.contentType,
      field: req.body?.field,
      currentContent: req.body?.currentContent,
      message: req.body?.message,
      settings: req.body?.settings,
    });

    return res.status(200).json({
      message: "Content field regenerated successfully",
      regeneratedField,
    });
  } catch (error) {
    const [status, message] = errorResponse(error);

    console.error("Content regeneration error:", error.message);
    return res.status(status).json({ message });
  }
};
