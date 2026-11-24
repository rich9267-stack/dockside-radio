# /// script
# requires-python = ">=3.10,<3.13"
# dependencies = ["kokoro-onnx==0.6.1"]
# ///
"""
Dockside Radio voice server.

Runs Kokoro (an open-source voice model) on this PC and turns DJ intro text into
spoken audio for the Dockside Radio DJ script on Richard's iPhone.

  GET  /health  -> {"ok": true, "voices": [...]}   (quick check that it's running)
  GET  /        -> a small test page: type a line, pick a voice, hear it
  POST /speak   -> body {"text": "...", "voice": "am_michael", "speed": 1.0}
                   reply {"audio": "<base64 WAV>", "seconds": 4.2, "took": 0.8}

Started by start-voice.bat. Listens on port 8765 on your home network.
"""
import base64
import io
import json
import socket
import sys
import threading
import time
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import numpy as np
from kokoro_onnx import Kokoro

HERE = Path(__file__).resolve().parent
MODEL = HERE / "kokoro-v1.0.onnx"
VOICES = HERE / "voices-v1.0.bin"
PORT = 8765
MAX_CHARS = 600

if "--setup-only" in sys.argv:  # used by the installer: just prove everything imports
    print("Voice engine installed.")
    sys.exit(0)

if not MODEL.exists() or not VOICES.exists():
    print("Voice files are missing. Run INSTALL.bat again.")
    input("Press Enter to close...")
    sys.exit(1)

print("Loading the Kokoro voice model...")
t0 = time.time()
kokoro = Kokoro(str(MODEL), str(VOICES))
ALL_VOICES = sorted(kokoro.get_voices())
lock = threading.Lock()  # one voice at a time keeps the PC responsive
print(f"Loaded in {time.time() - t0:.1f} s. {len(ALL_VOICES)} voices available.")


def make_wav(text: str, voice: str, speed: float) -> tuple[bytes, float]:
    lang = "en-gb" if voice.startswith(("bf_", "bm_")) else "en-us"
    with lock:
        samples, rate = kokoro.create(text, voice=voice, speed=speed, lang=lang)
    pcm = (np.clip(samples, -1.0, 1.0) * 32767).astype("<i2").tobytes()
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm)
    return buf.getvalue(), len(samples) / rate


TEST_PAGE = """<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Dockside Voice Server</title>
<style>
body{font:16px system-ui,sans-serif;background:#0d1517;color:#e8f0ef;margin:0;padding:20px 16px}
main{max-width:520px;margin:0 auto;display:grid;gap:12px}
h1{font-size:1.3rem;margin:0}select,textarea,button{font:16px system-ui;border-radius:10px;padding:12px;width:100%;box-sizing:border-box}
select,textarea{background:#142226;color:#e8f0ef;border:1px solid #23383d}textarea{min-height:90px}
button{background:#f2a541;color:#1b1206;border:0;font-weight:700}p{color:#8fa5a6;margin:0}
</style></head><body><main>
<h1>Dockside Voice Server is running</h1>
<p>Type a line, pick a voice, tap Speak.</p>
<select id="v">__OPTIONS__</select>
<textarea id="t">This is Big Mike on Dockside Radio Classic Rock. Here's Tom Petty with Free Fallin.</textarea>
<button id="b">Speak</button><p id="s"></p><audio id="a" playsinline></audio>
<script>
const a=document.getElementById('a'),s=document.getElementById('s');
document.getElementById('b').onclick=async()=>{
 s.textContent='Making the voice...';
 const r=await fetch('/speak',{method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify({text:document.getElementById('t').value,voice:document.getElementById('v').value})});
 const j=await r.json(); if(!r.ok){s.textContent=j.error||'Error';return;}
 a.src='data:audio/wav;base64,'+j.audio; a.play();
 s.textContent='Made '+j.seconds.toFixed(1)+' s of speech in '+j.took.toFixed(1)+' s.';
};
</script></main></body></html>"""


class Handler(BaseHTTPRequestHandler):
    def _send(self, code: int, body: bytes, ctype: str = "application/json"):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "content-type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Private-Network", "true")
        self.end_headers()
        self.wfile.write(body)

    def _json(self, code: int, obj):
        self._send(code, json.dumps(obj).encode())

    def do_OPTIONS(self):
        self._send(204, b"")

    def do_GET(self):
        if self.path.startswith("/health"):
            return self._json(200, {"ok": True, "voices": ALL_VOICES})
        if self.path in ("/", "/index.html"):
            opts = "".join(f'<option value="{v}">{v}</option>' for v in ALL_VOICES)
            return self._send(200, TEST_PAGE.replace("__OPTIONS__", opts).encode(), "text/html; charset=utf-8")
        self._json(404, {"error": "Not found"})

    def do_POST(self):
        if not self.path.startswith("/speak"):
            return self._json(404, {"error": "Not found"})
        try:
            n = int(self.headers.get("Content-Length") or 0)
            data = json.loads(self.rfile.read(min(n, 20000)) or b"{}")
            text = str(data.get("text", "")).strip()[:MAX_CHARS]
            voice = str(data.get("voice", "am_michael"))
            speed = float(data.get("speed", 1.0))
            if not text:
                return self._json(400, {"error": "No text"})
            if voice not in ALL_VOICES:
                return self._json(400, {"error": f"Unknown voice {voice}"})
            speed = max(0.6, min(1.5, speed))
            t0 = time.time()
            wav, secs = make_wav(text, voice, speed)
            took = time.time() - t0
            print(f"{voice}: {secs:.1f} s of speech in {took:.1f} s  |  {text[:60]}")
            self._json(200, {"audio": base64.b64encode(wav).decode(), "seconds": secs, "took": took})
        except Exception as e:  # keep the server alive no matter what
            print("Error:", e)
            self._json(500, {"error": str(e)})

    def log_message(self, *args):  # quiet the default per-request log lines
        pass


def lan_ips() -> list[str]:
    ips = set()
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ips.add(s.getsockname()[0])
        s.close()
    except OSError:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ip = info[4][0]
            if not ip.startswith("127."):
                ips.add(ip)
    except OSError:
        pass
    return sorted(ips)


if __name__ == "__main__":
    # Warm up so the first real intro isn't slow
    make_wav("Dockside Radio.", "am_michael", 1.0)
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print()
    print("=" * 60)
    print(" Dockside Voice Server is ON. Leave this window open.")
    print(" On your iPhone (same Wi-Fi), the voice server address is:")
    for ip in lan_ips():
        print(f"     http://{ip}:{PORT}")
    print("=" * 60)
    print()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
