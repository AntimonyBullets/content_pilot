import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
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

// Reads an error message off an axios-style response payload.
const getResponseMessage = (error: unknown, fallback: string): string => {
  const responseError = error as { response?: { data?: { message?: string } } };
  return responseError.response?.data?.message || fallback;
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const [youtubeStatus, setYoutubeStatus] = useState<YouTubeStatusResponse | null>(null);
  const [youtubeLoading, setYoutubeLoading] = useState<boolean>(false);
  const [youtubeNotice, setYoutubeNotice] = useState<string | null>(null);

  const fetchYouTubeStatus = useCallback(async () => {
    setYoutubeLoading(true);
    try {
      const data = await getYouTubeStatus();
      setYoutubeStatus(data);
    } catch (error: unknown) {
      console.error("Failed to fetch YouTube status:", error);
      setYoutubeStatus({ connected: false, channel: null });
    } finally {
      setYoutubeLoading(false);
    }
  }, []);

  const checkSession = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getCurrentUser();
      setUser(data.user);
      await fetchYouTubeStatus();
    } catch {
      setUser(null);
      setYoutubeStatus(null);
    } finally {
      setLoading(false);
    }
  }, [fetchYouTubeStatus]);

  useEffect(() => {
    void checkSession();

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
  }, [checkSession]);

  const login = async (email: string, password: string) => {
    setError(null);
    try {
      const data = await loginUser(email, password);
      setUser(data.user);
      await fetchYouTubeStatus();
    } catch (error: unknown) {
      const msg = getResponseMessage(error, "Login failed. Please check your credentials.");
      setError(msg);
      const thrown = new Error(msg);
      thrown.cause = error;
      throw thrown;
    }
  };

  const register = async (name: string, email: string, password: string) => {
    setError(null);
    try {
      const data = await registerUser(name, email, password);
      setUser(data.user);
      await fetchYouTubeStatus();
    } catch (error: any) {
      const msg = error.response?.data?.message || "Registration failed. Please try again.";
      setError(msg);
      throw new Error(msg);
    }
  };

  const logout = async () => {
    try {
      await logoutUser();
    } catch (error: unknown) {
      console.error("Logout error:", error);
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
    } catch (error: any) {
      const msg = error.response?.data?.message || "Failed to disconnect YouTube.";
      setError(msg);
    } finally {
      setYoutubeLoading(false);
    }
  };

  const clearNotice = useCallback(() => {
    setYoutubeNotice(null);
  }, []);

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
