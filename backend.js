/**
 * SXA — Backend API Server
 * ─────────────────────────────────────────────────────────
 * Node.js + Express REST API for the Sport eXperience Analyzer.
 *
 * Endpoints:
 *   POST /api/upload           — upload a video for analysis
 *   POST /api/analyze          — analyze an already-uploaded session
 *   GET  /api/profile/:id      — fetch athlete profile
 *   POST /api/profile          — create / update athlete profile
 *   GET  /api/sessions/:id     — fetch a past analysis session
 *   GET  /api/sessions         — list all sessions (optional athleteId filter)
 *
 * Install:
 *   npm install express multer cors helmet morgan uuid
 *   npm install better-sqlite3   (or swap for pg / mongoose)
 *   npm install fluent-ffmpeg    (requires ffmpeg binary)
 *
 * Run:
 *   node server.js
 *   # or with live-reload:
 *   npx nodemon server.js
 */

'use strict';

const express  = require('express');
const cors     = require('cors');
const helmet   = require('helmet');
const morgan   = require('morgan');
const path     = require('path');
const fs       = require('fs');
const { v4: uuidv4 } = require('uuid');

/* ── Optional dependencies (graceful fallback) ─────────── */
let multer, Database, ffmpeg;
try { multer   = require('multer');    } catch(_) { multer   = null; }
try { Database = require('better-sqlite3'); } catch(_) { Database = null; }
try { ffmpeg   = require('fluent-ffmpeg'); } catch(_) { ffmpeg = null; }

/* ═══════════════════════════════════════════════════════
   CONFIG
═══════════════════════════════════════════════════════ */
const PORT       = process.env.PORT        || 4000;
const UPLOAD_DIR = process.env.UPLOAD_DIR  || path.join(__dirname, 'uploads');
const DB_PATH    = process.env.DB_PATH     || path.join(__dirname, 'db', 'sxa.sqlite');
const MAX_MB     = parseInt(process.env.MAX_FILE_SIZE_MB || '100', 10);
const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS || 'http://localhost:5173,http://localhost:3000').split(',');

/* ── Ensure required directories exist ─────────────────── */
[UPLOAD_DIR, path.dirname(DB_PATH)].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

/* ═══════════════════════════════════════════════════════
   DATABASE (SQLite via better-sqlite3)
═══════════════════════════════════════════════════════ */
let db = null;

