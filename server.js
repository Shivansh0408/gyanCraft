// server.js
require("dotenv").config();
const express = require("express");
const multer = require("multer");
const helmet = require("helmet");
const compression = require("compression");
const rateLimit = require("express-rate-limit");
const morgan = require("morgan");
const { createClient } = require("@supabase/supabase-js");
const crypto = require("crypto");
const path = require("path");

// ---- Config from env ----
const PORT = process.env.PORT || 3001;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY; // service role recommended for server uploads
const BUCKET = process.env.SUPABASE_BUCKET || "uploads";
const FILE_PUBLIC = (process.env.FILE_PUBLIC || "true").toLowerCase() === "true"; // if true returns public url; otherwise signed url
const SIGNED_URL_EXPIRES_SEC = parseInt(process.env.SIGNED_URL_EXPIRES_SEC || "3600", 10);
const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE || `${25 * 1024 * 1024}`, 10); // default 25MB
const ALLOWED_ORIGIN = process.env.FRONTEND_ORIGIN || "*"; // set to frontend domain in production

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_KEY in environment. Exiting.");
  process.exit(1);
}

// ---- initialize Supabase client ----
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  // optionally pass custom fetch or headers
});

// ---- express app ----
const app = express();

// Basic middlewares
app.use(helmet());
app.use(compression());
app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));

// Simple CORS handling (configure FRONTEND_ORIGIN to limit origin)
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// Rate limiting to protect the upload endpoint
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: parseInt(process.env.RATE_LIMIT_MAX || "30", 10), // requests per window per IP
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// multer memory storage (we stream the buffer to Supabase)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (req, file, cb) => {
    // optional: restrict to common mime types (comment out to accept all)
    // const allowed = /^image\/|^application\/pdf|^text\/|^application\/msword|^application\/vnd/;
    // if (!allowed.test(file.mimetype)) return cb(new Error("File type not allowed"), false);
    cb(null, true);
  },
});

// health
app.get("/health", (req, res) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

// Main upload endpoint
// Frontend must POST multipart/form-data with field name "file"
app.post("/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file provided. Field name must be 'file'." });
    }

    const file = req.file; // buffer, originalname, mimetype, size
    // basic sanitization of filename
    const safeName = path.basename(file.originalname).replace(/\s+/g, "_").replace(/[^\w.-]/g, "");
    const uuid = (crypto.randomUUID && crypto.randomUUID()) || crypto.randomBytes(16).toString("hex");
    const filename = `${Date.now()}_${uuid}_${safeName}`;

    // Optionally you can put files in folders like 'userId/...' if you have authentication
    const objectPath = filename;

    // upload to supabase storage (buffer)
    const { data, error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(objectPath, file.buffer, {
        contentType: file.mimetype,
        upsert: false,
      });

    if (uploadError) {
      console.error("Supabase upload error:", uploadError);
      return res.status(500).json({ error: "Failed to upload to storage", details: uploadError.message || uploadError });
    }

    // Return either public URL or signed URL based on FILE_PUBLIC
    let publicUrl = null;
    if (FILE_PUBLIC) {
      // public URL (bucket must be public)
      const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(objectPath);
      publicUrl = urlData?.publicUrl || null;
    } else {
      // generate a signed URL (bucket can be private)
      const { data: signedData, error: signedErr } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(objectPath, SIGNED_URL_EXPIRES_SEC);

      if (signedErr) {
        console.error("Signed URL error:", signedErr);
        return res.status(500).json({ error: "Failed to create signed URL", details: signedErr.message || signedErr });
      }
      publicUrl = signedData?.signedUrl || null;
    }

    if (!publicUrl) {
      return res.status(500).json({ error: "Could not generate file URL" });
    }

    // respond with the url in { url: ... } as frontend expects
    return res.status(200).json({ url: publicUrl });
  } catch (err) {
    console.error("Upload endpoint error:", err);
    // multer fileSize limit results in a MulterError; handle nicely
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ error: "File too large", details: `Maximum allowed size is ${MAX_FILE_SIZE} bytes` });
    }
    return res.status(500).json({ error: "Internal server error", details: err.message || String(err) });
  }
});

// Basic 404
app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});

// graceful shutdown
const server = app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});

process.on("SIGTERM", () => {
  console.log("SIGTERM received, closing server...");
  server.close(() => {
    console.log("Server closed.");
    process.exit(0);
  });
});

process.on("SIGINT", () => {
  console.log("SIGINT received, closing server...");
  server.close(() => {
    console.log("Server closed.");
    process.exit(0);
  });
});
