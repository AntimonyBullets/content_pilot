import React, { createContext, useContext, useEffect, useState } from "react";
import type { User, YouTubeStatusResponse } from "../api/client";
import {
  getCurrentUser,
  getYouTubeStatus,
  loginUser,
  logoutUser,
  registerUser,
  disconnectYouTube as apiDisconnectYouTube,
} from "../api/client";

interface AuthContextType {
  user: User | null;
  loading: boolean;
  error: string | null;
  youtubeStatus: YouTubeStatusResponse | null;
  youtubeLoading: boolean;
  youtubeNotice: string | null;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshYouTubeStatus: () => Promise<void>;
  disconnectYouTube: () => Promise<void>;
  clearNotice: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const [youtubeStatus, setYoutubeStatus] = useState<YouTubeStatusResponse | null>(null);
  const [youtubeLoading, setYoutubeLoading] = useState<boolean>(false);
  const [youtubeNotice, setYoutubeNotice] = useState<string | null>(null);

  const fetchYouTubeStatus = async () => {
    setYoutubeLoading(true);
    try {
      const data = await getYouTubeStatus();
      setYoutubeStatus(data);
    } catch (err: any) {
      console.error("Failed to fetch YouTube status:", err);
      setYoutubeStatus({ connected: false, channel: null });
    } finally {
      setYoutubeLoading(false);
    }
  };

  const checkSession = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getCurrentUser();
      setUser(data.user);
      await fetchYouTubeStatus();
    } catch (err: any) {
      setUser(null);
      setYoutubeStatus(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    checkSession();

    // Check for YouTube OAuth redirect parameters in URL
    const urlParams = new URLSearchParams(window.location.search);
    const youtubeAuth = urlParams.get("youtube_auth");
    const reason = urlParams.get("reason");

    if (youtubeAuth === "success") {
      setYoutubeNotice("YouTube connected successfully!");
      // Clean up search query param from URL without reloading page
      window.history.replaceState({}, document.title, window.location.pathname);
    } else if (youtubeAuth === "error") {
      setYoutubeNotice(`YouTube connection failed: ${reason || "Access denied or unknown error"}`);
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  const login = async (email: string, password: string) => {
    setError(null);
    try {
      const data = await loginUser(email, password);
      setUser(data.user);
      await fetchYouTubeStatus();
    } catch (err: any) {
      const msg = err.response?.data?.message || "Login failed. Please check your credentials.";
      setError(msg);
      throw new Error(msg);
    }
  };

  const register = async (name: string, email: string, password: string) => {
    setError(null);
    try {
      const data = await registerUser(name, email, password);
      setUser(data.user);
      await fetchYouTubeStatus();
    } catch (err: any) {
      const msg = err.response?.data?.message || "Registration failed. Please try again.";
      setError(msg);
      throw new Error(msg);
    }
  };

  const logout = async () => {
    try {
      await logoutUser();
    } catch (err: any) {
      console.error("Logout error:", err);
    } finally {
      setUser(null);
      setYoutubeStatus(null);
      setError(null);
    }
  };

  const disconnectYouTube = async () => {
    setYoutubeLoading(true);
    try {
      await apiDisconnectYouTube();
      setYoutubeStatus({ connected: false, channel: null });
      setYoutubeNotice("YouTube disconnected successfully.");
    } catch (err: any) {
      const msg = err.response?.data?.message || "Failed to disconnect YouTube.";
      setError(msg);
    } finally {
      setYoutubeLoading(false);
    }
  };

  const clearNotice = () => {
    setYoutubeNotice(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        error,
        youtubeStatus,
        youtubeLoading,
        youtubeNotice,
        login,
        register,
        logout,
        refreshYouTubeStatus: fetchYouTubeStatus,
        disconnectYouTube,
        clearNotice,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};
