"""motionScripts - paste link in browser → mp3 (yt-dlp -t mp3) → transcript → JSON."""
import json
import os
import queue
import subprocess
import sys
import threading
import uuid
from datetime import datetime, timezone
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import unquote, urlparse

BASE_DIR = Path(__file__).resolve().parent
DOWNLOADS_DIR = BASE_DIR / "downloads"
JSON_FILE = BASE_DIR / "transcripts.json"
DIST_DIR = BASE_DIR / "viewer" / "dist"

MODEL_NAME = os.getenv("WHISPER_MODEL", "base")
BEAM_SIZE = int(os.getenv("WHISPER_BEAM", "1"))
CPU_THREADS = int(os.getenv("WHISPER_THREADS", str(os.cpu_count() or 4)))
WHISPER_LANG = os.getenv("WHISPER_LANG", "") or None
PORT = int(os.getenv("VIEWER_PORT", "8000"))

DOWNLOADS_DIR.mkdir(exist_ok=True)
if not JSON_FILE.exists():
    JSON_FILE.write_text("[]", encoding="utf-8")

JOBS: dict = {}
JOB_QUEUE: "queue.Queue[str]" = queue.Queue()
JSON_LOCK = threading.Lock()

# MIME types for static serving
MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".woff2": "font/woff2",
    ".woff": "font/woff",
    ".mp3": "audio/mpeg",
}


def set_job(job_id: str, **patch):
    job = JOBS.get(job_id)
    if not job:
        return
    job.update(patch)
    job["updated_at"] = datetime.now(timezone.utc).isoformat()


def download_mp3(url: str, job_id: str | None = None) -> Path:
    if job_id:
        set_job(job_id, status="downloading", message="downloading mp3 with yt-dlp…")
    cmd = [
        sys.executable, "-m", "yt_dlp",
        "-t", "mp3",
        "--no-playlist",
        "-o", str(DOWNLOADS_DIR / "%(title)s [%(id)s].%(ext)s"),
        "--print", "after_move:filepath",
        url,
    ]
    print(f"[job {job_id}] yt-dlp: {' '.join(cmd[2:])}")
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError((result.stderr or result.stdout).strip()[-2000:] or "yt-dlp failed")

    lines = [l.strip() for l in result.stdout.splitlines() if l.strip()]
    if not lines:
        raise RuntimeError("yt-dlp produced no output.")
    mp3_path = Path(lines[-1])
    if not mp3_path.exists():
        cands = sorted(DOWNLOADS_DIR.glob("*.mp3"), key=lambda p: p.stat().st_mtime, reverse=True)
        if not cands:
            raise FileNotFoundError(f"mp3 not found: {mp3_path}")
        mp3_path = cands[0]
    return mp3_path


_model = None


def get_model():
    global _model
    if _model is None:
        from faster_whisper import WhisperModel
        print(f"Loading whisper '{MODEL_NAME}' cpu int8 threads={CPU_THREADS}…")
        _model = WhisperModel(MODEL_NAME, device="cpu", compute_type="int8", cpu_threads=CPU_THREADS)
    return _model


def transcribe_mp3(mp3_path: Path, job_id: str | None = None) -> dict:
    if job_id:
        set_job(job_id, status="transcribing", message=f"transcribing {mp3_path.name}…")
    model = get_model()
    segments_iter, info = model.transcribe(
        str(mp3_path), language=WHISPER_LANG,
        beam_size=BEAM_SIZE, best_of=1, vad_filter=True,
    )
    segments = []
    for seg in segments_iter:
        segments.append({"start": round(seg.start, 2), "end": round(seg.end, 2), "text": seg.text.strip()})
    return {
        "language": info.language,
        "language_probability": round(info.language_probability, 4),
        "duration": round(info.duration, 2),
        "segments": segments,
        "full_text": " ".join(s["text"] for s in segments).strip(),
    }


def read_transcripts() -> list:
    with JSON_LOCK:
        try:
            data = json.loads(JSON_FILE.read_text(encoding="utf-8"))
            if not isinstance(data, list):
                return []
            for e in data:
                if isinstance(e.get("audio_file"), str):
                    e["audio_file"] = e["audio_file"].replace("\\", "/")
            return data
        except (json.JSONDecodeError, FileNotFoundError):
            return []


def append_to_json(entry: dict) -> int:
    with JSON_LOCK:
        try:
            data = json.loads(JSON_FILE.read_text(encoding="utf-8"))
            if not isinstance(data, list):
                data = []
        except (json.JSONDecodeError, FileNotFoundError):
            data = []
        data.append(entry)
        JSON_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        return len(data)


