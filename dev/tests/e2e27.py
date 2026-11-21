from _env import *
import asyncio, subprocess, sys
from playwright.async_api import async_playwright
srv = subprocess.Popen([sys.executable,"-m","http.server","8627","-d",ROOT],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
U="http://localhost:8627/index.html?test"
C = "Booth.state.audio.tracks.map((t,i)=>'T'+(i+1)+':'+t.clips.map(c=>'['+c.at.toFixed(2)+'–'+(c.at+c.dur).toFixed(2)+']').join('')).join('  ')"
async def main():
  async with async_playwright() as p:
    b = await p.chromium.launch(executable_path=CHROME, args=["--no-sandbox","--use-fake-device-for-media-stream","--use-fake-ui-for-media-stream","--autoplay-policy=no-user-gesture-required"])
    ctx = await b.new_context(permissions=["microphone"], viewport={"width":1440,"height":900}); pg = await ctx.new_page()
    errs=[]; pg.on("pageerror", lambda e: errs.append(str(e))); pg.on("console", lambda m: m.type=="error" and errs.append("console:"+m.text))
    await pg.goto(U+"#/import"); await pg.wait_for_timeout(500)
    await pg.set_input_files("#file",FIX+"/sample.docx"); await pg.wait_for_selector("#create")
    await pg.fill("#it","PK"); await pg.click("#create"); await pg.wait_for_selector("table.ch"); await pg.wait_for_function("Store.books.length>0")
    bid = await pg.evaluate("Store.books[0].id")
    await pg.goto(U+f"#/booth/{bid}/1"); await pg.wait_for_selector("#booth-dock"); await pg.wait_for_timeout(1000)
    # two tracks: record 6 s on track 2 (so the original is NOT on the selected track 1)
    await pg.evaluate("Booth._test.act('addTrack')"); await pg.wait_for_timeout(200)
    await pg.evaluate("Booth.state.track=1; Booth.state.prerollSec=0"); await pg.keyboard.press("r"); await pg.wait_for_timeout(6000); await pg.keyboard.press("s"); await pg.wait_for_timeout(800)
    await pg.evaluate("(()=>{const B=Booth.state; B.audio.anchors=[[0.2,0],[1.5,8],[3.0,16],[4.5,24],[5.6,32]]; B.audio.markers.push({id:'m1',t:3.4,w:18,note:'Flub',ctx:'x'}); B.audio.markers.push({id:'m2',t:5.0,w:27,note:'Proof',proof:{text:'Hikaru',from:27,to:27},ctx:'y'}); B.audio.markers.push({id:'old',t:1,done:true}); B.track=0; })()")
    await pg.evaluate("Booth.state.side=null; Booth.state.tab='pickups'; Booth._test.act('tools')"); await pg.wait_for_timeout(300)
    print("layout:", await pg.evaluate(C), "| zone m1:", await pg.evaluate("JSON.stringify(Booth._test.pkZone(Booth.state.audio.markers.find(m=>m.id==='m1')))"))
    print("red words:", await pg.evaluate("[...document.querySelectorAll('#ms .w.pk')].length"))
    await pg.screenshot(path=SHOTS+"/pk-zone.png")
    await pg.click("[data-p='pgo:m1']"); await pg.wait_for_timeout(300); print("playing in context:", await pg.evaluate("[Booth.state.player.playing, Booth.state.player.time.toFixed(2)]"))
    await pg.wait_for_timeout(3000)
    L0 = await pg.evaluate("Booth._test.len()")
    await pg.click("[data-p='pfix:m1']"); await pg.wait_for_timeout(300)
    print("fix records on track:", await pg.evaluate("Booth.state.rec && Booth.state.rec.track"))
    await pg.wait_for_timeout(1200); await pg.keyboard.press("s"); await pg.wait_for_timeout(1200)
    print("after fix:", await pg.evaluate(C), "| len", round(L0,2), "→", round(await pg.evaluate("Booth._test.len()"),2))
    print("markers left:", await pg.evaluate("JSON.stringify(Booth.state.audio.markers.map(m=>m.id))"))
    await pg.evaluate("Booth.state.side=null; Booth.state.tab='pickups'; Booth._test.act('tools')"); await pg.wait_for_timeout(300)
    await pg.click("[data-p='pign:m2']"); await pg.wait_for_timeout(300)
    print("after ignore:", await pg.evaluate("JSON.stringify(Booth.state.audio.markers.map(m=>m.id))"), "| my ignore list:", await pg.evaluate("JSON.stringify(Store.settings.proofIgnore)"))
    print("ERRORS:", errs); await b.close()
asyncio.run(main()); srv.terminate()
