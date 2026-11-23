from _env import *
import asyncio, subprocess, sys
from playwright.async_api import async_playwright
srv = subprocess.Popen([sys.executable,"-m","http.server","8630","-d",ROOT],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
U="http://localhost:8630/index.html?test"
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
    await pg.evaluate("document.querySelector('#sharedc').open=true"); await pg.click("#shadd"); await pg.wait_for_timeout(500)
    await pg.evaluate("(()=>{const b=Store.books[0]; b.sharedPeople[b.sharedPeople.length-1].name='Eddie'; Store.saveBook(b,true);})()"); await pg.wait_for_timeout(800)
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
    await pg.keyboard.press("r"); await pg.wait_for_timeout(400); rec = await pg.evaluate("!!Booth.state.rec"); print("can still record after sharing:", rec); await pg.keyboard.press("s"); await pg.wait_for_timeout(400)
    if not rec: errs.append("chapter locked after sharing")
    # Jack sends his own read too
    await pg.evaluate("localStorage.setItem('lr-me','Jack')"); await pg.goto(U+"#/library"); await pg.wait_for_timeout(300)
    await pg.goto(U+f"#/booth/{bid}/0"); await pg.wait_for_selector("#booth-dock"); await pg.wait_for_timeout(1200)
    await pg.evaluate("Booth._test.sendToShared(true)"); await pg.wait_for_timeout(500); await pg.wait_for_function("!Booth.state.busy", timeout=60000)
    print("jack sent:", await pg.evaluate("JSON.stringify(Booth.state.chap.sent)"))
    # Eddie, on the book with no lines of his own, brings everyone in
    await pg.evaluate("localStorage.setItem('lr-me','Eddie')"); await pg.goto(U+"#/library"); await pg.wait_for_timeout(300)
    await pg.goto(U+f"#/booth/{bid}/0"); await pg.wait_for_selector("#booth-dock"); await pg.wait_for_timeout(1200)
    await pg.evaluate("Booth.state.side=null; Booth.state.tab='shared'; Booth._test.act('tools')"); await pg.wait_for_timeout(900)
    print("editor tab:", await pg.evaluate("document.querySelector('#sh-body').innerText.replace(/\\n+/g,' | ')"))
    await pg.click("[data-p='shin']"); await pg.wait_for_timeout(500); await pg.wait_for_function("!Booth.state.busy", timeout=60000); await pg.wait_for_timeout(800)
    print("editor timeline:", await pg.evaluate(C))
    await pg.screenshot(path=SHOTS+"/editor.png")
    await pg.click(".th-all [data-tca='1']") if await pg.evaluate("!!document.querySelector('.th-all')") else None
    await pg.evaluate("Booth.state.side=null; Booth.state.tab='shared'; Booth._test.act('tools')"); await pg.wait_for_timeout(900)
    await pg.click("[data-p='shfin']"); await pg.wait_for_timeout(500)
    print("export name:", await pg.evaluate("document.querySelector('#xname').value"))
    await pg.click("#xgo"); await pg.wait_for_timeout(4000)
    print("Finished folder:", await pg.evaluate("(async()=>{const d=await (await (await navigator.storage.getDirectory()).getDirectoryHandle('SharedBook')).getDirectoryHandle('Finished'); const o=[]; for await (const [n] of d.entries()) o.push(n); return o})()"))
    # editor flags a sentence and asks the reader; a reply comes back; Put in replaces the red zone
    await pg.evaluate("(()=>{const B=Booth.state; B.audio.markers.push({id:'ed1',t:1.0,w:3,note:'Flub'});})()")
    await pg.evaluate("Booth.state.side=null; Booth.state.tab='pickups'; Booth._test.act('tools')"); await pg.wait_for_timeout(400)
    print("editor pickups row:", await pg.evaluate("[...document.querySelectorAll('[data-p^=pask]')].map(b=>b.innerText)"))
    await pg.click("[data-p='pask:ed1']"); await pg.wait_for_timeout(800)
    q = await pg.evaluate("JSON.stringify(Store.pickupReqs(Booth.state.book).map(q=>[q.asker,q.to,q.mark,q.status]))"); print("request:", q)
    print("in the shared Pickups folder:", await pg.evaluate("(async()=>{const d=await (await (await navigator.storage.getDirectory()).getDirectoryHandle('SharedBook')).getDirectoryHandle('Pickups'); const o=[]; for await (const [n] of d.entries()) o.push(n); return o})()"))
    L0 = await pg.evaluate("Booth._test.len()")
    await pg.evaluate("""(async()=>{const B=Booth.state, q=Store.pickupReqs(B.book).find(q=>q.mark==='ed1'); const d=await Store.pickupsDir(B.book,q.to,true);
      const x=new Float32Array(48000*0.8).map((_,i)=>Math.sin(i/20)*0.2); const w=await LRAudio.WavWriter.create(d,'r1.wav',48000); w.push(x); await w.close();
      await Store.savePickupReply(B.book,q.to,q.id,{file:'r1.wav',dur:0.8,made:new Date().toISOString()}); })()""")
    await pg.wait_for_timeout(500)
    n = await pg.evaluate("Booth._test.applyPickups()"); await pg.wait_for_timeout(800)
    print("put in:", n, "| len", round(L0,2), "→", round(await pg.evaluate("Booth._test.len()"),2), "| markers:", await pg.evaluate("Booth.state.audio.markers.map(m=>m.id)"))
    print("ERRORS:", errs); await b.close()
asyncio.run(main()); srv.terminate()
