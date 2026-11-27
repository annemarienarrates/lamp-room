# The Proofing desk (Tools page): a proof job from a pasted manuscript, chapter audio brought in, proofed (the listening is
# faked here), flags reviewed (Pickup with an issue and a note, Ignore, Ignore a word everywhere, your own pickup), the
# chapter's pickups copied as rows for a sheet, everything still there after a reload, and the job deleted.
from _env import *
import asyncio, subprocess, sys
from playwright.async_api import async_playwright
srv = subprocess.Popen([sys.executable,"-m","http.server","8663","-d",ROOT],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
U="http://localhost:8663/index.html?test"
TEXT = "Chapter One\\n\\nThe moon rose over Kaelthas and the wolves began to sing. Mira pulled her cloak tight against the cold wind. Kaelthas was silent.\\n\\nChapter Two\\n\\nMorning came slowly to the valley. Nobody spoke of the night before, not even old Bren."
MOCK = """(()=>{ LRProof.load = async()=>({}); LRProof._mockTimed = (x, rate) => { const s = x.length/rate;
  if (s < 15) return [{text:'The moon rose over Kale thoss and the wolves began to sing. Mira pulled her cloak against the cold wind.', t:[0,7]},{text:'Kale thoss was silent.', t:[7,9]}];
  return [{text:'Morning came really slowly to the valley. Nobody spoke of the night before, not even old Bren.', t:[0,12]}]; }; })()"""
WAV = """((secs,name)=>{const r=16000,x=new Float32Array(r*secs);for(let i=0;i<x.length;i++)x[i]=0.2*Math.sin(i/9);return new File([LRBench.wav({ch:[x],rate:r,bits:16})],name,{type:'audio/wav'})})"""
async def main():
  async with async_playwright() as p:
    br = await p.chromium.launch(executable_path=CHROME, args=["--no-sandbox"])
    ctx = await br.new_context(viewport={"width":1440,"height":1000}); await ctx.add_init_script("try{localStorage.getItem('lr-me')||localStorage.setItem('lr-me','Anne')}catch(e){}")
    await ctx.grant_permissions(["clipboard-read","clipboard-write"], origin="http://localhost:8663")
    pg = await ctx.new_page(); errs=[]; pg.on("pageerror", lambda e: errs.append(str(e))); pg.on("dialog", lambda d: asyncio.ensure_future(d.accept())); ERR=[]
    await pg.goto(U+"#/calc"); await pg.wait_for_selector("#pdesk .pdesk"); await pg.wait_for_timeout(500)
    await pg.fill("#pd-name", "SAB1 proof")
    await pg.evaluate("document.querySelector('.pd-new details').open=true")
    await pg.fill("#pd-paste", TEXT.replace("\\n","\n")); await pg.click("#pd-usepaste"); await pg.wait_for_selector("#pd-create")
    found = await pg.inner_text(".pd-new p"); print("split:", found)
    if "2 of 2 chapters" not in found: ERR.append("the manuscript should split into two chapters")
    await pg.click("#pd-create"); await pg.wait_for_selector(".pd-chs")
    if await pg.evaluate("Store.books.length") != 0: ERR.append("a proof job must not make a title or book")
    await pg.evaluate(MOCK)
    await pg.evaluate(f"(async()=>{{await LRProofDesk.attach(0,{WAV}(10,'01 Chapter One.wav'));await LRProofDesk.attach(1,{WAV}(20,'02 Chapter Two.wav'));LRProofDesk.state.job&&0}})()")
    await pg.evaluate("(async()=>{const S=LRProofDesk.state; await LRProofDesk.runQueue([0,1]);})()"); await pg.wait_for_timeout(1500)
    st = await pg.evaluate("[...document.querySelectorAll('.pd-chs tr')].map(r=>r.innerText.replace(/\\s+/g,' '))"); print("chapters:", st)
    fl = await pg.evaluate("LRProofDesk.state.job.chapters.map(c=>c.flags.map(f=>f.kind+':'+f.text+'|'+f.heard+'@'+f.t))"); print("flags:", fl)
    k0 = [f.split(":")[0] for f in fl[0]]; k1 = [f.split(":")[0] for f in fl[1]]
    if k0.count("misread") != 2 or "missed" not in k0: ERR.append("chapter one should flag both Kaelthas and the skipped 'tight'")
    if k1 != ["extra"]: ERR.append("chapter two should flag the added 'really'")
    # review chapter one
    await pg.click("[data-pd='review:0']"); await pg.wait_for_selector(".pd-review")
    await pg.screenshot(path="/tmp/pdesk.png", full_page=True)
    ids = await pg.evaluate("LRProofDesk.state.job.chapters[0].flags.map(f=>f.id+'|'+f.kind)"); miss = [i.split("|")[0] for i in ids if i.endswith("missed")][0]
    await pg.click(f"[data-sel='{[i.split('|')[0] for i in ids].index(miss)}']"); await pg.wait_for_timeout(200)
    await pg.click(f"[data-pd='pick:{miss}']"); await pg.wait_for_timeout(200)
    await pg.select_option(f"[data-pd-issue='{miss}']", "Skipped"); await pg.fill(f"[data-pd-note='{miss}']", "Keep 'tight'"); await pg.press(f"[data-pd-note='{miss}']", "Enter"); await pg.wait_for_timeout(300)
    print("note saved:", await pg.evaluate(f"LRProofDesk.state.job.chapters[0].flags.find(f=>f.id==='{miss}').note"))
    mis = [i.split("|")[0] for i in ids if i.endswith("misread")][0]
    await pg.click(f"[data-sel='{[i.split('|')[0] for i in ids].index(mis)}']"); await pg.wait_for_timeout(200)
    await pg.click(f"[data-pd='ignw:{mis}']"); await pg.wait_for_timeout(300)
    states = await pg.evaluate("LRProofDesk.state.job.chapters[0].flags.map(f=>f.kind+':'+f.state)"); print("after review:", states)
    if sorted(states) != sorted(["misread:ignored","missed:pickup","misread:ignored"]): ERR.append("ignoring Kaelthas everywhere should clear both of its flags")
    # my own pickup: double-click 'wolves'
    await pg.dblclick(".pd-text .w[data-i='9']"); await pg.wait_for_timeout(300)
    nid = await pg.evaluate("LRProofDesk.state.job.chapters[0].flags.find(f=>f.manual)?.id")
    if not nid: ERR.append("double-click should add a pickup")
    else: await pg.select_option(f"[data-pd-issue='{nid}']", "Performance"); await pg.fill(f"[data-pd-note='{nid}']", "Breath noise"); await pg.press(f"[data-pd-note='{nid}']", "Enter"); await pg.wait_for_timeout(300)
    # copy for the sheet
    await pg.click("[data-pd='copy:0']"); await pg.wait_for_timeout(300)
    clip = await pg.evaluate("navigator.clipboard.readText()"); print("clipboard:\n" + clip)
    rows = [r.split("\t") for r in clip.split("\n")]
    if len(rows) != 2 or any(len(r) != 5 for r in rows): ERR.append("two pickups, five columns each")
    else:
      sk = [r for r in rows if "[tight]" in r[2]]; own = [r for r in rows if "[wolves]" in r[2]]
      if not (sk and sk[0][0] == "Chapter One" and sk[0][1].count(":") == 2 and sk[0][3] == "Skipped" and sk[0][4] == "Keep 'tight'" and sk[0][2].startswith("Mira")): ERR.append("skipped row wrong")
      if not (own and own[0][3] == "Performance" and own[0][4] == "Breath noise" and not own[0][2].startswith("Chapter")): ERR.append("own pickup row wrong")
    # keys: J moves, I ignores
    await pg.click("[data-pd='review:1']"); await pg.wait_for_timeout(300); await pg.keyboard.press("i"); await pg.wait_for_timeout(300)
    if await pg.evaluate("LRProofDesk.state.job.chapters[1].flags[0].state") != "ignored": ERR.append("I should ignore the flag")
    # it all survives a reload
    await pg.reload(); await pg.wait_for_selector("#pdesk .pd-job"); jobs = await pg.inner_text("#pdesk .pd-jobs"); print("after reload:", jobs.replace("\n"," | "))
    if "SAB1 proof" not in jobs or "2 reviewed" not in jobs or "2 pickups" not in jobs: ERR.append("the job should be saved with its review")
    await pg.click(".pd-job"); await pg.wait_for_selector(".pd-chs"); await pg.click("[data-pd='delete']"); await pg.wait_for_timeout(800)
    # front matter the splitter took for chapters: leave it out, and the audio pairs past it; Re-pair fixes audio already in
    await pg.evaluate("LRProofDesk.state.form=null"); await pg.fill("#pd-name","Front matter")
    await pg.evaluate("document.querySelector('.pd-new details').open=true")
    filler = " ".join(["The wind moved through the long grass and the river ran on toward the sea."] * 6)
    await pg.fill("#pd-paste", "\n\n".join(["Chapter 1", "Sunfire Academy. " + filler, "Chapter 2", "Copyright 2026 by Nobody. " + filler, "Chapter 3", "The moon rose. " + filler, "Chapter 4", "Morning came. " + filler])); await pg.click("#pd-usepaste"); await pg.wait_for_selector("#pd-split"); await pg.select_option("#pd-split", label="“Chapter / Prologue / Part…” lines"); await pg.wait_for_selector("[data-pd-in='1']")
    await pg.uncheck("[data-pd-in='1']"); await pg.wait_for_timeout(200)
    if "3 of 4 chapters in" not in await pg.inner_text(".pd-new"): ERR.append("unticking should leave a chapter out before creating")
    await pg.click("#pd-create"); await pg.wait_for_selector(".pd-chs")
    await pg.evaluate(f"LRProofDesk.attachMany([{WAV}(3,'002_Chapter_01.mp3'.replace('.mp3','.wav')),{WAV}(3,'003_Chapter_02.wav'),{WAV}(3,'004_Chapter_03.wav')])"); await pg.wait_for_timeout(800)
    pair = await pg.evaluate("LRProofDesk.state.job.chapters.map(c=>c.title+'='+(c.audio?c.audio.name:'-')+(c.skip?' (out)':''))"); print("paired:", pair)
    if pair != ["Chapter 1=002_Chapter_01.wav","Chapter 2=- (out)","Chapter 3=003_Chapter_02.wav","Chapter 4=004_Chapter_03.wav"]: ERR.append("audio should skip a chapter that's left out")
    await pg.click("[data-pd='skip:0']"); await pg.wait_for_timeout(300)
    await pg.click("[data-pd='repair']"); await pg.wait_for_timeout(600)
    pair = await pg.evaluate("LRProofDesk.state.job.chapters.map(c=>c.title+'='+(c.audio?c.audio.name:'-')+(c.skip?' (out)':''))"); print("re-paired:", pair)
    if pair != ["Chapter 1=- (out)","Chapter 2=- (out)","Chapter 3=002_Chapter_01.wav","Chapter 4=003_Chapter_02.wav"]: ERR.append("Re-pair should move the audio onto the chapters that are in")
    rows = await pg.evaluate("[...document.querySelectorAll('.pd-chs tr')].map(r=>r.className+':'+r.innerText.replace(/\\s+/g,' ').slice(0,60))"); print(rows)
    if await pg.evaluate("(async()=>(await LRProofDesk.listJobs()).filter(j=>j.name==='SAB1 proof').length)()") != 0: ERR.append("delete should remove the job")
    print("ERR:", ERR); print("ERRORS:", errs); await br.close()
asyncio.run(main()); srv.terminate()
