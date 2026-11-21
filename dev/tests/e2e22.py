from _env import *
import asyncio, subprocess, sys, json
from playwright.async_api import async_playwright
srv = subprocess.Popen([sys.executable,"-m","http.server","8622","-d",ROOT],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
U="http://localhost:8622/index.html?test"
C = "Booth.state.audio.tracks.map((t,i)=>'T'+(i+1)+':'+t.clips.map(c=>'['+c.at.toFixed(2)+'–'+(c.at+c.dur).toFixed(2)+(c.line?' L'+c.line.from:'')+']').join('')).join('  ')"
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
    async def jack_send(tag):
      await pg.evaluate("localStorage.setItem('lr-me','Jack')"); await pg.goto(U+"#/library"); await pg.wait_for_timeout(300)
      await pg.goto(U+f"#/booth/{bid}/0"); await pg.wait_for_selector("#booth-dock"); await pg.wait_for_timeout(800)
      n = await pg.evaluate("Booth._test.myRuns().length")
      if tag=="first":
        await pg.evaluate("Booth.state.prerollSec=0"); await pg.keyboard.press("r"); await pg.wait_for_timeout(1200*n+1500); await pg.keyboard.press("s"); await pg.wait_for_timeout(800)
        await pg.evaluate("(()=>{const rs=Booth._test.myRuns(); Booth.state.audio.anchors=[]; rs.forEach((x,k)=>{const t0=0.35+1.2*k; Booth.state.audio.anchors.push([t0+0.15, x.from+1]); Booth.state.audio.anchors.push([t0+0.6, x.to+1]);});})()")
      await pg.evaluate("Booth._test.sendLines()"); await pg.wait_for_function("!Booth.state.busy", timeout=60000); await pg.wait_for_timeout(600)
      print("jack sent ("+tag+"):", await pg.evaluate("JSON.stringify(Booth.state.sent)"))
    await jack_send("first")
    await pg.evaluate("localStorage.setItem('lr-me','Anne')"); await pg.goto(U+"#/library"); await pg.wait_for_timeout(300)
    await pg.goto(U+f"#/booth/{bid}/0"); await pg.wait_for_selector("#booth-dock"); await pg.wait_for_timeout(1800)
    await pg.evaluate("Booth.state.settings_hear=0; Store.settings.duet=Object.assign({},Store.settings.duet,{hear:false})")
    # 1. drop a line, then keep reading over it
    await pg.evaluate("Booth.state.prerollSec=0"); await pg.keyboard.press("r"); await pg.wait_for_timeout(1500)
    await pg.keyboard.press("c"); await pg.wait_for_timeout(150)
    d = await pg.evaluate("(()=>{const r=Booth.state.rec, d=r.drops[0]; return {t:d.t, dur:d.dur}})()"); print("dropped at", d)
    await pg.wait_for_timeout(250)
    print("auto-skip from reading on:", await pg.evaluate("(()=>{const r=Booth.state.rec; Booth.state.f.set(Booth.state.f.pos+3); return 1})()"))
    await pg.wait_for_timeout(400)
    print("skips:", await pg.evaluate("JSON.stringify(Booth.state.rec.skips)"), "| banner:", await pg.evaluate("(document.querySelector('#duet-banner')||{}).textContent"))
    await pg.wait_for_timeout(1200); await pg.keyboard.press("s"); await pg.wait_for_timeout(800)
    lay = await pg.evaluate(C); print("after stop:", lay)
    ov = await pg.evaluate("""(()=>{const a=Booth.state.audio, L=a.tracks.flatMap(t=>t.clips.filter(c=>c.line)); let o=0;
      for(const l of L) for(const t of a.tracks) for(const c of t.clips) if(!c.line){const x=Math.max(c.at,l.at+0.06), y=Math.min(c.at+c.dur,l.at+l.dur-0.06); if(y>x) o+=y-x;} return o.toFixed(3)})()""")
    print("seconds of my audio under their line:", ov)
    # 2. line editor
    await pg.evaluate("(()=>{const a=Booth.state.audio; a.tracks.forEach((t,ti)=>t.clips.forEach((c,ci)=>{if(c.line)Booth._test.selectTake(ti,ci)}));})()"); await pg.wait_for_timeout(200)
    print("editor:", await pg.evaluate("(document.querySelector('#line-ed')||{}).innerText"))
    await pg.screenshot(path=SHOTS+"/line-ed.png")
    before = await pg.evaluate(C)
    await pg.click("#line-ed [data-le='e-']"); await pg.wait_for_timeout(200)
    print("end −50ms:", await pg.evaluate(C))
    await pg.click("#line-ed [data-le='reset']"); await pg.wait_for_timeout(200)
    print("re-cut:   ", await pg.evaluate(C), "| same as before:", (await pg.evaluate(C))==before)
    await pg.click("#line-ed [data-le='close']"); await pg.wait_for_timeout(100)
    await pg.evaluate("Store.saveBook(Booth.state.book,true)"); await pg.wait_for_timeout(500)
    # 3. Jack re-sends; Anne swaps them in
    await jack_send("again")
    await pg.evaluate("localStorage.setItem('lr-me','Anne')"); await pg.goto(U+"#/library"); await pg.wait_for_timeout(300)
    await pg.goto(U+f"#/booth/{bid}/0"); await pg.wait_for_selector("#booth-dock"); await pg.wait_for_timeout(1800)
    await pg.evaluate("Booth._test.bringLines(null,true)"); await pg.wait_for_timeout(600)
    print("recut waiting:", await pg.evaluate("Booth._test.recutOf('Jack').length"))
    await pg.evaluate("Booth.state.side=null; Booth.state.tab='duet'; Booth._test.act('tools')"); await pg.wait_for_timeout(300)
    print("panel:", await pg.evaluate("(document.querySelector('.bd-sec.recut')||{}).innerText"))
    f0 = await pg.evaluate("Booth.state.audio.tracks.flatMap(t=>t.clips).filter(c=>c.line).map(c=>c.file).join(',')")
    await pg.click(".bd-sec.recut [data-p^='recut']"); await pg.wait_for_timeout(400)
    f1 = await pg.evaluate("Booth.state.audio.tracks.flatMap(t=>t.clips).filter(c=>c.line).map(c=>c.file).join(',')")
    print("swapped:", f0 != f1, "| left:", await pg.evaluate("Booth._test.recutOf('Jack').length"), "|", await pg.evaluate(C))
    await pg.evaluate("Booth._test.undo()"); await pg.wait_for_timeout(200)
    print("undo restores old:", await pg.evaluate("Booth.state.audio.tracks.flatMap(t=>t.clips).filter(c=>c.line).map(c=>c.file).join(',')") == f0)
    # 4. flub just after their line: the line stays whole in front of the re-read
    await pg.evaluate("""(()=>{const B=Booth.state, l=Booth._test.theirRuns()[0]; const s=l.to+3; B.audio.anchors=[[0.2,0],[1.6,s]]; B.f.set(s+4);})()""")
    await pg.evaluate("Booth.state.prerollSec=0; Booth._test.flub()"); await pg.wait_for_timeout(1500); await pg.keyboard.press("s"); await pg.wait_for_timeout(700)
    print("after flub:", await pg.evaluate(C))
    print("ERRORS:", errs); await b.close()
asyncio.run(main()); srv.terminate()
