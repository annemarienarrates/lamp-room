from _env import *
import asyncio, subprocess, sys, json
from playwright.async_api import async_playwright
srv = subprocess.Popen([sys.executable,"-m","http.server","8618","-d",ROOT],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
U="http://localhost:8618/index.html?test"
async def main():
  async with async_playwright() as p:
    b = await p.chromium.launch(executable_path=CHROME, args=["--no-sandbox","--use-fake-device-for-media-stream","--use-fake-ui-for-media-stream"])
    ctx = await b.new_context(permissions=["microphone"], viewport={"width":1440,"height":900}); pg = await ctx.new_page()
    errs=[]; pg.on("pageerror", lambda e: errs.append(str(e)+" @ "+(e.stack or "")[:300]))
    await pg.goto(U+"#/import"); await pg.wait_for_timeout(800)
    await pg.set_input_files("#file",FIX+"/pauses.docx"); await pg.wait_for_selector("#create")
    await pg.fill("#it","Pause Test"); await pg.click("#create"); await pg.wait_for_timeout(1200)
    bid = await pg.evaluate("Store.books[0].id")
    await pg.goto(U+f"#/booth/{bid}/0"); await pg.wait_for_timeout(1500)
    print("paras:", await pg.evaluate("Booth.state.chap.paras.map(p=>typeof p==='string'?p.slice(0,12):'{r}')"))
    # a take with known pauses: head 1.5 | heading 1.0 | pause 1.0 | 1.4 | 0.5 | scene 2.5 | 0.9 | tail 1.0
    plan = [("sil",1.5),("sp",1.0),("sil",1.0),("sp",3),("sil",1.0),("sp",2),("sil",1.4),("sp",2),("sil",0.5),("sp",2),("sil",2.5),("sp",2),("sil",0.9),("sp",1.5),("sil",1.0)]
    await pg.evaluate("""(async(plan)=>{const R=48000;let n=0;for(const [k,d] of plan)n+=Math.round(d*R);const x=new Float32Array(n);let o=0,ph=0;
      for(const [k,d] of plan){const m=Math.round(d*R);for(let i=0;i<m;i++){x[o+i]=(Math.random()*2-1)*0.0012; if(k==='sp'){const env=0.6+0.4*Math.sin(i/R*2*Math.PI*3);x[o+i]+=0.25*env*Math.sin(2*Math.PI*190*(o+i)/R)+0.05*(Math.random()*2-1)}}o+=m}
      await Store.studioStatus();const d=await Store.chapterAudioDir(Booth.state.book,Booth.state.chap);const w=await LRAudio.WavWriter.create(d,'synth.wav',R);w.push(x);await w.close();
      const a=Booth.state.audio;a.tracks[0].clips=[{file:'synth.wav',off:0,dur:n/R,at:0}];
      // word timing: first body word (index 2) just after the heading pause; first word after the scene break
      const toks=Booth.state.toks; let s=-1; const P=Booth.state.chap.paras; for(let i=0;i<toks.length-1;i++){for(let q=toks[i].p+1;q<toks[i+1].p;q++) if(P[q]==='⁂') s=i+1}
      a.anchors=[[1.4,0],[3.6,2],[8,30],[12,60],[18.9,s],[22,s+20]]; window.__scene=s; Store.saveBook(Booth.state.book);})""", plan)
    await pg.evaluate("Booth._test.loadPeaksNow && Booth._test.loadPeaksNow()")
    print("scene word:", await pg.evaluate("window.__scene"), "len:", round(await pg.evaluate("Booth._test.len()"),2))
    await pg.evaluate("Booth.state.side='tools'; Booth.state.tab='levels'"); await pg.click("[data-s=tools]"); await pg.wait_for_timeout(300); await pg.select_option("[data-tab]","levels"); await pg.wait_for_timeout(300)
    await pg.click("[data-p=pzprev]"); await pg.wait_for_timeout(2500); print("toasts:", await pg.evaluate("[...document.querySelectorAll('.toast')].map(t=>t.innerText)"), await pg.evaluate("Booth.state.busy"))
    print("preview:", await pg.evaluate("(document.querySelector('.pz-sum')||{}).innerText"))
    await pg.screenshot(path="shots/sp-tools.png")
    await pg.click("[data-p=pzapply]"); await pg.wait_for_timeout(3000)
    r = await pg.evaluate("(async()=>{const P=await Booth._test.findPauses();return {L:+P.L.toFixed(2),head:+P.first.toFixed(2),tail:+(P.L-P.last).toFixed(2),pauses:P.pauses.map(p=>+(p.b-p.a).toFixed(2)),pad:Booth.state.audio.pad}})()")
    print("after:", r)
    # room tone, add space, export length includes pad
    await pg.click("[data-p=tonelearn]"); await pg.wait_for_timeout(2500)
    print("tone:", await pg.evaluate("JSON.stringify(Booth.state.book.roomTone)"))
    L0 = await pg.evaluate("Booth._test.len()"); await pg.evaluate("Booth._test.seek(5)"); await pg.keyboard.press("g"); await pg.wait_for_timeout(500)
    print("G add space:", round(L0,2), "->", round(await pg.evaluate("Booth._test.len()"),2))
    x = await pg.evaluate("(async()=>{const m=await Booth._test.mix();const y=await m(5.05,0.4);let s=0;for(const v of y)s+=v*v;return Math.sqrt(s/y.length)})()")
    print("room tone in the added gap (rms):", round(x,5))
    # fades and edge drag with the mouse
    await pg.evaluate("Booth._test.selectTake(0,0)"); await pg.fill("#fz-in","300") if await pg.query_selector("#fz-in") else None
    await pg.evaluate("Booth.state.view.pps=40; Booth.state.view.t0=0; Booth._test.drawWave&&0")
    box = await pg.evaluate("(()=>{const r=document.querySelector('#wave').getBoundingClientRect();return [r.left,r.top,r.width,r.height]})()")
    clips0 = await pg.evaluate("JSON.stringify(Booth.state.audio.tracks[0].clips.map(c=>[+c.at.toFixed(2),+c.dur.toFixed(2),c.fi||0,c.fo||0]))")
    c0 = await pg.evaluate("(()=>{const c=Booth.state.audio.tracks[0].clips[0];return [c.at,c.dur]})()")
    xEnd = box[0] + (c0[0]+c0[1])*40; yMid = box[1]+14+ (box[3]-14)/2
    await pg.mouse.move(xEnd, yMid); await pg.mouse.down(); await pg.mouse.move(xEnd-20, yMid, steps=4); await pg.mouse.up(); await pg.wait_for_timeout(400)
    print("edge drag -0.5 s:", clips0, "->", await pg.evaluate("JSON.stringify(Booth.state.audio.tracks[0].clips.map(c=>[+c.at.toFixed(2),+c.dur.toFixed(2)]))"))
    xa = box[0] + c0[0]*40 + 10; yDot = box[1] + box[3] - 8
    await pg.mouse.move(xa, yDot); await pg.mouse.down(); await pg.mouse.move(xa+30, yDot, steps=4); await pg.mouse.up(); await pg.wait_for_timeout(300)
    print("fade-in by dragging dot:", await pg.evaluate("Booth.state.audio.tracks[0].clips[0].fi"))
    await pg.screenshot(path="shots/sp-wave.png")
    print("ERRORS:", errs); await b.close()
asyncio.run(main()); srv.terminate()