if (Database) {
  db = new Database(DB_PATH);
  db.exec(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS athletes (
      id          TEXT PRIMARY KEY,
      name        TEXT,
      age         INTEGER,
      height_cm   REAL,
      weight_kg   REAL,
      sport       TEXT,
      level       TEXT,
      created_at  TEXT DEFAULT (datetime('now')),
      updated_at  TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id           TEXT PRIMARY KEY,
      athlete_id   TEXT,
      sport        TEXT,
      overall      INTEGER,
      scores       TEXT,   -- JSON
      metrics      TEXT,   -- JSON
      insights     TEXT,   -- JSON array
      file_path    TEXT,
      frame_count  INTEGER,
      created_at   TEXT DEFAULT (datetime('now'))
    );
  `);
  console.log('✅ SQLite database initialised at', DB_PATH);
} else {
  console.warn('⚠️  better-sqlite3 not installed — running without persistence');
}

/* ═══════════════════════════════════════════════════════
   MULTER — file upload config
═══════════════════════════════════════════════════════ */
let upload = null;
if (multer) {
  const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename:    (req, file, cb) => {
      const ext  = path.extname(file.originalname).toLowerCase();
      const name = `${uuidv4()}${ext}`;
      cb(null, name);
    },
  });

  const fileFilter = (req, file, cb) => {
    const allowed = ['.mp4', '.mov', '.avi', '.webm', '.mkv'];
    const ext = path.extname(file.originalname).toLowerCase();
    allowed.includes(ext)
      ? cb(null, true)
      : cb(new Error(`Unsupported file type: ${ext}. Allowed: ${allowed.join(', ')}`));
  };

  upload = multer({
    storage,
    fileFilter,
    limits: { fileSize: MAX_MB * 1024 * 1024 },
  });
}

/* ═══════════════════════════════════════════════════════
   BIOMECHANICS SCORING SERVICE
   (pure JS version — no Python bridge required)
═══════════════════════════════════════════════════════ */
const SPORT_PATTERNS = {
  'long-jump':  { name:'Long Jump',           weights:{ form:0.30, power:0.20, consistency:0.20, balance:0.15, timing:0.15 }},
  'high-jump':  { name:'High Jump',           weights:{ form:0.35, power:0.20, consistency:0.18, balance:0.12, timing:0.15 }},
  sprinting:    { name:'Sprinting',           weights:{ form:0.25, power:0.25, consistency:0.25, balance:0.10, timing:0.15 }},
  basketball:   { name:'Basketball Shooting', weights:{ form:0.35, power:0.15, consistency:0.25, balance:0.15, timing:0.10 }},
  soccer:       { name:'Soccer Kicking',      weights:{ form:0.30, power:0.20, consistency:0.20, balance:0.15, timing:0.15 }},
  tennis:       { name:'Tennis Serve',        weights:{ form:0.32, power:0.18, consistency:0.22, balance:0.13, timing:0.15 }},
  running:      { name:'Distance Running',    weights:{ form:0.25, power:0.20, consistency:0.30, balance:0.15, timing:0.10 }},
  golf:         { name:'Golf Swing',          weights:{ form:0.35, power:0.20, consistency:0.25, balance:0.12, timing:0.08 }},
  yoga:         { name:'Yoga',                weights:{ form:0.40, power:0.05, consistency:0.20, balance:0.30, timing:0.05 }},
  jumping:      { name:'Jump Training',       weights:{ form:0.25, power:0.35, consistency:0.20, balance:0.12, timing:0.08 }},
  swimming:     { name:'Swimming',            weights:{ form:0.35, power:0.20, consistency:0.25, balance:0.10, timing:0.10 }},
  cycling:      { name:'Cycling',             weights:{ form:0.30, power:0.25, consistency:0.25, balance:0.12, timing:0.08 }},
};

/**
 * Simulate a full biomechanics analysis for a sport.
 * In production this would run MediaPipe on extracted frames.
 * Returns scores + metrics + coaching insights.
 */
function analyzeVideo(sportKey, filePath) {
  const pattern = SPORT_PATTERNS[sportKey] || SPORT_PATTERNS.running;
  const { weights } = pattern;

  // Simulated per-category scores (replace with real pose data)
  const rawScores = {
    form:        60 + Math.round(Math.random() * 35),
    power:       55 + Math.round(Math.random() * 40),
    consistency: 58 + Math.round(Math.random() * 37),
    balance:     62 + Math.round(Math.random() * 33),
    timing:      57 + Math.round(Math.random() * 38),
  };

  const overall = Math.round(
    Object.entries(rawScores).reduce((sum, [k, v]) => sum + v * (weights[k] || 0.2), 0)
  );

  const metrics = {
    kneeAngle:   75  + Math.round(Math.random() * 30),
    hipAngle:    155 + Math.round(Math.random() * 40),
    armAngle:    70  + Math.round(Math.random() * 60),
    speedIndex:  (1.5 + Math.random() * 3.5).toFixed(1),
    balance:     60  + Math.round(Math.random() * 35),
  };

  const insights = generateInsights(rawScores, metrics, pattern.name);

  return {
    sport:      pattern.name,
    sportKey,
    overall:    Math.min(100, Math.max(0, overall)),
    scores:     rawScores,
    metrics,
    insights,
    frameCount: 180 + Math.round(Math.random() * 120),
  };
}

function generateInsights(scores, metrics, sportName) {
  const insights = [];

  if (scores.form < 65)        insights.push('Work on joint alignment — your form score indicates suboptimal positioning during key phases.');
  if (scores.power < 65)       insights.push('Power output is below average for your sport. Add plyometric or resistance exercises.');
  if (scores.consistency < 65) insights.push('Movement variability is high. Focus on drilling the same technique repeatedly.');
  if (scores.balance < 65)     insights.push('Centre of mass shifts detected. Single-leg balance work can help stabilise your base.');
  if (scores.timing < 65)      insights.push('Phase timing is off — practice slow-motion drills to reinforce the correct sequence.');

  if (metrics.kneeAngle < 80)  insights.push('Knee bend is excessive at key moment. Check your stance width and foot placement.');
  if (metrics.kneeAngle > 160) insights.push('Legs too straight — increase knee flexion for better shock absorption.');
  if (scores.form >= 80)       insights.push(`Excellent ${sportName} form! Maintain this technique under fatigue.`);
  if (scores.consistency >= 80)insights.push('Highly consistent movement patterns — great for competition repeatability.');

  return insights.slice(0, 5);
}

/* ═══════════════════════════════════════════════════════
   EXPRESS APP
═══════════════════════════════════════════════════════ */
const app = express();

app.use(helmet({ crossOriginResourcePolicy:{ policy:'cross-origin' } }));
app.use(cors({ origin: ALLOWED_ORIGINS, methods:['GET','POST','PUT','DELETE','OPTIONS'], allowedHeaders:['Content-Type','Authorization'] }));
app.use(morgan('dev'));
app.use(express.json({ limit:'2mb' }));
app.use(express.urlencoded({ extended:true }));

/* serve uploaded files as static */
app.use('/uploads', express.static(UPLOAD_DIR));

/* ── Health check ───────────────────────────────────────── */
app.get('/health', (req, res) => {
  res.json({
    status:    'ok',
    service:   'SXA API',
    version:   '1.0.0',
    timestamp: new Date().toISOString(),
    db:        db ? 'connected' : 'not connected',
  });
});

/* ── POST /api/upload  ──────────────────────────────────── */
app.post('/api/upload', requireMulter, upload.single('video'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No video file uploaded.' });

  const sessionId = uuidv4();
  const sportKey  = req.body.sport && SPORT_PATTERNS[req.body.sport] ? req.body.sport : 'running';

  res.json({
    message:   'File uploaded successfully',
    sessionId,
    filename:  req.file.filename,
    size:      req.file.size,
    sport:     sportKey,
    fileUrl:   `/uploads/${req.file.filename}`,
    nextStep:  `POST /api/analyze with { sessionId, sport }`,
  });
});

/* ── POST /api/analyze  ─────────────────────────────────── */
app.post('/api/analyze', requireMulter, upload.single('video'), (req, res) => {
  const sportKey  = req.body.sport && SPORT_PATTERNS[req.body.sport] ? req.body.sport : 'running';
  const filePath  = req.file ? req.file.path : req.body.filePath || null;
  const athleteId = req.body.athleteId || null;

  const result    = analyzeVideo(sportKey, filePath);
  const sessionId = uuidv4();

  /* Persist to DB */
  if (db) {
    try {
      db.prepare(`
        INSERT INTO sessions (id, athlete_id, sport, overall, scores, metrics, insights, file_path, frame_count)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        sessionId,
        athleteId,
        result.sport,
        result.overall,
        JSON.stringify(result.scores),
        JSON.stringify(result.metrics),
        JSON.stringify(result.insights),
        filePath,
        result.frameCount,
      );
    } catch (e) {
      console.error('DB insert failed:', e.message);
    }
  }

  res.json({ sessionId, ...result });
});

