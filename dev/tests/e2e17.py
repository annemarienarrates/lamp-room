from _env import *
import asyncio, subprocess, sys
from playwright.async_api import async_playwright
srv = subprocess.Popen([sys.executable,"-m","http.server","8617","-d",ROOT],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
U="http://localhost:8617/index.html?test"
async def main():
  async with async_playwright() as p:
    b = await p.chromium.launch(executable_path=CHROME, args=["--no-sandbox","--use-fake-device-for-media-stream","--use-fake-ui-for-media-stream"])
    ctx = await b.new_context(permissions=["microphone"], viewport={"width":1440,"height":900}); pg = await ctx.new_page()
    errs=[]; pg.on("pageerror", lambda e: errs.append(str(e)))
    await pg.goto(U+"#/import"); await pg.wait_for_timeout(800)
    await pg.set_input_files("#file",FIX+"/duet.docx"); await pg.wait_for_selector("#create")
    await pg.fill("#it","R Test"); await pg.click("#create"); await pg.wait_for_timeout(1200)
    bid = await pg.evaluate("Store.books[0].id")
    await pg.goto(U+f"#/booth/{bid}/0"); await pg.wait_for_timeout(1500)
    async def take(sec):
      await pg.keyboard.press("r"); await pg.wait_for_timeout(sec*1000); await pg.keyboard.press("s"); await pg.wait_for_timeout(900)
    clips = "JSON.stringify(Booth.state.audio.tracks.map(t=>t.clips.map(c=>[+c.at.toFixed(2),+(c.at+c.dur).toFixed(2)])))"
    await take(2); print("t1:", await pg.evaluate(clips))
    await pg.keyboard.press("Shift+T"); await pg.wait_for_timeout(400)
    await pg.evaluate("Booth._test.seek(0.5)")
    await take(2); print("R on track 2 (playhead at 0.5):", await pg.evaluate(clips), "track", await pg.evaluate("Booth.state.track"))
    await pg.keyboard.press("1"); await pg.wait_for_timeout(300)
    await take(2); print("R on track 1 after track 2:", await pg.evaluate(clips))
    await pg.evaluate("Booth._test.seek(1.0)"); await pg.keyboard.press("Shift+R"); await pg.wait_for_timeout(1500); await pg.keyboard.press("s"); await pg.wait_for_timeout(900)
    print("Shift+R punch at 1.0:", await pg.evaluate(clips))
    await take(1); print("R after punch:", await pg.evaluate(clips))
    print("ERRORS:", errs); await b.close()
asyncio.run(main()); srv.terminate()
