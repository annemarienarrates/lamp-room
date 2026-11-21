from _env import *
import asyncio, subprocess, sys, json
from playwright.async_api import async_playwright
srv = subprocess.Popen([sys.executable,"-m","http.server","8611","-d",ROOT],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
U="http://localhost:8611/index.html?test"
C = "Booth.state.audio.tracks.map((t,i)=>'T'+(i+1)+'('+(Booth.state.book.trackSet[Booth.state.readingAs][i]||{}).name+'):'+t.clips.map(c=>'['+c.at.toFixed(1)+'–'+(c.at+c.dur).toFixed(1)+(c.line?' L'+c.line.from:'')+']').join(''))"
async def main():
  async with async_playwright() as p:
    b = await p.chromium.launch(executable_path=CHROME, args=["--no-sandbox","--use-fake-device-for-media-stream","--use-fake-ui-for-media-stream","--autoplay-policy=no-user-gesture-required"])
    ctx = await b.new_context(permissions=["microphone"], viewport={"width":1440,"height":900}); pg = await ctx.new_page()
    errs=[]; pg.on("pageerror", lambda e: errs.append(str(e))); pg.on("console", lambda m: m.type=="error" and errs.append("console:"+m.text))
    await pg.goto(U+"#/import"); await pg.wait_for_timeout(600)
    await pg.set_input_files("#file",FIX+"/duet.docx"); await pg.wait_for_selector("#create")
    await pg.fill("#it","Duet Test"); await pg.click("#create"); await pg.wait_for_selector("table.ch"); await pg.wait_for_function("Store.books.length>0"); await pg.wait_for_timeout(300)
    await pg.evaluate("(()=>{const b=Store.books[0]; b.parts=Object.assign({}, b.parts, {n:'Anne', f:'Anne', m:'Jack'}); Store.settings.narrators=[{name:'Anne',pace:4035},{name:'Jack',pace:2000}]; Store.saveBook(b);})()")
    bid = await pg.evaluate("Store.books[0].id")
    # ---- Jack records his lines ----
    await pg.evaluate("localStorage.setItem('lr-me','Jack')")
    await pg.goto(U+f"#/booth/{bid}/0"); await pg.wait_for_selector("#booth-dock"); await pg.wait_for_timeout(600)
    if await pg.evaluate("Booth.state.readingAs") != "Jack": await pg.evaluate("Booth._test && 0"); 
    print("reading as:", await pg.evaluate("Booth.state.readingAs"), "| lead?", await pg.evaluate("Booth._test.amLead()"))
    runs = await pg.evaluate("Booth._test.myRuns().map(x=>[x.from,x.to,x.text.slice(0,30)])"); print("Jack's runs:", runs)
    await pg.evaluate("Booth.state.prerollSec=0"); await pg.keyboard.press("r"); await pg.wait_for_timeout(1200*len(runs)+1500); await pg.keyboard.press("s"); await pg.wait_for_timeout(800)
    # word timing as if follow-along had heard each run: run k spoken around 0.3+1.2k .. +0.6
    await pg.evaluate("(()=>{const rs=Booth._test.myRuns(); Booth.state.audio.anchors=[]; rs.forEach((x,k)=>{const t0=0.35+1.2*k; Booth.state.audio.anchors.push([t0+0.15, x.from+1]); Booth.state.audio.anchors.push([t0+0.6, x.to+1]);});})()")
    await pg.evaluate("Booth.state.side=null; Booth.state.tab='duet'; Booth._test.act('tools')")
    await pg.evaluate("Booth._test.sendLines()"); await pg.wait_for_function("!Booth.state.busy", timeout=60000); await pg.wait_for_timeout(500)
    print("sent:", await pg.evaluate("JSON.stringify(Booth.state.sent)"))
    await pg.screenshot(path=SHOTS+"/d-send.png")
    # ---- Anne leads ----
    await pg.evaluate("localStorage.setItem('lr-me','Anne')")
    await pg.goto(U+"#/library"); await pg.wait_for_timeout(300)
    await pg.goto(U+f"#/booth/{bid}/0"); await pg.wait_for_selector("#booth-dock"); await pg.wait_for_timeout(1800)
    print("reading as:", await pg.evaluate("Booth.state.readingAs"), "| lead?", await pg.evaluate("Booth._test.amLead()"))
    print("their runs:", await pg.evaluate("Booth._test.theirRuns().length"), "| arrived:", await pg.evaluate("JSON.stringify(Object.fromEntries(Object.entries(Booth.state.audio.duet||{}).map(([k,v])=>[k,v.lines.map(l=>[l.from,+l.dur.toFixed(2)])])))"))
    # record: simulate reading up to the first Jack run, go quiet → auto-place
    await pg.evaluate("Booth.state.prerollSec=0"); await pg.keyboard.press("r"); await pg.wait_for_timeout(1000)
    r0 = await pg.evaluate("Booth._test.theirRuns()[0].from")
    await pg.evaluate(f"(()=>{{Booth.state.f.set({r0}); Booth.state.f.pos={r0}+0; const tr=Booth._test.theirRuns()[0]; Booth.state.f.set(tr.to+1); Booth.state.rec.loud=Booth.state.rec.clip.at+Booth.state.rec.clip.dur-0.6;}})()")
    await pg.wait_for_timeout(500)
    print("auto-placed:", await pg.evaluate(C), "| banner:", await pg.evaluate("(document.querySelector('#duet-banner')||{}).textContent"))
    await pg.screenshot(path=SHOTS+"/d-live.png")
    await pg.wait_for_timeout(1500)
    # C for the second run
    await pg.keyboard.press("c"); await pg.wait_for_timeout(400)
    print("after C:", await pg.evaluate(C))
    await pg.wait_for_timeout(1500); await pg.keyboard.press("s"); await pg.wait_for_timeout(800)
    print("after stop:", await pg.evaluate(C))
    # splice the rest: give Anne word timing for runs 3-12 as if follow-along had heard her
    await pg.evaluate("(()=>{const rs=Booth._test.theirRuns(); rs.slice(2).forEach((x,k)=>Booth.state.audio.anchors.push([3.9+0.1*k, x.from+1]));  Booth.state.audio.anchors.sort((a,b)=>a[0]-b[0]);})()")
    await pg.evaluate("Booth._test.spliceAll()"); await pg.wait_for_function("!Booth.state.busy", timeout=60000); await pg.wait_for_timeout(300)
    print("splice all:", await pg.evaluate(C))
    await pg.evaluate("Booth.state.side=null; Booth.state.tab='duet'; Booth._test.act('tools')")
    await pg.wait_for_timeout(300); await pg.screenshot(path=SHOTS+"/d-panel.png")
    # celebrations
    await pg.evaluate("LRCele.comboWords(950)"); await pg.wait_for_timeout(700); await pg.screenshot(path=SHOTS+"/c-combo.png")
    print("combo tier:", await pg.evaluate("LRCele.state.tier"), await pg.evaluate("(document.querySelector('#combo-box')||{}).textContent"))
    await pg.wait_for_timeout(2500)
    await pg.evaluate("LRCele.celebrate({title:'CHAPTER DONE', sub:'Chapter 1 · 1,062 words in 16m', level:2})"); await pg.wait_for_timeout(900); await pg.screenshot(path=SHOTS+"/c-chap.png")
    await pg.wait_for_timeout(3000)
    await pg.evaluate("LRCele.celebrate({title:'BOOK RECORDED', sub:'Every one of your lines. Go outside. Briefly.', level:3})"); await pg.wait_for_timeout(1300); await pg.screenshot(path=SHOTS+"/c-book.png")
    # queued while recording
    await pg.wait_for_timeout(4500); await pg.keyboard.press("r"); await pg.wait_for_timeout(300)
    await pg.evaluate("LRCele.celebrate({title:'DAILY WORDS: DONE', level:2})"); await pg.wait_for_timeout(300)
    q = await pg.evaluate("!!document.querySelector('#cele-words')"); await pg.keyboard.press("s"); await pg.wait_for_timeout(1500)
    print("held while recording:", not q, "| shown after stop:", await pg.evaluate("!!document.querySelector('#cele-words')"))
    print("ERRORS:", errs); await b.close()
asyncio.run(main()); srv.terminate()
