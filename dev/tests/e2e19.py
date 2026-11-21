from _env import *
import asyncio, subprocess, sys, json
from playwright.async_api import async_playwright
srv = subprocess.Popen([sys.executable,"-m","http.server","8619","-d",ROOT],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
U="http://localhost:8619/index.html?test"
FILE = lambda path, name: f"(async()=>{{const b=await (await fetch('/dev/fixtures/{path}')).blob();return new File([b],'{name}');}})()"
async def main():
  async with async_playwright() as p:
    b = await p.chromium.launch(executable_path=CHROME, args=["--no-sandbox","--use-fake-device-for-media-stream","--use-fake-ui-for-media-stream","--autoplay-policy=no-user-gesture-required"])
    ctx = await b.new_context(permissions=["microphone"], viewport={"width":1440,"height":900}); pg = await ctx.new_page()
    errs=[]; pg.on("pageerror", lambda e: errs.append(str(e)+" @ "+(e.stack or "")[:300]))
    await pg.goto(U+"#/settings"); await pg.wait_for_timeout(900)
    print("settings:", await pg.evaluate("[!!document.querySelector('#vw'), !!document.querySelector('#conf'), document.querySelector('#conf').checked, document.querySelector('#cues').value]"))
    await pg.goto(U+"#/import"); await pg.wait_for_timeout(500)
    await pg.set_input_files("#file",FIX+"/cast.docx"); await pg.wait_for_selector("#create")
    await pg.select_option("[data-ipart='c:cyan']","Jack")
    await pg.fill("#it","Duet Test"); await pg.click("#create"); await pg.wait_for_timeout(1300)
    bid = await pg.evaluate("Store.books.find(b=>b.title==='Duet Test').id")
    await pg.goto(U+f"#/booth/{bid}/0"); await pg.wait_for_timeout(1500)
    # notices: a marker's confirmation is off by default; a warning still shows
    await pg.evaluate("Booth.state.prerollSec=0")
    await pg.keyboard.press("m"); await pg.wait_for_timeout(300)
    print("marker toast shown (should be none):", await pg.evaluate("[...document.querySelectorAll('.toast')].map(t=>t.innerText)"))
    # arrows: next line
    p0 = await pg.evaluate("Booth.state.f.pos"); await pg.keyboard.press("ArrowDown"); await pg.wait_for_timeout(200); p1 = await pg.evaluate("Booth.state.f.pos")
    await pg.keyboard.press("ArrowDown"); p2 = await pg.evaluate("Booth.state.f.pos"); await pg.keyboard.press("ArrowUp"); p3 = await pg.evaluate("Booth.state.f.pos")
    print("arrows:", p0, p1, p2, "up ->", p3)
    # Jack's lines arrive as a file (with handles)
    await pg.evaluate("Booth.state.f.set(0)")
    print("runs:", await pg.evaluate("Booth._test.runsIn(Booth.state.chap).map(x=>x.r)"), "parts:", await pg.evaluate("JSON.stringify(Booth.state.book.parts)"))
    pg.on("console", lambda m: print("CONSOLE", m.type, m.text[:300]))
    r = await pg.evaluate(f"(async()=>{{const f=await {FILE('cast1_pauses.wav','jack.wav')}; console.log('busy',Booth.state.busy,'rec',!!Booth.state.rec,'size',f.size); return Booth._test.castDrop('Jack', f, false)}})()")
    print("castDrop returned:", r, await pg.evaluate("Booth.state.busy"), await pg.evaluate("[...document.querySelectorAll('.toast')].map(t=>t.innerText)"))
    print("jack lines:", r, await pg.evaluate("JSON.stringify(Booth.state.audio.duet.Jack.lines.map(l=>[+l.dur.toFixed(2),+(l.hin||0).toFixed(2),+(l.hout||0).toFixed(2)]))"))
    # record narration, move the reading place past Jack's line so it drops in, then skip it with Space
    jr = await pg.evaluate("Booth._test.runsIn(Booth.state.chap).find(x=>x.r==='Jack')")
    await pg.keyboard.press("r"); await pg.wait_for_timeout(1500)
    await pg.evaluate(f"Booth.state.f.set({jr['to']+1})"); 
    await pg.wait_for_function("Booth.state.rec && Booth.state.rec.coNow", timeout=8000)
    print("dropped:", await pg.evaluate("JSON.stringify(Booth.state.rec.coNow && {t:+Booth.state.rec.coNow.t.toFixed(2),dur:+Booth.state.rec.coNow.dur.toFixed(2)})"), "| banner:", await pg.evaluate("(document.querySelector('#duet-banner')||{}).innerText"))
    await pg.wait_for_timeout(400); await pg.keyboard.press(" "); await pg.wait_for_timeout(200)
    sk = await pg.evaluate("JSON.stringify(Booth.state.rec.skips)"); print("skips:", sk)
    await pg.wait_for_timeout(1500); await pg.keyboard.press("s"); await pg.wait_for_timeout(1200)
    print("after stop:", await pg.evaluate("JSON.stringify(Booth.state.audio.tracks.map(t=>t.clips.map(c=>[+c.at.toFixed(2),+(c.at+c.dur).toFixed(2),c.line?'J':''])))"))
    # nudge the Jack line, drag it, trim indicator, zoom fit
    await pg.evaluate("(()=>{const tr=Booth.state.audio.tracks;for(let ti=0;ti<tr.length;ti++){const ci=tr[ti].clips.findIndex(c=>c.line);if(ci>=0){Booth._test.selectTake(ti,ci);return}}})()")
    a0 = await pg.evaluate("Booth.state.audio.tracks.flatMap(t=>t.clips).find(c=>c.line).at")
    await pg.keyboard.press("Alt+ArrowRight"); await pg.wait_for_timeout(200)
    a1 = await pg.evaluate("Booth.state.audio.tracks.flatMap(t=>t.clips).find(c=>c.line).at"); print("nudge:", round(a0,3), "->", round(a1,3))
    await pg.click("[data-b=fit]"); await pg.wait_for_timeout(200); print("fit pps:", round(await pg.evaluate("Booth.state.view.pps"),2))
    await pg.evaluate("Booth.state.view.pps=60; Booth.state.view.t0=0")
    box = await pg.evaluate("(()=>{const r=document.querySelector('#wave').getBoundingClientRect();return [r.left,r.top,r.width,r.height]})()")
    c0 = await pg.evaluate("(()=>{const c=Booth.state.audio.tracks[0].clips[0];return [c.at,c.dur]})()")
    n = await pg.evaluate("Booth.state.audio.tracks.length"); LH=(box[3]-14)/n
    xEnd = box[0] + (c0[0]+c0[1])*60; y = box[1]+14+LH/2
    await pg.mouse.move(xEnd, y); await pg.mouse.down(); await pg.mouse.move(xEnd-25, y, steps=4)
    print("trim view mid-drag:", await pg.evaluate("JSON.stringify(Booth.state.trimView && {open:Booth.state.trimView.open,label:Booth.state.trimView.label,lanes:Booth.state.trimView.lanes})"))
    await pg.screenshot(path="shots/n-trim.png"); await pg.mouse.up(); await pg.wait_for_timeout(300)
    # a co line drag: ghost mode
    jc = await pg.evaluate("(()=>{const tr=Booth.state.audio.tracks;for(let ti=0;ti<tr.length;ti++){const c=tr[ti].clips.find(c=>c.line);if(c)return [ti,c.at,c.dur]}})()")
    xs = box[0] + (jc[1]+0.2)*60; ys = box[1]+14+jc[0]*LH+6
    await pg.mouse.move(xs, ys); await pg.mouse.down(); await pg.mouse.move(xs+90, ys, steps=5)
    print("ghost:", await pg.evaluate("JSON.stringify(Booth.state.ghost)"))
    await pg.screenshot(path="shots/n-ghost.png"); await pg.mouse.up(); await pg.wait_for_timeout(300)
    print("line now at (small move):", await pg.evaluate("JSON.stringify(Booth.state.audio.tracks.flatMap(t=>t.clips).filter(c=>c.line).map(c=>+c.at.toFixed(2)))"))
    jc = await pg.evaluate("(()=>{const tr=Booth.state.audio.tracks;for(let ti=0;ti<tr.length;ti++){const c=tr[ti].clips.find(c=>c.line);if(c)return [ti,c.at,c.dur]}})()")
    await pg.evaluate("Booth.state.view.pps=20")
    xs = box[0] + (jc[1]+jc[2]/2)*20; ys = box[1]+14+jc[0]*LH+6
    await pg.mouse.move(xs, ys); await pg.mouse.down(); await pg.mouse.move(xs+260, ys, steps=6)
    print("ghost far:", await pg.evaluate("JSON.stringify(Booth.state.ghost)")); await pg.screenshot(path="shots/n-ghost-far.png"); await pg.mouse.up(); await pg.wait_for_timeout(300)
    print("after far move:", await pg.evaluate("JSON.stringify(Booth.state.audio.tracks.map(t=>t.clips.map(c=>[+c.at.toFixed(2),+(c.at+c.dur).toFixed(2),c.line?'J':''])))"))
    # wave setting off hides it
    await pg.evaluate("Store.settings.voiceWave=false"); await pg.keyboard.press("r"); await pg.wait_for_timeout(800)
    print("wave on while off-setting:", await pg.evaluate("document.querySelector('#voice-wave').classList.contains('on')")); await pg.keyboard.press("s"); await pg.wait_for_timeout(800)
    # follower side: Jack records with C marks and sends
    await pg.evaluate("Store.setMe('Jack')"); await pg.wait_for_timeout(1500)
    await pg.evaluate("Booth.state.prerollSec=0")
    await pg.keyboard.press("r"); await pg.wait_for_timeout(1800); await pg.keyboard.press("c"); await pg.wait_for_timeout(1600); await pg.keyboard.press("s"); await pg.wait_for_timeout(1000)
    print("jack cut marks:", await pg.evaluate("Booth.state.audio.markers.filter(m=>m.cut).length"))
    # goals page with some sessions
    await pg.evaluate("Store.setMe('Anne')")
    await pg.evaluate("""(async()=>{const t=new Date();const d=n=>{const x=new Date(t);x.setDate(x.getDate()-n);return x.toISOString().slice(0,10)};
      for(const [who,n,v,w,b] of [['Anne',1,320,9000,2.4],['Anne',2,280,8200,2.1],['Anne',8,410,11000,3],['Anne',40,300,8000,2.2],['Jack',1,150,4000,2],['Jack',3,120,3500,1.8]])
        await Store.saveSession(who,{id:Prep.uid(),person:who,date:d(n),words:w,boothSec:b*3600,recSec:b*3600*0.55,value:v});
      Store.settings.incomeGoals={Anne:60000,Jack:30000};})()""")
    await pg.goto(U+"#/goals"); await pg.wait_for_timeout(1500)
    print("goals rows:", await pg.evaluate("[...document.querySelectorAll('.gl-row')].map(r=>r.innerText.replace(/\\s+/g,' '))"))
    await pg.screenshot(path="shots/n-goals.png", full_page=True)
    await pg.click("[data-who=Anne]"); await pg.wait_for_timeout(800)
    print("Anne goal:", await pg.evaluate("document.querySelector('#gl-goal').value"), "| catch-up:", await pg.evaluate("(document.querySelectorAll('.gl-four')[1]||{}).innerText"))
    await pg.goto(U+"#/library"); await pg.wait_for_timeout(800)
    print("finished dropdown:", await pg.evaluate("[...document.querySelectorAll('summary')].map(s=>s.innerText)"))
    print("ERRORS:", errs); await b.close()
asyncio.run(main()); srv.terminate()
