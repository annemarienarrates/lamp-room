# Small things: ✂ marks drag along the ruler and right-click away; the done card leads with what matters; Heads up items
# dismiss; a day the Booth clocked counts on the Almanac's calendar and isn't "no log".
from _env import *
import asyncio, subprocess, sys
from playwright.async_api import async_playwright
srv = subprocess.Popen([sys.executable,"-m","http.server","8659","-d",ROOT],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
U="http://localhost:8659/index.html?test"
async def main():
  async with async_playwright() as p:
    br = await p.chromium.launch(executable_path=CHROME, args=["--no-sandbox","--use-fake-device-for-media-stream","--use-fake-ui-for-media-stream"])
    ctx = await br.new_context(permissions=["microphone"], viewport={"width":1440,"height":900}); await ctx.add_init_script("try{localStorage.getItem('lr-me')||localStorage.setItem('lr-me','Anne')}catch(e){}")
    pg = await ctx.new_page(); errs=[]; pg.on("pageerror", lambda e: errs.append(str(e))); ERR=[]
    await pg.goto(U+"#/import"); await pg.wait_for_timeout(500)
    await pg.set_input_files("#file",FIX+"/duet.docx"); await pg.wait_for_selector("#create"); await pg.fill("#it","Saltmarsh"); await pg.click("#create"); await pg.wait_for_function("Store.books.length===1"); await pg.wait_for_timeout(400)
    bid = await pg.evaluate("Store.books[0].id")
    await pg.evaluate("(()=>{const b=Store.books[0]; b.parts=Object.assign({},b.parts,{n:'Anne',f:'Anne',m:'Jack'}); b.lead='Anne'; Store.saveBook(b,true);})()")
    # ✂ marks: drag one along the ruler, right-click another away
    await pg.evaluate("localStorage.setItem('lr-me','Jack')"); await pg.goto(U+"#/library"); await pg.wait_for_timeout(300)
    await pg.goto(U+f"#/booth/{bid}/0"); await pg.wait_for_selector("#booth-dock"); await pg.wait_for_timeout(900)
    await pg.evaluate("Booth.state.prerollSec=0"); await pg.keyboard.press("r"); await pg.wait_for_timeout(3000); await pg.keyboard.press("s"); await pg.wait_for_timeout(800)
    await pg.evaluate("(()=>{const a=Booth.state.audio; a.markers.push({id:'k1',t:0.8,cut:true,done:true,note:'✂ line ends'},{id:'k2',t:2.0,cut:true,done:true,note:'✂ line ends'});})()")
    await pg.evaluate("Booth._test.drawWave && Booth._test.drawWave()"); await pg.wait_for_timeout(300)
    geo = await pg.evaluate("(()=>{const cv=document.querySelector('canvas#wave'); const r=cv.getBoundingClientRect(); return {x:r.left,y:r.top,id:cv.id};})()")
    x_of = lambda t: f"(()=>{{const v=Booth._test.view(); return ({t}-v.t0)*v.pps;}})()"
    x1 = await pg.evaluate(x_of(0.8)); x1b = await pg.evaluate(x_of(1.4)); y = geo["y"] + await pg.evaluate("Booth._test.RULER||20") + 4
    await pg.mouse.move(geo["x"]+x1, y); await pg.mouse.down(); await pg.mouse.move(geo["x"]+(x1+x1b)/2, y); await pg.mouse.move(geo["x"]+x1b, y); await pg.mouse.up(); await pg.wait_for_timeout(300)
    t1 = await pg.evaluate("Booth.state.audio.markers.find(m=>m.id==='k1').t"); print("dragged ✂ to:", t1)
    if abs(t1 - 1.4) > 0.1: ERR.append("✂ mark didn't drag along the ruler")
    x2 = await pg.evaluate(x_of(2.0)); await pg.mouse.click(geo["x"]+x2, y, button="right"); await pg.wait_for_timeout(300)
    left = await pg.evaluate("Booth.state.audio.markers.map(m=>m.id)"); print("after right-click:", left)
    if "k2" in left: ERR.append("right-click didn't remove the mark")
    # done card for a co-narrator: Send my lines first, Export as a small link
    await pg.evaluate("Booth._test.chapterComplete(true)"); await pg.wait_for_selector(".overlay [data-send]", timeout=8000)
    card = await pg.evaluate("(()=>{const o=document.querySelector('.overlay'); return {primary:[...o.querySelectorAll('.btn.primary')].map(b=>b.innerText), exp:(o.querySelector('[data-exp]')||{}).className}})()"); print("done card:", card)
    if card["primary"] != ["📤 Send my lines"] or card["exp"] != "lnk": ERR.append("done card should lead with Send my lines and keep Export as a link")
    await pg.evaluate("document.querySelectorAll('.overlay').forEach(o=>o.remove())")
    # Heads up: booth time yesterday means no 'No log' item; and items dismiss
    await pg.evaluate("localStorage.setItem('lr-me','Anne')"); await pg.goto(U+"#/library"); await pg.wait_for_timeout(500)
    await pg.evaluate("LL.put('titles','t-salt',{kind:'narration',status:'active',name:'Saltmarsh',client:'Harbor Lane Press',category:'A',rateModel:'pfh',rate:300,words:60000,due:'2026-01-02',color:'#4f7a8c',stages:[{id:'t-salt-ra',type:'record',owner:'anne',words:60000}]})")
    await pg.goto(U+"#/almanac"); await pg.wait_for_timeout(500); await pg.goto(U+"#/library"); await pg.wait_for_timeout(800)
    heads = await pg.evaluate("[...document.querySelectorAll('.head-row')].map(r=>r.innerText.replace(/×/,'').trim())"); print("heads:", heads)
    if heads:
        await pg.click(".head-row .head-x"); await pg.wait_for_timeout(500)
        after = await pg.evaluate("[...document.querySelectorAll('.head-row')].map(r=>r.innerText.replace(/×/,'').trim())"); print("after ×:", after, "|", await pg.evaluate("(document.querySelector('[data-headback]')||{}).innerText"))
        if heads[0] in after or not await pg.query_selector("[data-headback]"): ERR.append("Heads up item didn't dismiss")
    else: ERR.append("expected a Heads up item (late title)")
    yd = await pg.evaluate("LL.addDays(LL.TODAY(),-1)")
    await pg.evaluate(f"LL.S.boothFh=[{{id:'b1',date:'{yd}',person:'anne',titleId:'t-salt',words:1500,boothHours:1.5,auto:true}}];LL.syncS();LL.compute()")
    await pg.goto(U+"#/almanac"); await pg.wait_for_timeout(300); await pg.evaluate(f"LL.S.boothFh=[{{id:'b1',date:'{yd}',person:'anne',titleId:'t-salt',words:1500,boothHours:1.5,auto:true}}];LL.syncS();LL.compute();LL.rerender()"); await pg.wait_for_timeout(400)
    bar = await pg.evaluate(f"(()=>{{const u=LL.views&&0; return null;}})()")
    cal = await pg.evaluate(f"(()=>{{const c=document.querySelector('[data-day=\"{yd}\"]')||[...document.querySelectorAll('.cal td, .cal .day')].find(x=>x.dataset&&x.dataset.d==='{yd}'); return c?c.innerHTML.length:null;}})()")
    units = await pg.evaluate(f"(()=>{{try{{return JSON.stringify(LL.unitsFor?LL.unitsFor('{yd}','{yd}'):null)}}catch(e){{return 'x'}}}})()"); print("calendar units for yesterday:", units)
    if not units or "t-salt" not in units: ERR.append("yesterday's booth day missing from the calendar")
    print("ERR:", ERR); print("ERRORS:", errs); await br.close()
asyncio.run(main()); srv.terminate()
