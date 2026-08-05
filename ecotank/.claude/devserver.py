"""Dev-only static server for the EcoTank page.

Three jobs, none of them needed in production:

1. Force ``.js`` to ``text/javascript``. On Windows, ``mimetypes`` reads the
   registry, where ``.js`` is often ``text/plain``; module scripts are strictly
   MIME-checked and fail silently, so the 2D logic runs but the sphere never
   appears.
2. Send ``Cache-Control: no-store``, so editing a shader does not need a
   cache-busting query string to take effect.
3. Accept ``PUT /__shot`` with a base64 body and write it to ``shot.png``.
   The agent driving this page cannot screenshot a non-compositing tab, so the
   page hands its own rendered frame back over HTTP instead.
4. Serve ``/?anim=timer`` with a shim that drives the render loop off a timer.
   A hidden tab never gets ``requestAnimationFrame`` at all, so job 3 has
   nothing to hand back: the page boots, lays out, and then sits at frame 0.
"""

import base64
import http.server
import mimetypes
import pathlib
import sys

mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("text/javascript", ".mjs")

SHOT = pathlib.Path(__file__).with_name("shot.png")
INDEX = pathlib.Path(__file__).resolve().parents[1] / "index.html"

# Injected ahead of every other script, so the modules capture the shim rather
# than the real thing. The tick comes from a worker, not setTimeout: Chrome
# clamps timers in a hidden tab to 1/s and then to 1/min once it has been hidden
# for a few minutes, which stalls the page mid-verification. Workers are not
# throttled by tab visibility.
SHIM = (
    b"<script>(function(){"
    b"var q=[],n=1,t=0;"
    b"var w=new Worker(URL.createObjectURL(new Blob("
    b"['setInterval(function(){postMessage(0)},16)'],{type:'text/javascript'})));"
    b"w.onmessage=function(){var b=q;q=[];t+=16;"
    b"for(var i=0;i<b.length;i++){if(b[i])try{b[i][1](t)}catch(e){console.error(e)}}};"
    b"window.requestAnimationFrame=function(cb){q.push([n,cb]);return n++;};"
    b"window.cancelAnimationFrame=function(id){"
    b"for(var i=0;i<q.length;i++)if(q[i]&&q[i][0]===id)q[i]=null;};"
    b"})();</script>"
)


class Handler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        path, _, query = self.path.partition("?")
        if "anim=timer" in query and path in ("/", "/index.html"):
            body = INDEX.read_bytes().replace(b"<head>", b"<head>" + SHIM, 1)
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, max-age=0")
        super().end_headers()

    def do_PUT(self):
        if self.path != "/__shot":
            self.send_error(404)
            return
        n = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(n)
        try:
            SHOT.write_bytes(base64.b64decode(body, validate=True))
        except Exception as exc:  # noqa: BLE001 - dev tool, report and move on
            self.send_error(400, str(exc))
            return
        self.send_response(204)
        self.end_headers()

    def log_message(self, fmt, *args):
        if self.path != "/__shot":
            super().log_message(fmt, *args)


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8127
    http.server.test(HandlerClass=Handler, port=port)
