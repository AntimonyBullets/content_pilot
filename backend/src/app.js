import "dotenv/config";

import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import authRoutes from "./routes/authRoutes.js";
import contentRoutes from "./routes/contentRoutes.js";
import videoRoutes from "./routes/videoRoutes.js";

const app = express();

app.use(
  cors({
    origin: process.env.FRONTEND_ORIGIN,
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser());

app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});

app.use("/api/auth", authRoutes);
app.use("/api/content", contentRoutes);
app.use("/api/videos", videoRoutes);

app.use((req, res) => {
  res.status(404).json({ message: "Route not found" });
});

export default app;
