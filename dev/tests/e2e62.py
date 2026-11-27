# The Effects bench (Tools page): voices from saved presets and from my tracks in a book, clips read at their own rate,
# depth and channels, the effect (with its tail) baked in, name-fx.wav back; the calculator is unaffected; the Booth's
# "Process clips…" opens it with that book and track chosen.
from _env import *
import asyncio, subprocess, sys
from playwright.async_api import async_playwright
srv = subprocess.Popen([sys.executable,"-m","http.server","8662","-d",ROOT],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
U="http://localhost:8662/index.html?test"
MK = """((rate,bits,nc,secs,name)=>{const n=Math.round(rate*secs),ch=[];for(let c=0;c<nc;c++){const x=new Float32Array(n);for(let i=0;i<n;i++)x[i]=0.3*Math.sin(2*Math.PI*(220+c*110)*i/rate)*(i<n*0.6?1:0);ch.push(x)}
  return new File([LRBench.wav({ch,rate,bits})],name,{type:'audio/wav'})})"""
async def main():
  async with async_playwright() as p:
    br = await p.chromium.launch(executable_path=CHROME, args=["--no-sandbox"])
    ctx = await br.new_context(viewport={"width":1440,"height":900}, accept_downloads=True); await ctx.add_init_script("try{localStorage.getItem('lr-me')||localStorage.setItem('lr-me','Anne')}catch(e){}")
    pg = await ctx.new_page(); errs=[]; pg.on("pageerror", lambda e: errs.append(str(e))); ERR=[]
    await pg.goto(U+"#/import"); await pg.wait_for_timeout(500)
    await pg.set_input_files("#file",FIX+"/duet.docx"); await pg.wait_for_selector("#create"); await pg.fill("#it","Tidewater"); await pg.click("#create"); await pg.wait_for_function("Store.books.length===1"); await pg.wait_for_timeout(400)
    bid = await pg.evaluate("Store.books[0].id")
    await pg.evaluate("""(()=>{const b=Store.books[0]; b.trackSet={Anne:[{name:'Anne',vol:0},{name:'Announcer',vol:0,armed:[{k:'reverb',p:{decay:1.6,damp:40,pre:20,mix:40}},{k:'place',p:{type:'radio',mix:100}}]}]}; Store.saveBook(b,true);
      Store.settings.fxPresets={'Very Deep':{armed:[{k:'pitch',p:{semis:-4,cents:0}}]}};})()""")
    await pg.goto(U+"#/calc"); await pg.wait_for_selector("#bench .bench"); await pg.wait_for_timeout(300)
    opts = await pg.evaluate("[...document.querySelectorAll('#bn-fx option')].map(o=>o.textContent)"); print("presets only:", opts)
    if opts != ["Preset · Very Deep"]: ERR.append("with no book, only presets")
    await pg.select_option("#bn-book", bid); await pg.wait_for_timeout(200)
    opts = await pg.evaluate("[...document.querySelectorAll('#bn-fx option')].map(o=>o.value+'|'+o.textContent)"); print("with the book:", opts)
    if not any(o.startswith("t1|Announcer") for o in opts) or any(o.startswith("t0|") for o in opts): ERR.append("the book's tracks with effects should be offered (and only those)")
    await pg.select_option("#bn-fx", "t1"); await pg.wait_for_timeout(200)
    # the calculator still works and didn't swallow the bench's selects
    w0 = await pg.evaluate("document.querySelector('#calc .tiles').innerText"); await pg.fill("#cw","50000"); await pg.dispatch_event("#cw","change"); await pg.wait_for_timeout(300)
    if w0 == await pg.evaluate("document.querySelector('#calc .tiles').innerText"): ERR.append("calculator stopped updating")
    if await pg.evaluate("document.querySelector('#bn-fx').value") != "t1": ERR.append("bench choice lost after a calculator change")
    # two clips: 44.1 kHz 16-bit stereo, and 48 kHz 24-bit mono
    await pg.evaluate(f"LRBench.add([{MK}(44100,16,2,1.5,'ann_001.wav'),{MK}(48000,24,1,2,'ann_002.wav')])"); await pg.wait_for_timeout(800)
    rows = await pg.evaluate("[...document.querySelectorAll('.bn-row .bn-name')].map(r=>r.innerText.replace(/\\n/g,' | '))"); print("rows:", rows)
    if len(rows) != 2 or "44.1 kHz · 16-bit · stereo" not in rows[0] or "48 kHz · 24-bit" not in rows[1]: ERR.append("clip details")
    await pg.screenshot(path="/tmp/bench.png", full_page=True)
    async with pg.expect_download() as dl:
      await pg.click("#bn-go")
    d = await dl.value; print("download:", d.suggested_filename)
    if d.suggested_filename != "clips-fx.zip": ERR.append("two clips should download as one zip")
    res = await pg.evaluate("""(async()=>{const out=LRBench.state.out; const r=[]; for(const o of out){const f=new File([o.blob],o.name); const h=await LRAudio.wavInfo(f); const a=await LRBench.read(f); r.push([o.name,h.rate,h.bits,h.ch,+(a.ch[0].length/h.rate).toFixed(2)]);} return r;})()""")
    print("out:", res)
    if [r[:4] for r in res] != [["ann_001-fx.wav",44100,16,2],["ann_002-fx.wav",48000,24,1]]: ERR.append("names, rates, depths or channels not kept")
    if not (res[0][4] > 1.5 and res[1][4] > 2.0): ERR.append("reverb tail should make the clips a little longer")
    diff = await pg.evaluate("""(async()=>{const o=LRBench.state.out[1]; const a=await LRBench.read(new File([o.blob],o.name)); let d=0; for(let i=0;i<48000;i++){const x=0.3*Math.sin(2*Math.PI*220*i/48000); d+=Math.abs(a.ch[0][i]-x);} return d/48000;})()""")
    print("difference from dry:", round(diff,3))
    if diff < 0.02: ERR.append("the effect wasn't applied")
    # the Booth's shortcut
    await pg.goto(U+f"#/booth/{bid}/0"); await pg.wait_for_selector("#booth-dock"); await pg.wait_for_timeout(800)
    await pg.evaluate("Booth.state.side='tools';Booth.state.tab='fx';Booth.state.fxTrack=1;Booth._test.renderSide()"); await pg.wait_for_timeout(300)
    if not await pg.query_selector("[data-p=bench]"): ERR.append("Booth ▸ Effects should have Process clips…")
    else:
      await pg.click("[data-p=bench]"); await pg.wait_for_selector("#bench .bench"); await pg.wait_for_timeout(400)
      st = await pg.evaluate("[location.hash, document.querySelector('#bn-book').value, document.querySelector('#bn-fx').value]"); print("from the Booth:", st)
      if st[1] != bid or st[2] != "t1": ERR.append("Process clips… should open with that book and track")
    print("ERR:", ERR); print("ERRORS:", errs); await br.close()
asyncio.run(main()); srv.terminate()
