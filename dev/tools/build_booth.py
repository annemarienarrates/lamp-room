# Joins js/booth/*.js, in name order, into js/booth.js (the file the app loads). Run after editing any part;
# stamp.py runs it for you. Each part's opening comment is dropped from the joined file, which starts with a banner.
#   python3 dev/tools/build_booth.py           build
#   python3 dev/tools/build_booth.py --check   exit 1 if js/booth.js isn't up to date with the parts
import glob, os, re, sys
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
BANNER = "/* GENERATED from js/booth/*.js by dev/tools/build_booth.py. Don't edit this file: edit the parts. */\n"
def build():
    out = [BANNER]
    for f in sorted(glob.glob(os.path.join(ROOT, "js", "booth", "*.js"))):
        t = open(f).read()
        out.append(re.sub(r"\A/\* booth/.*?\*/\n", "", t, count=1, flags=re.S))
    return "".join(out)
target = os.path.join(ROOT, "js", "booth.js")
text = build()
if "--check" in sys.argv:
    ok = os.path.exists(target) and open(target).read() == text
    print("js/booth.js is up to date" if ok else "js/booth.js is out of date: run python3 dev/tools/build_booth.py")
    sys.exit(0 if ok else 1)
open(target, "w").write(text); print("built js/booth.js from", len(glob.glob(os.path.join(ROOT, "js", "booth", "*.js"))), "parts")
