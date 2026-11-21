# Runs every browser test and says which passed. Each test opens the Lamp Room in a hidden Chrome,
# on made-up books, and prints what it checked; a test fails if the page threw an error or the script crashed.
#   python3 dev/run_all.py            all tests, four at a time
#   python3 dev/run_all.py e2e30 e2e33  just those
import os, re, subprocess, sys, time
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
TESTS = os.path.join(HERE, "tests")
if not os.path.exists(os.path.join(HERE, "fixtures", "ch01.wav")):
    subprocess.run([sys.executable, "make_fixtures.py"], cwd=os.path.join(HERE, "fixtures"), check=True)

# the app loads js/booth.js, joined from js/booth/*.js; testing a stale join would test old code
if subprocess.run([sys.executable, os.path.join(HERE, "tools", "build_booth.py"), "--check"]).returncode:
    sys.exit("Stopped: build the Booth first (python3 dev/tools/build_booth.py).")

names = sys.argv[1:] or sorted((f[:-3] for f in os.listdir(TESTS) if re.match(r"e2e\d+\.py$", f)), key=lambda n: int(n[3:]))

def bad(out):
    if "Traceback" in out: return "crashed"
    for m in re.finditer(r"^(?:ERRORS?|ERR):?\s*(\[.*)$", out, re.M):
        if m.group(1).strip() != "[]": return "page errors: " + m.group(1)[:300]
    return None

def run(n):
    t = time.time()
    try:
        p = subprocess.run([sys.executable, n + ".py"], cwd=TESTS, capture_output=True, text=True, timeout=420)
        out = p.stdout + p.stderr
    except subprocess.TimeoutExpired:
        out = "Traceback: timed out"
    open(os.path.join("/tmp", "lr-" + n + ".log"), "w").write(out)
    return n, bad(out), round(time.time() - t)

with ThreadPoolExecutor(max_workers=int(os.environ.get("LR_JOBS", "4"))) as ex:
    results = list(ex.map(run, names))
# A test that fails in the crowd gets one more go on its own: several Chromes at once can starve a slow step.
for i, (n, why, secs) in enumerate(results):
    if why:
        n2, why2, secs2 = run(n)
        results[i] = (n, why2, secs + secs2, "passed on its own (busy machine)" if not why2 else None)
results = [r if len(r) == 4 else r + (None,) for r in results]
fails = [r for r in results if r[1]]
for n, why, secs, note in results: print(("FAIL " if why else "ok   ") + n.ljust(7), str(secs).rjust(4) + "s", why or note or "")
print(f"\n{len(results) - len(fails)} of {len(results)} passed. Full output of each test: /tmp/lr-<test>.log")
sys.exit(1 if fails else 0)
