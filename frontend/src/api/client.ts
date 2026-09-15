import axios from "axios";

const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";

export const api = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
});

export interface User {
  id: string;
  name: string;
  email: string;
  createdAt: string;
  updatedAt: string;
}

export interface YouTubeChannel {
  channelId: string | null;
  channelTitle: string | null;
  channelThumbnailUrl: string | null;
  connectedAt: string;
}

export interface YouTubeStatusResponse {
  connected: boolean;
  channel: YouTubeChannel | null;
}

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

export interface Transcript {
  text: string;
  segments: TranscriptSegment[];
}

export interface TranscriptionResponse {
  message: string;
  transcript: Transcript;
  sessionId: string;
}

export interface ContentSettings {
  enableShort: boolean;
  automateEntireProcess: boolean;
  createChapters: boolean;
  addToSuitablePlaylist: boolean;
  llmModel: string;
}

export interface GeneratedMainVideo {
  title: string;
  description: string;
  tags: string[];
}

export interface GeneratedShortVideo {
  title: string;
  description: string;
  hashtags: string[];
  startTime?: number | null;
  endTime?: number | null;
}

export interface GeneratedContent {
  mainVideo: GeneratedMainVideo;
  short?: GeneratedShortVideo | null;
}

export interface YouTubePlaylist {
  id: string;
  title: string;
  description?: string;
}

// Authentication API calls
export const registerUser = async (name: string, email: string, password: string) => {
  const response = await api.post<{ message: string; user: User }>("/api/auth/register", {
    name,
    email,
    password,
  });
  return response.data;
};

export const loginUser = async (email: string, password: string) => {
  const response = await api.post<{ message: string; user: User }>("/api/auth/login", {
    email,
    password,
  });
  return response.data;
};

export const logoutUser = async () => {
  const response = await api.post<{ message: string }>("/api/auth/logout");
  return response.data;
};

export const getCurrentUser = async () => {
  const response = await api.get<{ user: User }>("/api/auth/me");
  return response.data;
};

// YouTube API calls
export const getYouTubeStatus = async () => {
  const response = await api.get<YouTubeStatusResponse>("/api/youtube/status");
  return response.data;
};

export const disconnectYouTube = async () => {
  const response = await api.post<{ message: string }>("/api/youtube/disconnect");
  return response.data;
};

export const getYouTubeConnectUrl = () => {
  return `${API_BASE_URL}/api/youtube/connect`;
};

export const getYouTubePlaylists = async () => {
  const response = await api.get<{ playlists: YouTubePlaylist[] }>("/api/youtube/playlists");
  return response.data;
};

export const transcribeVideo = async (video: File) => {
  const formData = new FormData();
  formData.append("video", video);
  const response = await api.post<TranscriptionResponse>("/api/videos/transcribe", formData);
  return response.data;
};

export const transcribeVideoUrl = async (videoUrl: string) => {
  const response = await api.post<TranscriptionResponse>("/api/videos/transcribe", { videoUrl });
  return response.data;
};

export const getShortPreview = async (sessionId: string) => {
  const response = await api.get<Blob>(`/api/videos/short-preview/${sessionId}`, {
    responseType: "blob",
  });
  return response.data;
};

export const uploadThumbnail = async (sessionId: string, thumbnail: File) => {
  const formData = new FormData();
  formData.append("thumbnail", thumbnail);
  const response = await api.post<{ message: string; thumbnailPath: string }>(
    `/api/youtube/thumbnail/${sessionId}`,
    formData
  );
  return response.data;
};

export const uploadShortThumbnail = async (sessionId: string, thumbnail: File) => {
  const formData = new FormData();
  formData.append("thumbnail", thumbnail);
  const response = await api.post<{ message: string; thumbnailPath: string }>(
    `/api/youtube/thumbnail/short/${sessionId}`,
    formData
  );
  return response.data;
};

export const generateContent = async (
  sessionId: string,
  transcript: Transcript,
  settings: ContentSettings
) => {
  const response = await api.post<{
    message: string;
    sessionId: string;
    content: GeneratedContent;
    playlist: YouTubePlaylist | null;
  }>("/api/content/generate", {
      sessionId,
      transcript,
      settings,
    });
  return response.data;
};
