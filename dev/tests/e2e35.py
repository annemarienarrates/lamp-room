from _env import *
import asyncio, subprocess, sys
from playwright.async_api import async_playwright
srv = subprocess.Popen([sys.executable,"-m","http.server","8635","-d",ROOT],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
U="http://localhost:8635/index.html?test"
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
    await pg.evaluate("(()=>{const b=Store.books[0]; b.parts=Object.assign({}, b.parts, {n:'Anne', f:'Cast 1', m:'Jack'}); Store.settings.narrators=[{name:'Anne',pace:4035},{name:'Jack',pace:2000},{name:'Eddie',pace:1}]; Store.saveBook(b,true);})()")
    await pg.goto(U+"#/library"); await pg.goto(U+f"#/book/{bid}"); await pg.wait_for_timeout(600); await pg.evaluate(SH)
    await pg.evaluate("document.querySelector('#sharedc').open=true"); await pg.click("#shsetup"); await pg.wait_for_timeout(800)
    await pg.evaluate("document.querySelector('#sharedc').open=true"); await pg.click("#shadd"); await pg.wait_for_timeout(500)
    await pg.evaluate("(()=>{const b=Store.books[0]; b.sharedPeople[b.sharedPeople.length-1].name='Eddie'; (b.sharedPeople.find(p=>p.name==='Cast 1')||{}).role='outside'; Store.saveBook(b,true);})()"); await pg.wait_for_timeout(800)
    await pg.goto(U+"#/library"); await pg.goto(U+f"#/book/{bid}"); await pg.wait_for_timeout(700)
    print("cast name inputs:", await pg.evaluate("[...document.querySelectorAll('[data-castname]')].map(i=>i.dataset.castname)"))
    await pg.fill("[data-castname='Cast 1']", "John Rogers"); await pg.dispatch_event("[data-castname='Cast 1']", "change"); await pg.wait_for_timeout(900)
    print("castNames:", await pg.evaluate("JSON.stringify(Store.books[0].castNames)"), "| option:", await pg.evaluate("[...document.querySelectorAll('[data-part] option')].map(o=>o.textContent).filter(t=>/Cast 1/.test(t))[0]"))
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
    await pg.evaluate("Booth._test.sendToShared(true)"); await pg.wait_for_timeout(500); await pg.wait_for_function("!Booth.state.busy", timeout=60000)
    print("jack sent:", await pg.evaluate("JSON.stringify(Booth.state.chap.sent)"))
    # the editor
    await pg.evaluate("localStorage.setItem('lr-me','Eddie')"); await pg.goto(U+"#/library"); await pg.wait_for_timeout(300)
    await pg.goto(U+f"#/booth/{bid}/0"); await pg.wait_for_selector("#booth-dock"); await pg.wait_for_timeout(1200)
    await pg.evaluate("Booth.state.side=null; Booth.state.tab='shared'; Booth._test.act('tools')"); await pg.wait_for_timeout(900)
    print("editor tab:", await pg.evaluate("document.querySelector('#sh-body').innerText.replace(/\\n+/g,' | ')"))
    await pg.click("[data-p='shin']"); await pg.wait_for_timeout(500); await pg.wait_for_function("!Booth.state.busy", timeout=60000); await pg.wait_for_timeout(800)
    print("editor timeline:", await pg.evaluate(C))
    await pg.screenshot(path=SHOTS+"/editor.png")
    # the outside cast member: the editor drops her file in Collaborate
    await pg.evaluate("Booth.state.side=null; Booth.state.tab='duet'; Booth._test.act('tools')"); await pg.wait_for_timeout(600)
    print("editor's castNames:", await pg.evaluate("JSON.stringify(Booth.state.book.castNames)"))
    await pg.evaluate("Booth.state.side=null; Booth.state.tab='shared'; Booth._test.act('tools')"); await pg.wait_for_timeout(900)
    print("editor shared tab:", (await pg.evaluate("((document.querySelector('#sh-body')||{}).innerText||'').replace(/\\n+/g,' | ')"))[:600])
    await pg.evaluate("Booth.state.side=null; Booth.state.tab='duet'; Booth._test.act('tools')"); await pg.wait_for_timeout(600)
    print("editor collaborate:", await pg.evaluate("[...document.querySelectorAll('[data-p^=castdrop]')].map(b=>b.innerText)"), "| runs:", await pg.evaluate("JSON.stringify([...new Set(Booth._test.theirRuns().map(x=>x.r))])"))
    print("tab label:", await pg.evaluate("[...document.querySelectorAll('[data-tab]')].map(b=>b.innerText).filter(t=>/Collab|Co-n/.test(t))"))
    na = await pg.evaluate("Booth._test.theirRuns().length")
    await pg.evaluate("localStorage.setItem('lr-castwords','0')")
    r = await pg.evaluate("""(async()=>{const R=48000, n=%d, x=new Float32Array(R*(1+n*2)); for(let k=0;k<n;k++){const a=R*(1+k*2); for(let i=0;i<R;i++) x[a+i]=Math.sin(i/9)*0.3;}
      const buf=new ArrayBuffer(44+x.length*2), v=new DataView(buf), ws=(o,t)=>{for(let i=0;i<t.length;i++)v.setUint8(o+i,t.charCodeAt(i));};
      ws(0,'RIFF'); v.setUint32(4,36+x.length*2,true); ws(8,'WAVE'); ws(12,'fmt '); v.setUint32(16,16,true); v.setUint16(20,1,true); v.setUint16(22,1,true); v.setUint32(24,R,true); v.setUint32(28,R*2,true); v.setUint16(32,2,true); v.setUint16(34,16,true); ws(36,'data'); v.setUint32(40,x.length*2,true);
      for(let i=0;i<x.length;i++) v.setInt16(44+i*2, Math.max(-1,Math.min(1,x[i]))*32767, true);
      return JSON.stringify(await Booth._test.castDrop('Cast 1', new File([buf],'amber.wav'), false));})()""" % na)
    print("drop:", r)
    await pg.evaluate("(()=>{const a=Booth.state.audio, L=Booth._test.len(); a.anchors=[]; for(let w=0; w<=Booth.state.toks.length; w+=6) a.anchors.push([L*w/Booth.state.toks.length, w]);})()")
    await pg.evaluate("Booth._test.spliceAll()"); await pg.wait_for_function("!Booth.state.busy", timeout=60000); await pg.wait_for_timeout(600)
    print("after splice:", await pg.evaluate(C))
    print("notice:", await pg.evaluate("(document.querySelector('.stu-notice, #booth-notice, .notice')||{}).innerText"), "| anchors:", await pg.evaluate("JSON.stringify((Booth.state.audio.anchors||[]).slice(0,40))"), "| amber runs:", await pg.evaluate("JSON.stringify(Booth._test.theirRuns().map(x=>[x.from,x.to]))"))
    print("ERRORS:", errs); await b.close()
asyncio.run(main()); srv.terminate()