def worker_loop():
    while True:
        job_id = JOB_QUEUE.get()
        job = JOBS.get(job_id)
        if not job:
            continue
        try:
            mp3_path = download_mp3(job["url"], job_id)
            set_job(job_id, audio_file=str(mp3_path.relative_to(BASE_DIR)).replace("\\", "/"))
            result = transcribe_mp3(mp3_path, job_id)
            entry = {
                "url": job["url"],
                "audio_file": str(mp3_path.relative_to(BASE_DIR)).replace("\\", "/"),
                "model": f"faster-whisper:{MODEL_NAME}",
                "transcribed_at": datetime.now(timezone.utc).isoformat(),
                **result,
            }
            append_to_json(entry)
            set_job(job_id, status="done", message="done", entry=entry)
        except Exception as e:
            set_job(job_id, status="error", message=str(e)[:2000])
        finally:
            JOB_QUEUE.task_done()


class AppHandler(SimpleHTTPRequestHandler):
    def log_message(self, fmt, *args):
        sys.stdout.write("[web] " + fmt % args + "\n")

    def _send_json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _serve_file(self, file_path: Path, code=200):
        if not file_path.is_file():
            self.send_error(404)
            return
        ext = file_path.suffix.lower()
        ct = MIME.get(ext, "application/octet-stream")
        data = file_path.read_bytes()
        self.send_response(code)
        self.send_header("Content-Type", ct)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        path = urlparse(self.path).path

        # API routes
        if path == "/api/transcripts":
            return self._send_json(read_transcripts())
        if path == "/api/jobs":
            jobs = sorted(JOBS.values(), key=lambda j: j["created_at"], reverse=True)
            return self._send_json(jobs)

        # Downloads (audio files) — unquote handles %20 etc, normalize \ from old entries
        if path.startswith("/downloads/"):
            rel = unquote(path[len("/downloads/"):]).replace("\\", "/")
            # guard against traversal
            safe = (DOWNLOADS_DIR / rel).resolve()
            if not str(safe).startswith(str(DOWNLOADS_DIR.resolve())):
                self.send_error(403)
                return
            return self._serve_file(safe)

        # Static files from viewer/dist
        if path == "/":
            file_path = DIST_DIR / "index.html"
        else:
            file_path = DIST_DIR / path.lstrip("/")

        # SPA fallback: if file doesn't exist, serve index.html (for client-side routing)
        if not file_path.is_file():
            file_path = DIST_DIR / "index.html"

        self._serve_file(file_path)

    def do_POST(self):
        path = urlparse(self.path).path
        if path != "/api/add":
            return self._send_json({"error": "not found"}, 404)
        length = int(self.headers.get("Content-Length", 0))
        try:
            payload = json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError:
            return self._send_json({"error": "invalid json"}, 400)
        url = str(payload.get("url", "")).strip().strip("'\"")
        if not url or not (url.startswith("http://") or url.startswith("https://")):
            return self._send_json({"error": "provide a valid http(s) URL"}, 400)
        job_id = uuid.uuid4().hex[:8]
        JOBS[job_id] = {
            "id": job_id, "url": url, "status": "queued",
            "message": "queued", "audio_file": None, "entry": None,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        JOB_QUEUE.put(job_id)
        return self._send_json(JOBS[job_id], 202)


def ensure_dist():
    """Build the Preact app if viewer/dist doesn't exist."""
    if (DIST_DIR / "index.html").exists():
        print(f"UI built: {DIST_DIR}")
        return
    print("Building UI (first run)…")
    subprocess.run(
        [str(BASE_DIR / "viewer" / "node_modules" / ".bin" / "vite" if os.name != "nt" else ""), "build"],
        cwd=str(BASE_DIR / "viewer"),
        shell=(os.name == "nt"),
        check=True,
    )
    if not (DIST_DIR / "index.html").exists():
        print(f"WARNING: UI build missing at {DIST_DIR}. Run: cd viewer && npm run build")


def main():
    ensure_dist()
    threading.Thread(target=worker_loop, daemon=True, name="worker").start()
    port = PORT
    httpd = None
    for _ in range(20):
        try:
            httpd = ThreadingHTTPServer(("127.0.0.1", port), AppHandler)
            break
        except OSError:
            port += 1
    assert httpd is not None
    url = f"http://localhost:{port}/"
    print(f"\nmotionScripts live at {url}")
    print(f"UI:    {DIST_DIR}")
    print(f"Data:  {JSON_FILE}")
    print(f"Model: faster-whisper:{MODEL_NAME} beam={BEAM_SIZE}\n")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nBye.")


if __name__ == "__main__":
    main()
