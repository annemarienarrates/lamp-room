# Shared settings for the browser tests. Paths are worked out from this file, so the tests run from anywhere.
import os
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))   # the repo
FIX = os.path.join(ROOT, "dev", "fixtures")                                          # made-up books and audio
SHOTS = os.environ.get("LR_SHOTS", "/tmp/lr-shots"); os.makedirs(SHOTS, exist_ok=True)  # screenshots, not kept
CHROME = os.environ.get("LR_CHROME", "/usr/bin/google-chrome")                        # any Chrome or Chromium
