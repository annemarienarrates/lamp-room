# Planner note reading without AI: "Read my note" uses the word-matcher on this computer and shows a preview.
# Client suggestions come from the titles, not from names in the code.
from _env import *
import asyncio, subprocess, sys
from playwright.async_api import async_playwright
srv = subprocess.Popen([sys.executable,"-m","http.server","8641","-d",ROOT],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
U="http://localhost:8641/index.html?test"
async def main():
  async with async_playwright() as p:
    b = await p.chromium.launch(executable_path=CHROME, args=["--no-sandbox"])
    pg = await (await b.new_context(viewport={"width":1440,"height":900})).new_page()
    errs=[]; pg.on("pageerror", lambda e: errs.append(str(e)))
    await pg.goto(U+"#/log"); await pg.wait_for_selector("#qlog", timeout=15000)
    ERR=[]
    await pg.fill("#qlog","Recorded for 2 hours this afternoon and edited one hour.")
    await pg.click("[data-act='read-log']"); await pg.wait_for_timeout(800)
    txt = await pg.evaluate("document.body.innerText")
    print("preview:", [l for l in txt.split("\n") if "word-matcher" in l or "hour" in l.lower()][:6])
    if "word-matcher" not in txt: ERR.append("no word-matcher note in preview")
    if "Claude" in txt: ERR.append("still mentions Claude")
    if "couldn't read" in txt.lower(): ERR.append("reader failed")
    opts = await pg.evaluate("[...document.querySelectorAll('#clients option')].map(o=>o.value)")
    print("client options:", opts)
    if "Pivot Press" in opts or "Royal Guard" in opts: ERR.append("hard-coded client names")
    print("ERR:", ERR); print("ERRORS:", errs); await b.close()
asyncio.run(main()); srv.terminate()
