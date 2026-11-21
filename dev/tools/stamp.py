# Version stamp: every local script and style in index.html (and the proof worker) gets ?v=<date-time>,
# so a refresh always loads the new code. Run before each commit:  python3 dev/tools/stamp.py
import os, re, time
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
v = time.strftime("%Y%m%d%H%M")
p = os.path.join(ROOT, "index.html"); s = open(p).read()
s = re.sub(r'((?:src|href)="(?:js|css)/[^"?]+\.(?:js|css))(?:\?v=\d+)?"', lambda m: m.group(1) + '?v=' + v + '"', s)
open(p, "w").write(s)
p = os.path.join(ROOT, "js", "proof.js"); s = open(p).read()
s = re.sub(r'"js/proof-worker\.js(?:\?v=\d+)?"', '"js/proof-worker.js?v=' + v + '"', s)
open(p, "w").write(s)
print("stamped", v)
