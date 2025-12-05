// server.js
require('dotenv').config();
const express = require('express');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');

const app = express();

// Render requires this — MUST use process.env.PORT
const port = process.env.PORT || 3001;

// Initialize Supabase client
console.log('Initializing Supabase client...');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// Configure multer
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  }
});

// CORS middleware - place this BEFORE routes
app.use((req, res, next) => {
  const allowedOrigins = ['http://localhost:3000', 'http://127.0.0.1:3000'];
  const origin = req.headers.origin;
  
  if (allowedOrigins.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
  }
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  
  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  next();
});

app.use(express.json());

// Test route
app.get('/test', (req, res) => {
  res.json({ message: 'Server is working!', timestamp: new Date().toISOString() });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'Server is running',
    supabaseUrl: process.env.SUPABASE_URL ? 'Configured' : 'Missing',
    supabaseKey: process.env.SUPABASE_ANON_KEY ? 'Configured' : 'Missing',
    port: port
  });
});

// Debug bucket
app.get('/debug-bucket', async (req, res) => {
  try {
    const { data, error } = await supabase.storage
      .from('uploads')
      .list();
    
    if (error) {
      return res.status(400).json({ 
        error: 'Bucket access failed', 
        details: error.message,
        suggestion: 'Check if bucket "uploads" exists in Supabase Storage'
      });
    }

    res.json({ 
      message: 'Bucket is accessible!',
      fileCount: data.length,
      files: data 
    });
  } catch (err) {
    res.status(500).json({ 
      error: 'Server error checking bucket',
      details: err.message 
    });
  }
});

// File upload endpoint
app.post('/upload', upload.single('file'), async (req, res) => {
  try {
    console.log('📤 Upload request received');
    
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded.' });
    }

    // Generate safe filename
    const timestamp = Date.now();
    const safeFileName = req.file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_');
    const filePath = `uploads/${timestamp}_${safeFileName}`;

    console.log(`📁 Uploading: ${safeFileName} (${req.file.size} bytes)`);
    
    // Upload to Supabase
    const { data, error } = await supabase.storage
      .from('uploads')
      .upload(filePath, req.file.buffer, {
        contentType: req.file.mimetype,
        upsert: false
      });

    if (error) {
      console.error('❌ Supabase upload error:', error);
      return res.status(500).json({ 
        error: 'Upload failed', 
        details: error.message 
      });
    }

    // Get public URL
    const { data: publicUrlData } = supabase.storage
      .from('uploads')
      .getPublicUrl(data.path);

    console.log('✅ File uploaded successfully:', publicUrlData.publicUrl);

    res.json({
      message: 'File uploaded successfully!',
      path: data.path,
      publicUrl: publicUrlData.publicUrl,
      fileName: safeFileName
    });
    
  } catch (err) {
    console.error('🚨 Server error:', err);
    res.status(500).json({ 
      error: 'Internal server error',
      details: err.message 
    });
  }
});

// Catch-all
app.use('*', (req, res) => {
  res.status(404).json({ 
    error: 'Route not found',
    availableRoutes: ['/health', '/debug-bucket', '/test', '/upload']
  });
});

// Start server
app.listen(port, () => {
  console.log(`🚀 Server running on http://localhost:${port}`);
  console.log(`🔍 Health check: http://localhost:${port}/health`);
  console.log(`🔍 Test bucket: http://localhost:${port}/debug-bucket`);
  console.log(`🔍 Simple test: http://localhost:${port}/test`);
});
