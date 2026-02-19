> Real-time AI-powered athletic performance analysis using pose detection and biomechanics scoring.

![SXA Banner](https://img.shields.io/badge/SXA-Sport%20Analysis-00E5FF?style=for-the-badge&logo=data:image/svg+xml;base64,)
![React](https://img.shields.io/badge/React-18-61DAFB?style=flat-square&logo=react)
![MediaPipe](https://img.shields.io/badge/MediaPipe-Pose-FF6F00?style=flat-square)
![Node](https://img.shields.io/badge/Node.js-18+-339933?style=flat-square&logo=node.js)

---

## Overview

SXA is a full-stack sports performance analysis platform that combines **computer vision**, **pose estimation**, and **biomechanics modeling** to provide real-time feedback on athletic technique. Athletes can either upload a video for frame-by-frame analysis or use their webcam for live pose detection and scoring.

---

## Features

| Feature | Description |
|---|---|
| 🔴 **Live Detection** | Real-time webcam pose analysis with skeleton overlay |
| 📹 **Video Upload** | Upload MP4/MOV files for full frame analysis |
| 🏅 **12 Sports Supported** | Running, sprinting, basketball, soccer, tennis, golf, yoga, jumping and more |
| 📊 **5 Metrics Scored** | Form, Power, Consistency, Balance, and Timing (0–100) |
| 💪 **Athlete Profile** | BMI calculator, physical stats, injury risk assessment |
| 🥗 **Nutrition Engine** | Personalized macros and meal recommendations by sport |
| 🦴 **Injury Prevention** | Risk analysis with severity tiers and prevention tips |
| 🖨️ **Print Reports** | Print-ready performance reports |

---

## Tech Stack

### Frontend
- **React 18** (via UMD CDN / or CRA / Vite)
- **MediaPipe Pose** (`@mediapipe/pose@0.5`) — 33-landmark body skeleton
- **Babel Standalone** — JSX transpilation in browser
- **CSS Custom Properties** — dark-mode design system with `Bebas Neue`, `DM Sans`, `JetBrains Mono`

### Backend
- **Node.js + Express** — REST API server
- **Multer** — video/image file upload handling
- **FFmpeg** — video frame extraction
- **Python (optional bridge)** — MediaPipe server-side processing
- **SQLite / PostgreSQL** — session and athlete profile persistence

---

## Project Structure

```
sxa/
├── README.md
├── frontend/
│   ├── index.html              # Entry point
│   ├── src/
│   │   ├── App.jsx             # Root component + tab routing
│   │   ├── components/
│   │   │   ├── Header.jsx
│   │   │   ├── NavTabs.jsx
│   │   │   ├── LiveDetection.jsx    # Webcam + MediaPipe live module
│   │   │   ├── VideoAnalysis.jsx    # Upload + frame analysis
│   │   │   ├── AthleteProfile.jsx   # Stats, BMI, body type
│   │   │   ├── NutritionPlan.jsx    # Macros + meal cards
│   │   │   └── InjuryRisk.jsx       # Risk assessment panel
│   │   ├── constants/
│   │   │   └── sportPatterns.js     # Biomechanics thresholds per sport
│   │   ├── utils/
│   │   │   ├── poseAnalysis.js      # Angle calculation helpers
│   │   │   ├── scoring.js           # Score computation logic
│   │   │   └── sportDetector.js     # Movement → sport classifier
│   │   └── styles/
│   │       └── globals.css          # Design system variables + base styles
│   └── package.json
│
├── backend/
│   ├── server.js               # Express app entry
│   ├── routes/
│   │   ├── analysis.js         # POST /api/analyze
│   │   ├── upload.js           # POST /api/upload
│   │   └── profile.js          # CRUD /api/profile
│   ├── controllers/
│   │   ├── analysisController.js
│   │   └── profileController.js
│   ├── services/
│   │   ├── poseService.js       # MediaPipe or python bridge
│   │   ├── scoringService.js    # Biomechanics scoring engine
│   │   └── nutritionService.js  # Macro + diet recommendation engine
│   ├── middleware/
│   │   └── upload.js            # Multer config
│   ├── db/
│   │   └── schema.sql
│   └── package.json
│
└── docker-compose.yml
```

---

## Getting Started

### Prerequisites

- Node.js ≥ 18
- npm ≥ 9
- (Optional) Python 3.10+ with `mediapipe` for server-side analysis
- (Optional) FFmpeg installed globally for video frame extraction

### 1. Clone the Repository

```bash
git clone https://github.com/your-org/sxa.git
cd sxa
```

### 2. Install Dependencies

```bash
# Frontend
cd frontend && npm install

# Backend
cd ../backend && npm install
```

### 3. Configure Environment

Create `backend/.env`:

```env
PORT=4000
NODE_ENV=development
UPLOAD_DIR=./uploads
MAX_FILE_SIZE_MB=100
DB_PATH=./db/sxa.sqlite
# Optional: Python pose service
PYTHON_POSE_SERVICE_URL=http://localhost:5001
```

### 4. Run Development Servers

```bash
# Terminal 1 — Backend
cd backend && npm run dev

# Terminal 2 — Frontend
cd frontend && npm run dev
```

Frontend runs at `http://localhost:5173`, API at `http://localhost:4000`.

### 5. Single-File Mode (No Build Required)

The `sxa_with_live_detection.html` file is fully self-contained and runs directly in the browser — no server needed for the live detection feature (uses webcam + CDN-loaded MediaPipe).

```bash
# Just open in browser
open sxa_with_live_detection.html
```

---

## API Reference

### `POST /api/upload`
Upload a video file for analysis.

**Request:** `multipart/form-data`  
| Field | Type | Description |
|---|---|---|
| `video` | File | MP4 or MOV, max 100MB |
| `sport` | string | Sport key (e.g. `"sprinting"`) |
| `athleteId` | string (opt) | Link to saved athlete profile |

**Response:**
```json
{
  "sessionId": "abc123",
  "sport": "sprinting",
  "scores": {
    "form": 74,
    "power": 68,
    "consistency": 81,
    "balance": 72,
    "timing": 65
  },
  "overall": 72,
  "metrics": {
    "kneeAngle": 88,
    "hipAngle": 179,
    "armAngle": 92,
    "speedIndex": "3.8",
    "balance": 84
  },
  "insights": ["Arm drive is strong", "Heel striking detected — shift to midfoot"],
  "frameCount": 240
}
```

---

### `GET /api/profile/:id`
Fetch athlete profile.

### `POST /api/profile`
Create or update athlete profile.

```json
{
  "name": "Alex Johnson",
  "age": 24,
  "height": 178,
  "weight": 74,
  "sport": "sprinting",
  "level": "competitive"
}
```

---

## Supported Sports

| Key | Sport | Primary Metric |
|---|---|---|
| `sprinting` | Sprinting | Stride frequency |
| `long-jump` | Long Jump | Takeoff angle |
| `high-jump` | High Jump | Vertical power |
| `basketball` | Basketball Shooting | Release angle |
| `soccer` | Soccer Kicking | Follow-through |
| `tennis` | Tennis Serve | Rotation + arm swing |
| `running` | Distance Running | Form efficiency |
| `golf` | Golf Swing | Hip rotation |
| `yoga` | Yoga | Balance + hold |
| `jumping` | General Jumping | Power index |
| `swimming` | Swimming | Stroke symmetry |
| `cycling` | Cycling | Pedal efficiency |

---

## Scoring System

Each session is scored across 5 dimensions, each weighted per sport:

| Dimension | Description |
|---|---|
| **Form** | Joint angle alignment vs. optimal biomechanics |
| **Power** | Velocity and force output indicators |
| **Consistency** | Variance across repeated frames/motions |
| **Balance** | Center of mass stability |
| **Timing** | Phase synchronization and rhythm |

Scores are normalized to 0–100:
- **80–100**: 🏆 Elite Form
- **65–79**: ⭐ Good Technique
- **< 65**: 💪 Needs Work

---

## Injury Risk Assessment

Risk levels are calculated from:
- Joint angle extremes (overextension flags)
- Asymmetry scores (left vs. right limb comparison)
- Movement velocity spikes
- Sport-specific injury patterns (e.g., ACL risk in soccer, shoulder strain in tennis)

Risk tiers: **High** (red) / **Medium** (amber) / **Low** (green)

---

## Live Detection — How It Works

1. User grants camera permission
2. MediaPipe Pose model loads from CDN (~4MB)
3. Each video frame is processed at ~15–30 FPS
4. 33 body landmarks are extracted per frame
5. Key joint angles are computed (knee, hip, elbow, shoulder)
6. Movement history is compared to sport pattern signatures
7. Scores and metrics update every 1.5 seconds

---

## Contributing

1. Fork the repo
2. Create your feature branch: `git checkout -b feature/my-feature`
3. Commit: `git commit -m 'Add my feature'`
4. Push: `git push origin feature/my-feature`
5. Open a Pull Request
