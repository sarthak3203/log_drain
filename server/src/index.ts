import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
// import logRoutes from "./routes/logs";
// import searchRoutes from "./routes/search";
// import authRoutes from "./routes/auth";
// import alertRoutes from "./routes/alerts";
// import statsRoutes from "./routes/stats";
const app = express();

// Security headers
app.use(helmet());
// CORS: allow your frontend domain
app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:5173",
    credentials: true,
  }),
);
// Parse JSON bodies
app.use(express.json({ limit: "5mb" })); // 5mb limit; a batch of 1000 logs is ~1mb
// HTTP request logging
app.use(morgan("combined"));
// Health check — no auth required
app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});
// Routes
// app.use("/api/v1", authRoutes);
// app.use("/api/v1", logRoutes);
// app.use("/api/v1", searchRoutes);
// app.use("/api/v1", alertRoutes);
// app.use("/api/v1", statsRoutes);
// Global error handler
app.use(
  (
    err: Error,
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    console.error("Unhandled error:", err);
    res.status(500).json({ error: "Internal server error" });
  },
);
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Log Drain Service running on port ${PORT}`);
});
export default app;
