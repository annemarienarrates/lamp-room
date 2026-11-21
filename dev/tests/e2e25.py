from _env import *
import asyncio, subprocess, sys, json
from playwright.async_api import async_playwright
srv = subprocess.Popen([sys.executable,"-m","http.server","8625","-d",ROOT],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
U="http://localhost:8625/index.html?test"
FILE = lambda path, name: f"(async()=>{{const b=await (await fetch('/dev/fixtures/{path}')).blob();return new File([b],'{name}');}})()"
async def main():
  async with async_playwright() as p:
    b = await p.chromium.launch(executable_path=CHROME, args=["--no-sandbox","--use-fake-device-for-media-stream","--use-fake-ui-for-media-stream","--autoplay-policy=no-user-gesture-required"])
    ctx = await b.new_context(permissions=["microphone"], viewport={"width":1440,"height":900}); pg = await ctx.new_page()
    errs=[]; pg.on("pageerror", lambda e: errs.append(str(e))); pg.on("console", lambda m: m.type=="error" and errs.append("console:"+m.text))
    await pg.goto(U+"#/import"); await pg.wait_for_timeout(500)
    await pg.set_input_files("#file",FIX+"/cast.docx"); await pg.wait_for_selector("#create")
    for k,v in [("c:cyan","Jack"),("c:magenta","Cast 1"),("c:yellow","Cast 2"),("c:green","Cast 3"),("c:darkCyan","Cast 4")]:
      await pg.select_option(f"[data-ipart='{k}']", v)
    await pg.fill("#it","Cast Test"); await pg.click("#create"); await pg.wait_for_timeout(1300)
    bid = await pg.evaluate("Store.books.find(b=>b.title==='Cast Test').id")
    await pg.goto(U+f"#/booth/{bid}/0"); await pg.wait_for_timeout(1500)
    print("tool tabs:", await pg.evaluate("(()=>{Booth.state.side=null;Booth._test.act('tools');return [...document.querySelectorAll('.bd-tabsel option')].map(o=>o.text)})()"))
    # the "listening" is faked: stretch 0 = line 0, stretch 1 = line 0 again (a retake), stretch 2 = line 2 (line 1 skipped), the rest noise
    await pg.evaluate("""(()=>{const R=Booth._test.runsIn(Booth.state.chap).filter(x=>x.r==='Cast 1'); window._n=0;
      LRProof._mock = async ()=>{ const k=window._n++; return k===0?R[0].text:k===1?R[0].text:k===2?R[2].text:'um'; }; })()""")
    r = await pg.evaluate(f"(async()=>Booth._test.castDrop('Cast 1', await {FILE('cast1_pauses.wav','c1p.wav')}, false))()")
    print("drop:", r, "| listened to", await pg.evaluate("window._n"), "stretches")
    print("lines:", await pg.evaluate("JSON.stringify(Booth.state.audio.duet['Cast 1'].lines.map(l=>[l.from,l.n]))"), "| missing:", await pg.evaluate("JSON.stringify(Booth.state.audio.duet['Cast 1'].missing)"))
    print("runs:", await pg.evaluate("JSON.stringify(Booth._test.runsIn(Booth.state.chap).filter(x=>x.r==='Cast 1').map(x=>x.from))"))
    await pg.evaluate("Booth.state.side=null; Booth.state.tab='duet'; Booth._test.act('tools')"); await pg.wait_for_timeout(300)
    print("panel:", await pg.evaluate("(document.querySelector('.bd-sec.recut')||{}).innerText"))
    await pg.click("[data-p^='miss']"); await pg.wait_for_timeout(500)
    print("pickups asked:", await pg.evaluate("JSON.stringify(Store.pickupReqs(Booth.state.book).map(q=>[q.to,q.w0,q.note]))"))
    # assemble: Anne isn't the narrator in this book?
    print("narrator:", await pg.evaluate("Prep.readerOf('n',Booth.state.chap,Booth.state.book)"))
    await pg.evaluate("Booth.state.book.parts.n='Cast 4'; Booth.state.side=null; Booth.state.tab='orig'; Booth._test.act('tools')"); await pg.wait_for_timeout(300)
    await pg.click("[data-p='asmon']"); await pg.wait_for_timeout(1200)
    print("assembling:", await pg.evaluate("[Booth.state.assembling, Booth.state.readingAs, document.querySelector('.sb-as').innerText, Booth._test.amLead(), Booth._test.theirRuns().length]"))
    await pg.evaluate("Booth.state.side=null; Booth.state.tab='orig'; Booth._test.act('tools')"); await pg.wait_for_timeout(300)
    await pg.click("[data-p='asmoff']"); await pg.wait_for_timeout(1200)
    print("back:", await pg.evaluate("[Booth.state.assembling, Booth.state.readingAs]"))
    print("ERRORS:", errs); await b.close()
asyncio.run(main()); srv.terminate()
