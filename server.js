// server.js
require('dotenv').config();
const express = require('express');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');
const path = require("path");

const app = express();
const port = process.env.PORT || 3001;  // Render uses process.env.PORT

console.log('🚀 Initializing server...');

// Initialize Supabase
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
  console.error("❌ Missing Supabase environment variables!");
  process.exit(1);
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// Multer Storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit (Render free tier safe)
});

// CORS (Production-safe)
app.use((req, res, next) => {
  const allowedOrigins = [
    'http://localhost:3000',
    process.env.CLIENT_URL // Add deployed frontend domain
  ];

  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.header("Access-Control-Allow-Origin", origin);
  }

  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();
  next();
});

app.use(express.json());

// Health Check
app.get('/health', (req, res) => {
  res.json({
    status: "OK",
    timestamp: new Date().toISOString(),
    supabaseConfigured: true,
    environment: process.env.NODE_ENV || "development"
  });
});

// Upload Endpoint
app.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const timestamp = Date.now();
    const safeName = req.file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, "_");
    const filePath = `uploads/${timestamp}_${safeName}`;

    console.log(`Uploading: ${safeName}`);

    const { data, error } = await supabase.storage
      .from('uploads')
      .upload(filePath, req.file.buffer, {
        contentType: req.file.mimetype,
        upsert: false
      });

    if (error) {
      console.error("Supabase Error:", error);
      return res.status(500).json({ error: "Upload failed", details: error.message });
    }

    const { data: publicUrlData } = supabase.storage
      .from('uploads')
      .getPublicUrl(data.path);

    return res.json({
      message: "File uploaded!",
      path: data.path,
      url: publicUrlData.publicUrl
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error", details: err.message });
  }
});

// 404
app.use("*", (req, res) => {
  res.status(404).json({ error: "Route not found" });
});

// Start
app.listen(port, () =>
  console.log(`🚀 Server running on port ${port}`)
);