/* ── GET /api/sessions/:id  ─────────────────────────────── */
app.get('/api/sessions/:id', requireDB, (req, res) => {
  const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Session not found.' });
  res.json(parseSession(row));
});

/* ── GET /api/sessions  ─────────────────────────────────── */
app.get('/api/sessions', requireDB, (req, res) => {
  const { athleteId, limit = 20 } = req.query;
  const rows = athleteId
    ? db.prepare('SELECT * FROM sessions WHERE athlete_id = ? ORDER BY created_at DESC LIMIT ?').all(athleteId, +limit)
    : db.prepare('SELECT * FROM sessions ORDER BY created_at DESC LIMIT ?').all(+limit);
  res.json(rows.map(parseSession));
});

/* ── POST /api/profile  ─────────────────────────────────── */
app.post('/api/profile', requireDB, (req, res) => {
  const { name, age, height, weight, sport, level, id } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required.' });

  const athleteId = id || uuidv4();
  db.prepare(`
    INSERT INTO athletes (id, name, age, height_cm, weight_kg, sport, level, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      name       = excluded.name,
      age        = excluded.age,
      height_cm  = excluded.height_cm,
      weight_kg  = excluded.weight_kg,
      sport      = excluded.sport,
      level      = excluded.level,
      updated_at = datetime('now')
  `).run(athleteId, name, age||null, height||null, weight||null, sport||null, level||null);

  res.json({ id: athleteId, message: 'Profile saved.' });
});

/* ── GET /api/profile/:id  ──────────────────────────────── */
app.get('/api/profile/:id', requireDB, (req, res) => {
  const row = db.prepare('SELECT * FROM athletes WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Athlete not found.' });
  res.json(row);
});

/* ── 404 handler ─────────────────────────────────────────── */
app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found.` });
});

/* ── Error handler ───────────────────────────────────────── */
app.use((err, req, res, _next) => {
  console.error('Unhandled error:', err.message);
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: `File too large. Max size is ${MAX_MB}MB.` });
  }
  res.status(500).json({ error: err.message || 'Internal server error.' });
});

/* ═══════════════════════════════════════════════════════
   HELPERS
═══════════════════════════════════════════════════════ */
function parseSession(row) {
  return {
    ...row,
    scores:   JSON.parse(row.scores   || 'null'),
    metrics:  JSON.parse(row.metrics  || 'null'),
    insights: JSON.parse(row.insights || '[]'),
  };
}

function requireMulter(req, res, next) {
  if (!multer || !upload) {
    return res.status(503).json({ error: 'File upload unavailable. Install multer: npm install multer' });
  }
  next();
}

function requireDB(req, res, next) {
  if (!db) {
    return res.status(503).json({ error: 'Database unavailable. Install better-sqlite3: npm install better-sqlite3' });
  }
  next();
}

/* ═══════════════════════════════════════════════════════
   START
═══════════════════════════════════════════════════════ */
app.listen(PORT, () => {
  console.log(`\n🏅  SXA API running on http://localhost:${PORT}`);
  console.log(`   Health:   GET  http://localhost:${PORT}/health`);
  console.log(`   Analyze:  POST http://localhost:${PORT}/api/analyze`);
  console.log(`   Profile:  POST http://localhost:${PORT}/api/profile\n`);
});

module.exports = app; // for testing
