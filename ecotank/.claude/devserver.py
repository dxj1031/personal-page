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
"""

import base64
import http.server
import mimetypes
import pathlib
import sys

mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("text/javascript", ".mjs")

SHOT = pathlib.Path(__file__).with_name("shot.png")


class Handler(http.server.SimpleHTTPRequestHandler):
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
