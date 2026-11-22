# Markers survive leaving a chapter (✂ line ends included), travel in sends, and land in the editor's timeline with their lines.
from _env import *
import asyncio, subprocess, sys
from playwright.async_api import async_playwright
srv = subprocess.Popen([sys.executable,"-m","http.server","8649","-d",ROOT],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
U="http://localhost:8649/index.html?test"
C = "Booth.state.audio.tracks.map((t,i)=>'T'+(i+1)+'('+((Booth._test.trackSet()[i]||{}).name||'')+'):'+t.clips.map(c=>'['+c.at.toFixed(2)+'–'+(c.at+c.dur).toFixed(2)+(c.line?' L'+c.line.r:'')+']').join('')).join('  ')"
async def main():
  async with async_playwright() as p:
    b = await p.chromium.launch(executable_path=CHROME, args=["--no-sandbox","--use-fake-device-for-media-stream","--use-fake-ui-for-media-stream","--autoplay-policy=no-user-gesture-required"])
    ctx = await b.new_context(permissions=["microphone"], viewport={"width":1440,"height":900}); pg = await ctx.new_page()
    ERR=[]; errs=[]; pg.on("pageerror", lambda e: errs.append(str(e))); pg.on("console", lambda m: m.type=="error" and errs.append("console:"+m.text))
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
    # Anne marks her read: a flub, a named marker and a ✂ line end (stored as she'd make them), then leaves and comes back
    await pg.evaluate("(()=>{const m=Booth.state.audio.markers; m.push({id:'f1',t:0.4,w:2,ctx:'',note:'',done:false}); m.push({id:'n1',t:0.8,w:4,ctx:'',note:'Splice here',done:false}); m.push({id:'c1',t:1.1,w:6,ctx:'',note:'✂ line ends',cut:true,done:true}); Store.saveBook(Booth.state.book);})()")
    await pg.wait_for_timeout(600); before = await pg.evaluate("[...Booth.state.audio.markers].map(m=>(m.note||'flub')+'@'+m.t.toFixed(2))"); print("Anne's markers:", before)
    await pg.goto(U+f"#/booth/{bid}/1"); await pg.wait_for_timeout(1200); await pg.goto(U+f"#/booth/{bid}/0"); await pg.wait_for_selector("#booth-dock"); await pg.wait_for_timeout(1500); await pg.evaluate(SH)
    after = await pg.evaluate("[...Booth.state.audio.markers].map(m=>(m.note||'flub')+'@'+m.t.toFixed(2))"); print("after leaving and coming back:", after)
    if len(after) != len(before) or not any("line ends" in x for x in after): ERR.append("markers lost on leaving the chapter")
    await pg.evaluate("Booth._test.sendToShared(true)"); await pg.wait_for_timeout(500); await pg.wait_for_function("!Booth.state.busy", timeout=60000)
    sj = await pg.evaluate("(async()=>{const r=await navigator.storage.getDirectory(); const s=await r.getDirectoryHandle('SharedBook'); const c=await s.getDirectoryHandle('Chapters'); const out=[]; for await (const [n,h] of c.entries()) { if(h.kind!=='directory') continue; for await (const [p,ph] of h.entries()) { if(ph.kind!=='directory') continue; try { const j=JSON.parse(await (await (await ph.getFileHandle('send.json')).getFile()).text()); out.push(p+':'+(j.markers||[]).map(m=>m.note||'flub').join('|')); } catch(e){} } } return out; })()")
    print("in Anne's send:", sj)
    if not any("line ends" in x for x in sj): ERR.append("send has no markers")
    # Jack sends his read, with a flub inside his first line
    await pg.evaluate("localStorage.setItem('lr-me','Jack')"); await pg.goto(U+"#/library"); await pg.wait_for_timeout(300)
    await pg.goto(U+f"#/booth/{bid}/0"); await pg.wait_for_selector("#booth-dock"); await pg.wait_for_timeout(1200)
    await pg.evaluate("(()=>{Booth.state.audio.markers.push({id:'jf',t:0.6,w:Booth._test.myRuns()[0].from+1,ctx:'',note:'',done:false}); Booth.state.audio.markers.push({id:'jc',t:0.75,w:Booth._test.myRuns()[0].to,ctx:'',note:'✂ line ends',cut:true,done:true}); Store.saveBook(Booth.state.book);})()")
    await pg.evaluate("Booth._test.sendToShared(true)"); await pg.wait_for_timeout(500); await pg.wait_for_function("!Booth.state.busy", timeout=60000)
    # the editor brings both in
    await pg.evaluate("localStorage.setItem('lr-me','Eddie')"); await pg.goto(U+"#/library"); await pg.wait_for_timeout(300)
    await pg.goto(U+f"#/booth/{bid}/0"); await pg.wait_for_selector("#booth-dock"); await pg.wait_for_timeout(1200)
    await pg.evaluate("Booth.state.side=null; Booth.state.tab='shared'; Booth._test.act('tools')"); await pg.wait_for_timeout(900)
    await pg.click("[data-p='shin']"); await pg.wait_for_timeout(500); await pg.wait_for_function("!Booth.state.busy", timeout=60000); await pg.wait_for_timeout(800)
    ed = await pg.evaluate("[...Booth.state.audio.markers].map(m=>(m.note||'flub')+'@'+m.t.toFixed(2))"); print("editor's markers:", ed)
    tl = await pg.evaluate(C); print("editor timeline:", tl)
    jm = await pg.evaluate("(()=>{const m=Booth.state.audio.markers.find(x=>x.by==='Jack'); if(!m) return null; const c=Booth.state.audio.tracks.flatMap(t=>t.clips).filter(c=>c.line&&c.line.r==='Jack'); return c.some(c=>m.t>=c.at-0.01&&m.t<=c.at+c.dur+0.01);})()")
    print("Jack's flub sits inside his spliced line:", jm)
    d0 = await pg.evaluate("(()=>{const c=Booth.state.audio.tracks.flatMap(t=>t.clips).filter(c=>c.line&&c.line.r==='Jack').sort((a,b)=>a.at-b.at)[0]; return c ? Math.round(c.dur*100)/100 : null})()")
    print("Jack's first line, cut at his ✂ mark: lasts", d0, "s (it began at 0.35 s; the mark is at 0.75 s)")
    if d0 is None or abs(d0 - 0.37) > 0.03: ERR.append("line end ignored the ✂ mark")
    if not any(x.startswith("Anne · ✂ line ends") for x in ed) or not any(x.startswith("Anne · Splice here") for x in ed): ERR.append("Anne's markers missing in the editor's timeline")
    if not jm: ERR.append("Jack's marker didn't ride with his line")
    print("ERR:", ERR); print("ERRORS:", errs); await b.close()
asyncio.run(main()); srv.terminate()
