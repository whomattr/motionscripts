# motionScripts

Paste a link (Instagram, Twitter/X, YouTube, any URL yt-dlp supports) → download as MP3 → transcribe with Whisper → view transcripts in a clean web UI.

## Quick start

```bash
# 1. Clone
git clone https://github.com/yourname/motionScripts.git
cd motionScripts

# 2. Python venv + deps
python -m venv venv
venv\Scripts\activate          # Windows
# source venv/bin/activate    # macOS/Linux
pip install yt-dlp faster-whisper

# 3. Build the UI
cd viewer && npm install && npm run build && cd ..

# 4. Run
python main.py
```

Open **http://localhost:8000**

## Prerequisites

- **Python 3.10+**
- **Node.js 18+** (only for building the UI)
- **ffmpeg** (required by yt-dlp for MP3 conversion — [install ffmpeg](https://ffmpeg.org/download.html))

## How it works

1. Paste any URL into the web UI
2. `yt-dlp -t mp3` downloads and converts the audio
3. `faster-whisper` transcribes it (runs on CPU, first run downloads the model)
4. Transcript appears in the UI with timestamps, audio player, and searchable text
5. Everything is saved to `transcripts.json`

## Usage

```bash
python main.py
```

The server starts on **http://localhost:8000** and serves:
- The web UI (built Preact app)
- API at `/api/*`
- Audio files at `/downloads/*`

### API

| Endpoint | Method | Description |
|---|---|---|
| `/api/add` | POST | `{"url": "https://…"}` — queue a new transcription |
| `/api/jobs` | GET | Current queue status |
| `/api/transcripts` | GET | All transcripts as JSON array |

## Configuration

Environment variables (all optional):

| Variable | Default | Description |
|---|---|---|
| `VIEWER_PORT` | `8000` | Server port |
| `WHISPER_MODEL` | `base` | Whisper model size: `tiny`, `base`, `small`, `medium` |
| `WHISPER_BEAM` | `1` | Beam size (1 = greedy/fast, 5 = better quality) |
| `WHISPER_LANG` | auto | Force language (e.g. `en`) to skip detection |
| `WHISPER_THREADS` | CPU count | Number of CPU threads |

```bash
# Example: use small model for better punctuation
WHISPER_MODEL=small WHISPER_BEAM=1 python main.py
```

## Development

For UI development with hot reload:

```bash
# Terminal 1: Python backend
python main.py

# Terminal 2: Vite dev server (proxies API to backend)
cd viewer
npm install
npm run dev
```

Open **http://localhost:5173** — changes hot-reload automatically.

## Project structure

```
motionScripts/
├── main.py              # Python backend (server + yt-dlp + whisper)
├── transcripts.json     # All transcripts (auto-created)
├── downloads/           # Downloaded MP3s (auto-created)
└── viewer/              # Preact + Tailwind UI
    ├── src/
    │   ├── main.jsx     # Entry point
    │   ├── app.jsx      # All components
    │   └── index.css    # Tailwind imports
    ├── dist/            # Built output (served by main.py)
    └── package.json
```

## License

MIT
