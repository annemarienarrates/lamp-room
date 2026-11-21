# Problem log: errors and failed messages are kept quietly, shown in Settings, and copied for Claude.
from _env import *
import asyncio, subprocess, sys
from playwright.async_api import async_playwright
srv = subprocess.Popen([sys.executable,"-m","http.server","8640","-d",ROOT],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
U="http://localhost:8640/index.html?test"
async def main():
  async with async_playwright() as p:
    b = await p.chromium.launch(executable_path=CHROME, args=["--no-sandbox"])
    ctx = await b.new_context(viewport={"width":1440,"height":900}); await ctx.grant_permissions(["clipboard-read","clipboard-write"])
    pg = await ctx.new_page()
    errs=[]; pg.on("pageerror", lambda e: errs.append(str(e)))
    await pg.goto(U+"#/settings"); await pg.wait_for_selector("#plCopy")
    ERR=[]
    if await pg.evaluate("LRProblems.read().length")!=0: ERR.append("log not empty at start")
    if "Nothing logged" not in await pg.inner_text("#plCount"): ERR.append("empty text missing")
    await pg.evaluate("toast(\"Couldn't save that chapter\"); toast('All saved.'); setTimeout(()=>{throw new Error('boom test')},0); setTimeout(()=>Promise.reject(new Error('rejected test')),0); 1")
    await pg.wait_for_timeout(400)
    L = await pg.evaluate("LRProblems.read()")
    kinds=[x["kind"]+":"+x["msg"][:30] for x in L]; print("logged:", kinds)
    if len(L)!=3: ERR.append("expected 3 entries, got %d"%len(L))
    if any("All saved" in x["msg"] for x in L): ERR.append("logged a happy message")
    if await pg.evaluate("!!document.querySelector('.dot,.badge-dot,[data-problem-dot]')"): ERR.append("a dot appeared")
    await pg.goto(U+"#/"); await pg.goto(U+"#/settings"); await pg.wait_for_selector("#plCopy")
    print("count:", await pg.inner_text("#plCount"))
    await pg.click("#plCopy"); await pg.wait_for_timeout(200)
    clip = await pg.evaluate("navigator.clipboard.readText()"); print(clip[:300])
    if "boom test" not in clip or "Lamp Room problem log" not in clip: ERR.append("copy text wrong")
    await pg.click("#plClear"); await pg.wait_for_timeout(100)
    if await pg.evaluate("LRProblems.read().length")!=0: ERR.append("clear failed")
    if await pg.evaluate("!!(window.Booth && Booth._test)")==False: ERR.append("test hooks missing in ?test")
    pg2 = await ctx.new_page(); await pg2.goto("http://localhost:8640/index.html#/"); await pg2.wait_for_timeout(600)
    if await pg2.evaluate("!!(window.Booth && Booth._test)"): ERR.append("test hooks exposed outside ?test")
    print("ERR:", ERR); print("ERRORS:", [e for e in errs if "boom test" not in e and "rejected test" not in e]); await b.close()
asyncio.run(main()); srv.terminate()
