from _env import *
import asyncio, subprocess, sys, os, shutil
from playwright.async_api import async_playwright
srv = subprocess.Popen([sys.executable,"-m","http.server","8636","-d",ROOT],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
U="http://localhost:8636/index.html?test"
async def main():
  async with async_playwright() as p:
    b = await p.chromium.launch(executable_path=CHROME, args=["--no-sandbox","--use-fake-ui-for-media-stream","--use-fake-device-for-media-stream"])
    pg = await (await b.new_context(viewport={"width":1440,"height":900})).new_page()
    errs=[]; pg.on("pageerror", lambda e: errs.append(str(e))); pg.on("console", lambda m: m.type=="error" and errs.append("console:"+m.text))
    await pg.goto(U+"#/import"); await pg.wait_for_timeout(500)
    await pg.set_input_files("#file",FIX+"/duet.docx"); await pg.wait_for_selector("#create")
    await pg.fill("#it","Import Book"); await pg.click("#create"); await pg.wait_for_selector("table.ch"); await pg.wait_for_timeout(400)
    bid = await pg.evaluate("Store.books[0].id")
    await pg.evaluate("(()=>{const b=Store.books[0]; b.parts=Object.assign({}, b.parts, {n:'Anne', f:'Anne', m:'Jack'}); Store.saveBook(b,true);})()")
    await pg.evaluate("localStorage.setItem('lr-me','Jack'); localStorage.setItem('lr-castwords','0')")
    await pg.goto(U+"#/library"); await pg.goto(U+f"#/booth/{bid}/0"); await pg.wait_for_selector("#booth-dock"); await pg.wait_for_timeout(1500)
    print("reading as:", await pg.evaluate("Booth.state.readingAs"))
    await pg.evaluate("Booth.state.side=null; Booth.state.tab='duet'; Booth._test.act('tools')"); await pg.wait_for_timeout(500)
    print("button:", await pg.evaluate("(document.querySelector('[data-p=impmine]')||{}).innerText"))
    n = await pg.evaluate("Booth._test.myRuns ? Booth._test.myRuns().length : document.querySelectorAll('.co-line').length")
    print("my lines:", n)
    # a WAV: one burst per line, a second of quiet between, with a cue marker in the middle of the 2nd burst pair joined
    r = await pg.evaluate("""(async(n)=>{const R=44100, x=new Float32Array(R*(1+n*2)); for(let k=0;k<n;k++){const a=R*(1+k*2); for(let i=0;i<R;i++) x[a+i]=Math.sin(i/7)*0.3;}
      const cueN=1, extra=12+24*cueN; const buf=new ArrayBuffer(44+x.length*2+8+extra), v=new DataView(buf), ws=(o,t)=>{for(let i=0;i<t.length;i++)v.setUint8(o+i,t.charCodeAt(i));};
      ws(0,'RIFF'); v.setUint32(4,buf.byteLength-8,true); ws(8,'WAVE'); ws(12,'fmt '); v.setUint32(16,16,true); v.setUint16(20,1,true); v.setUint16(22,1,true); v.setUint32(24,R,true); v.setUint32(28,R*2,true); v.setUint16(32,2,true); v.setUint16(34,16,true); ws(36,'data'); v.setUint32(40,x.length*2,true);
      for(let i=0;i<x.length;i++) v.setInt16(44+i*2, x[i]*32767, true);
      let o=44+x.length*2; ws(o,'cue '); v.setUint32(o+4,extra,true); v.setUint32(o+8,1,true); v.setUint32(o+12,1,true); v.setUint32(o+16,R*2,true); ws(o+20,'data'); v.setUint32(o+32,R*2,true);
      await Booth._test.importMine(new File([buf],'jack-lines.wav')); return 1;})(%d)""" % n)
    await pg.wait_for_function("!Booth.state.busy", timeout=60000); await pg.wait_for_timeout(500)
    print("tracks:", await pg.evaluate("JSON.stringify(Booth.state.audio.tracks.map(t=>t.clips.length))"), "anchors:", await pg.evaluate("Booth.state.audio.anchors.length"))
    print("notice:", await pg.evaluate("[...document.querySelectorAll('.stu-notice,.notice,#bd-notice')].map(e=>e.innerText).join(' ')")[:300] if False else (await pg.evaluate("((document.querySelector('#bd-notice')||document.querySelector('.bd-notice')||{}).innerText||'')"))[:300])
    print("session words:", await pg.evaluate("Booth.state.session && Booth.state.session.words"), "booth sec:", await pg.evaluate("Booth.state.session && Booth.state.session.boothSec"))
    await pg.evaluate("Booth.state.side=null; Booth.state.tab='duet'; Booth._test.act('tools')"); await pg.wait_for_timeout(300)
    await pg.click("[data-p=send]"); await pg.wait_for_function("!Booth.state.busy", timeout=60000); await pg.wait_for_timeout(800)
    print("sent:", await pg.evaluate("JSON.stringify(Booth.state.sent)"))
    print("ERRORS:", errs); await b.close()
asyncio.run(main()); srv.terminate()
