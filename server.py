#!/usr/bin/env python3
"""
server.py
The Retro Cafeteria POS — Local Zero-Dependency Web Server
Binds locally on 127.0.0.1, auto-detects free ports, and opens the browser.
"""

import http.server
import socketserver
import webbrowser
import os
import sys
import json
import datetime
import subprocess

PORTS = [3000, 3001, 3002, 8080, 8000]

class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # Enable caching-control for development and CORS headers
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_POST(self):
        if self.path == '/api/backup':
            try:
                length = int(self.headers.get('Content-Length', 0))
                body = self.rfile.read(length)
                payload = json.loads(body.decode('utf-8'))
                
                # Destination folder chosen by user or default local 'backups' folder
                target_dir = payload.get('folder', '').strip()
                if not target_dir:
                    target_dir = os.path.join(os.getcwd(), 'backups')
                
                os.makedirs(target_dir, exist_ok=True)
                
                # Timestamped file: Retro_POS_Backup_YYYY-MM-DD_HH-MM-SS.json
                now_str = datetime.datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
                filename = f"Retro_POS_Backup_{now_str}.json"
                file_path = os.path.join(target_dir, filename)
                
                # Save snapshot
                state_data = payload.get('state', {})
                with open(file_path, 'w', encoding='utf-8') as f:
                    json.dump(state_data, f, indent=2)
                
                # Keep last 30 backups in this folder (rotate older ones)
                try:
                    all_backups = sorted([
                        os.path.join(target_dir, f) for f in os.listdir(target_dir)
                        if f.startswith("Retro_POS_Backup_") and f.endswith(".json")
                    ], key=os.path.getmtime)
                    if len(all_backups) > 30:
                        for old_file in all_backups[:-30]:
                            try:
                                os.remove(old_file)
                            except OSError:
                                pass
                except Exception:
                    pass

                response_data = {
                    "success": True,
                    "filename": filename,
                    "path": file_path,
                    "folder": target_dir,
                    "timestamp": now_str
                }
                
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps(response_data).encode('utf-8'))
                sys.stderr.write(f"[POS Automated Backup] Successfully saved: {file_path}\n")
            except Exception as e:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"success": False, "error": str(e)}).encode('utf-8'))
                sys.stderr.write(f"[POS Backup Error] {e}\n")
        elif self.path == '/api/print':
            try:
                length = int(self.headers.get('Content-Length', 0))
                body = self.rfile.read(length)
                payload = json.loads(body.decode('utf-8'))
                raw_text = payload.get('text', '')
                
                # Write receipt text to temp file
                temp_file = os.path.join(os.getcwd(), 'last_receipt.txt')
                with open(temp_file, 'w', encoding='utf-8') as f:
                    f.write(raw_text)

                # Attempt silent print to Windows default printer (Xprinter)
                printed = False
                if sys.platform == 'win32':
                    try:
                        # PowerShell Out-Printer sends to Windows default thermal printer
                        subprocess.run(
                            ['powershell', '-NoProfile', '-Command', f"Get-Content -Path '{temp_file}' -Raw | Out-Printer"],
                            timeout=5,
                            capture_output=True
                        )
                        printed = True
                    except Exception as err:
                        sys.stderr.write(f"[POS Print Warning] Windows Out-Printer error: {err}\n")

                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"success": True, "direct_printed": printed}).encode('utf-8'))
            except Exception as e:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"success": False, "error": str(e)}).encode('utf-8'))
        else:
            self.send_response(404)
            self.end_headers()

    def do_GET(self):
        if self.path == '/api/backup/status':
            target_dir = os.path.join(os.getcwd(), 'backups')
            count = 0
            latest = None
            if os.path.exists(target_dir):
                files = [f for f in os.listdir(target_dir) if f.startswith("Retro_POS_Backup_") and f.endswith(".json")]
                count = len(files)
                if files:
                    files.sort(key=lambda x: os.path.getmtime(os.path.join(target_dir, x)), reverse=True)
                    latest = files[0]
            
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({
                "default_folder": target_dir,
                "total_backups": count,
                "latest_backup": latest
            }).encode('utf-8'))
        else:
            super().do_GET()

    def log_message(self, format, *args):
        # Concise logging for production console
        sys.stderr.write(f"[POS Server] {self.address_string()} - {format % args}\n")

def run():
    # Change directory to the folder containing server.py
    dir_path = os.path.dirname(os.path.realpath(__file__))
    os.chdir(dir_path)

    httpd = None
    active_port = None

    for port in PORTS:
        try:
            http.server.ThreadingHTTPServer.allow_reuse_address = True
            httpd = http.server.ThreadingHTTPServer(("127.0.0.1", port), QuietHandler)
            active_port = port
            break
        except OSError:
            continue

    if not httpd or not active_port:
        print("Error: Could not bind to any standard port (3000, 3001, 8080).")
        sys.exit(1)

    url = f"http://127.0.0.1:{active_port}"
    print("=" * 60)
    print("  THE RETRO CAFETERIA — POS BILLING SOFTWARE (v3.0)")
    print(f"  Local Terminal Server Running at: {url}")
    print("  Press Ctrl+C to stop.")
    print("=" * 60)

    try:
        webbrowser.open(url)
    except Exception:
        pass

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping POS server. Goodbye!")
        httpd.server_close()
        sys.exit(0)

if __name__ == "__main__":
    run()
