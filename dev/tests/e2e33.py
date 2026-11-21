from _env import *
import asyncio, subprocess, sys
from playwright.async_api import async_playwright
srv = subprocess.Popen([sys.executable,"-m","http.server","8633","-d",ROOT],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
U="http://localhost:8633/index.html?test"
C = "Booth.state.audio.tracks.map((t,i)=>'T'+(i+1)+'('+((Booth._test.trackSet()[i]||{}).name||'')+'):'+t.clips.map(c=>'['+c.at.toFixed(2)+'–'+(c.at+c.dur).toFixed(2)+(c.line?' L'+c.line.r:'')+']').join('')).join('  ')"
async def main():
  async with async_playwright() as p:
    b = await p.chromium.launch(executable_path=CHROME, args=["--no-sandbox","--use-fake-device-for-media-stream","--use-fake-ui-for-media-stream","--autoplay-policy=no-user-gesture-required"])
    ctx = await b.new_context(permissions=["microphone"], viewport={"width":1440,"height":900}); pg = await ctx.new_page()
    errs=[]; pg.on("pageerror", lambda e: errs.append(str(e))); pg.on("console", lambda m: m.type=="error" and errs.append("console:"+m.text))
    pg.on("dialog", lambda d: asyncio.ensure_future(d.accept()))
    SH = "Store.pickSharedFolder = async () => (await navigator.storage.getDirectory()).getDirectoryHandle('SharedBook', {create:true});"
    await pg.goto(U+"#/import"); await pg.wait_for_timeout(500); await pg.evaluate(SH)
    await pg.set_input_files("#file",FIX+"/duet.docx"); await pg.wait_for_selector("#create")
    await pg.fill("#it","Shared Duet"); await pg.click("#create"); await pg.wait_for_selector("table.ch"); await pg.wait_for_timeout(400)
    bid = await pg.evaluate("Store.books[0].id")
    await pg.evaluate("(()=>{const b=Store.books[0]; b.parts=Object.assign({}, b.parts, {n:'Anne', f:'Anne', m:'Jack'}); Store.settings.narrators=[{name:'Anne',pace:4035},{name:'Jack',pace:2000},{name:'Eddie',pace:1}]; Store.saveBook(b,true);})()")
    await pg.goto(U+"#/library"); await pg.goto(U+f"#/book/{bid}"); await pg.wait_for_timeout(600); await pg.evaluate(SH)
    await pg.evaluate("document.querySelector('#sharedc').open=true"); await pg.click("#shsetup"); await pg.wait_for_timeout(800)
    await pg.evaluate("document.querySelector('#sharedc').open=true"); await pg.wait_for_timeout(300)
    print("checkboxes:", await pg.evaluate("[...document.querySelectorAll('[data-shedit]')].map(i=>i.closest('.cast-row').querySelector('input').value)"))
    await pg.click("[data-shedit]"); await pg.wait_for_timeout(800)
    print("people:", await pg.evaluate("JSON.stringify(Store.books[0].sharedPeople)"), "| project.json:", await pg.evaluate("(async()=>{const d=await (await navigator.storage.getDirectory()).getDirectoryHandle('SharedBook'); const j=JSON.parse(await (await (await d.getFileHandle('project.json')).getFile()).text()); return j.title+' / '+j.people.length+' people / '+j.chapters.length+' ch'})()"))
    # Jack records his lines and sends them to Anne (existing duet flow); Anne records and splices; Anne sends to Shared
    await pg.evaluate("localStorage.setItem('lr-me','Jack')"); await pg.goto(U+"#/library"); await pg.wait_for_timeout(300)
    await pg.goto(U+f"#/booth/{bid}/0"); await pg.wait_for_selector("#booth-dock"); await pg.wait_for_timeout(800)
    n = await pg.evaluate("Booth._test.myRuns().length")
    await pg.evaluate("Booth.state.prerollSec=0"); await pg.keyboard.press("r"); await pg.wait_for_timeout(1200*n+1500); await pg.keyboard.press("s"); await pg.wait_for_timeout(800)
    await pg.evaluate("(()=>{const rs=Booth._test.myRuns(); Booth.state.audio.anchors=[]; rs.forEach((x,k)=>{const t0=0.35+1.2*k; Booth.state.audio.anchors.push([t0+0.15, x.from+1]); Booth.state.audio.anchors.push([t0+0.6, x.to+1]);});})()")
    await pg.evaluate("Booth._test.sendLines()"); await pg.wait_for_function("!Booth.state.busy", timeout=60000); await pg.wait_for_timeout(500)
    await pg.evaluate("localStorage.setItem('lr-me','Anne')"); await pg.goto(U+"#/library"); await pg.wait_for_timeout(300)
    await pg.goto(U+f"#/booth/{bid}/0"); await pg.wait_for_selector("#booth-dock"); await pg.wait_for_timeout(1500); await pg.evaluate(SH)
    await pg.evaluate("Booth.state.prerollSec=0"); await pg.keyboard.press("r"); await pg.wait_for_timeout(2500); await pg.keyboard.press("s"); await pg.wait_for_timeout(800)
    await pg.evaluate("Booth._test.spliceAll && Booth._test.spliceAll()"); await pg.wait_for_timeout(1500)
    print("Anne's chapter:", await pg.evaluate(C))
    await pg.evaluate("Booth.state.side=null; Booth.state.tab='shared'; Booth._test.act('tools')"); await pg.wait_for_timeout(800)
    print("shared tab:", await pg.evaluate("document.querySelector('#sh-body').innerText.replace(/\\n+/g,' | ')"))
    await pg.click("[data-p='shsend']"); await pg.wait_for_timeout(500); await pg.wait_for_function("!Booth.state.busy", timeout=60000); await pg.wait_for_timeout(500)
    print("sent:", await pg.evaluate("JSON.stringify(Booth.state.chap.sent)"))
    await pg.keyboard.press("r"); await pg.wait_for_timeout(400); print("locked (no recording):", await pg.evaluate("!Booth.state.rec"))
    # Jack sends his own read too
    await pg.evaluate("localStorage.setItem('lr-me','Jack')"); await pg.goto(U+"#/library"); await pg.wait_for_timeout(300)
    await pg.goto(U+f"#/booth/{bid}/0"); await pg.wait_for_selector("#booth-dock"); await pg.wait_for_timeout(1200)
    if not globals().get('_dlg'):
      globals()['_dlg']=1
      await pg.evaluate("Booth._test.chapterComplete()"); await pg.wait_for_timeout(1500)
      print("done dialog:", await pg.evaluate("[...document.querySelectorAll('.overlay button')].map(b=>b.innerText).join(' / ')"))
      await pg.evaluate("document.querySelectorAll('.overlay').forEach(o=>o.remove())")
    await pg.evaluate("Booth._test.sendToShared(true)"); await pg.wait_for_timeout(500); await pg.wait_for_function("!Booth.state.busy", timeout=60000)
    print("jack sent:", await pg.evaluate("JSON.stringify(Booth.state.chap.sent)"))
    # Anne, now editing: Jack's sent, and so has she
    await pg.evaluate("localStorage.setItem('lr-me','Anne')"); await pg.goto(U+"#/library"); await pg.wait_for_timeout(300)
    await pg.goto(U+f"#/booth/{bid}/0"); await pg.wait_for_selector("#booth-dock"); await pg.wait_for_timeout(1200); await pg.evaluate(SH)
    await pg.evaluate("Booth.state.side=null; Booth.state.tab='shared'; Booth._test.act('tools')"); await pg.wait_for_timeout(900)
    print("anne-as-editor tab:", await pg.evaluate("document.querySelector('#sh-body').innerText.replace(/\\n+/g,' | ')"))
    await pg.click("[data-p='shre']") if await pg.evaluate("!!document.querySelector(\"[data-p='shre']\")") else await pg.click("[data-p='shin']")
    await pg.wait_for_timeout(500); await pg.wait_for_function("!Booth.state.busy", timeout=60000); await pg.wait_for_timeout(800)
    print("timeline:", await pg.evaluate(C))
    await pg.keyboard.press("r"); await pg.wait_for_timeout(500); print("can record (not locked):", await pg.evaluate("!!Booth.state.rec")); await pg.keyboard.press("s"); await pg.wait_for_timeout(400)
    # Jack can't tick it: not the owner
    await pg.evaluate("localStorage.setItem('lr-me','Jack')"); await pg.goto(U+"#/library"); await pg.goto(U+f"#/book/{bid}"); await pg.wait_for_timeout(700)
    await pg.evaluate("document.querySelector('#sharedc') && (document.querySelector('#sharedc').open=true)"); await pg.wait_for_timeout(300)
    print("jack sees:", await pg.evaluate("[...document.querySelectorAll('[data-shedit]')].map(i=>i.disabled)"))
    print("ERRORS:", errs); await b.close()
asyncio.run(main()); srv.terminate()
