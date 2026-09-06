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
