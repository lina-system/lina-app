# SPDX-License-Identifier: AGPL-3.0-only
"""Serves a folder on 127.0.0.1 with the cross-origin isolation headers GPUI's
web platform expects (COOP/COEP), and the wasm MIME type.

Usage: python3 serve.py <folder> <port>
"""

import functools
import http.server
import sys


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, ".wasm": "application/wasm"}

    def end_headers(self):
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


def main():
    folder, port = sys.argv[1], int(sys.argv[2])
    handler = functools.partial(Handler, directory=folder)
    with http.server.ThreadingHTTPServer(("127.0.0.1", port), handler) as server:
        print(f"serving {folder} on http://127.0.0.1:{port}/", flush=True)
        server.serve_forever()


if __name__ == "__main__":
    main()
