from _env import *
import asyncio, subprocess, sys
from playwright.async_api import async_playwright
srv = subprocess.Popen([sys.executable,"-m","http.server","8616","-d",ROOT],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
U="http://localhost:8616/index.html?test"
async def main():
  async with async_playwright() as p:
    b = await p.chromium.launch(executable_path=CHROME, args=["--no-sandbox","--use-fake-device-for-media-stream","--use-fake-ui-for-media-stream"])
    ctx = await b.new_context(permissions=["microphone"], viewport={"width":1440,"height":900}); pg = await ctx.new_page()
    errs=[]; pg.on("pageerror", lambda e: errs.append(str(e)))
    await pg.goto(U+"#/import"); await pg.wait_for_timeout(800)
    await pg.set_input_files("#file",FIX+"/duet.docx"); await pg.wait_for_selector("#create")
    await pg.fill("#it","Rec Test"); await pg.click("#create"); await pg.wait_for_timeout(1200)
    bid = await pg.evaluate("Store.books[0].id")
    await pg.goto(U+f"#/booth/{bid}/0"); await pg.wait_for_timeout(1500)
    await pg.evaluate("Booth.state.prerollSec=0")
    t = await pg.evaluate("performance.now()"); await pg.keyboard.press("r"); await pg.wait_for_timeout(8000); await pg.keyboard.press("s"); await pg.wait_for_timeout(1200)
    print("mic:", await pg.evaluate("JSON.stringify(Booth.state.mic.info)"))
    c = await pg.evaluate("(()=>{const c=Booth.state.audio.tracks[0].clips[0];return {dur:+c.dur.toFixed(3), file:c.file}})()")
    print("clip:", c)
    # read back the WAV: check the header and that the beep tone has no holes
    r = await pg.evaluate("""(async()=>{const d=await Store.chapterAudioDir(Booth.state.book,Booth.state.chap);const f=await (await d.getFileHandle('%s')).getFile();
      const h=await LRAudio.wavInfo(f); const x=await LRAudio.readPCM(f,0,f.size/144000);
      let zeros=0,run=0,maxRun=0,pk=0; for(const v of x){const a=Math.abs(v); if(a>pk)pk=a; if(a<1e-6){run++;if(run>maxRun)maxRun=run}else run=0}
      return {rate:h.rate,bits:h.bits,secs:+(h.dataLen/3/h.rate).toFixed(3),peak:+pk.toFixed(3),longestSilentRunMs:+(maxRun/48).toFixed(1)}})()""" % c["file"])
    print("wav:", r)
    # playback runs and the clock moves
    await pg.keyboard.press("Home"); await pg.keyboard.press(" "); await pg.wait_for_timeout(1500)
    print("playing:", await pg.evaluate("Booth.state.player.playing"), "time:", await pg.evaluate("Booth.state.player.time"))
    await pg.keyboard.press("Escape")
    await pg.evaluate("Booth.state.side='tools';Booth.state.tab='mic'"); await pg.click("[data-s=tools]"); await pg.wait_for_timeout(300); await pg.select_option("[data-tab]","mic"); await pg.wait_for_timeout(300)
    print("mic tab:", await pg.evaluate("[...document.querySelectorAll('.bd-toolbody .stu-note')].map(e=>e.innerText).find(t=>t.includes('Capture'))"))
    print("ERRORS:", errs); await b.close()
asyncio.run(main()); srv.terminate()
