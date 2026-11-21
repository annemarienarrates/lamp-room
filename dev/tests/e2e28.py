from _env import *
import asyncio, subprocess, sys
from playwright.async_api import async_playwright
srv = subprocess.Popen([sys.executable,"-m","http.server","8628","-d",ROOT],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
U="http://localhost:8628/index.html?test"
async def main():
  async with async_playwright() as p:
    b = await p.chromium.launch(executable_path=CHROME, args=["--no-sandbox","--use-fake-device-for-media-stream","--use-fake-ui-for-media-stream","--autoplay-policy=no-user-gesture-required"])
    ctx = await b.new_context(permissions=["microphone"], viewport={"width":1440,"height":900}); pg = await ctx.new_page()
    errs=[]; pg.on("pageerror", lambda e: errs.append(str(e))); pg.on("console", lambda m: m.type=="error" and errs.append("console:"+m.text))
    pg.on("dialog", lambda d: asyncio.ensure_future(d.accept("Brannigan")))
    async def mk(title, series):
      await pg.goto(U+"#/import"); await pg.wait_for_timeout(500)
      await pg.set_input_files("#file",FIX+"/duet.docx"); await pg.wait_for_selector("#create")
      await pg.fill("#it",title); await pg.click("#create"); await pg.wait_for_selector("table.ch"); await pg.wait_for_timeout(400)
      bid = await pg.evaluate(f"Store.books.find(b=>b.title==='{title}').id")
      await pg.evaluate(f"(()=>{{const b=Store.books.find(x=>x.id==='{bid}'); b.series='{series}'; Store.saveBook(b,true);}})()")
      return bid
    b1 = await mk("Book One","Space Saga"); b2 = await mk("Book Two","Space Saga")
    await pg.goto(U+f"#/booth/{b1}/0"); await pg.wait_for_selector("#booth-dock"); await pg.wait_for_timeout(1000)
    w = await pg.evaluate("(()=>{const B=Booth.state; const i=B.toks.findIndex(t=>/^Mara/.test(t.w)); return [i,B.toks[i]&&B.toks[i].w]})()"); print("name in text:", w)
    # double-click the name: the pop offers Add
    await pg.dblclick(f"#ms .w[data-i='{w[0]}']"); await pg.wait_for_timeout(400)
    print("pop:", await pg.evaluate("[...document.querySelectorAll('#part-pop [data-char]')].map(b=>b.innerText)"))
    await pg.click("#part-pop [data-char]"); await pg.wait_for_timeout(600)
    await pg.fill(".ch-card [data-cf='desc']","Ship's captain, steel-backed"); await pg.dispatch_event(".ch-card [data-cf='desc']","change")
    await pg.fill(".ch-card [data-cf='aka']","the Captain, Cap"); await pg.dispatch_event(".ch-card [data-cf='aka']","change"); await pg.wait_for_timeout(300)
    # record a bit, arm pitch on track 1 FX, save FX to the card, take a sample from the take
    await pg.evaluate("Booth.state.prerollSec=0"); await pg.keyboard.press("r"); await pg.wait_for_timeout(1500); await pg.keyboard.press("s"); await pg.wait_for_timeout(800)
    await pg.evaluate("(()=>{const ts=Booth._test.trackSet(); ts[0].armed=[{k:'pitch',p:{semis:5,cents:0}}];})()")
    await pg.evaluate("Booth.state.selTake={ti:0,ci:0}")
    await pg.click(".ch-card [data-c='grab']"); await pg.wait_for_timeout(300)
    await pg.click(".ch-card [data-c='smsel']"); await pg.wait_for_timeout(800)
    print("card:", await pg.evaluate("(document.querySelector('.ch-card')||{}).innerText"))
    await pg.screenshot(path=SHOTS+"/chars.png")
    # Book Two (same series): the guide carries over; arm on track
    await pg.goto(U+"#/library"); await pg.wait_for_timeout(300)
    await pg.goto(U+f"#/booth/{b2}/0"); await pg.wait_for_selector("#booth-dock"); await pg.wait_for_timeout(1000)
    await pg.click(".bd-chars-tab"); await pg.wait_for_timeout(600)
    print("book two in this chapter:", await pg.evaluate("[...document.querySelectorAll('.ch-row b, .ch-name')].map(e=>e.innerText||e.value)"))
    await pg.click(".ch-row"); await pg.wait_for_timeout(300); await pg.click(".ch-card [data-c='arm']"); await pg.wait_for_timeout(300)
    print("track 1 now:", await pg.evaluate("JSON.stringify(Booth._test.trackSet()[0].armed)+' '+Booth._test.trackSet()[0].name"))
    print("ERRORS:", errs); await b.close()
asyncio.run(main()); srv.terminate()
