# Update armed: reads "✓ Updated" while the armed effect matches the panel, "↻ Update armed" after any change.
from _env import *
import asyncio, subprocess, sys
from playwright.async_api import async_playwright
srv = subprocess.Popen([sys.executable,"-m","http.server","8650","-d",ROOT],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
U="http://localhost:8650/index.html?test"
BTN="(document.querySelector('[data-p=\"arm:pitch\"]')||{}).textContent||''"
async def main():
  async with async_playwright() as p:
    br = await p.chromium.launch(executable_path=CHROME, args=["--no-sandbox","--use-fake-ui-for-media-stream","--use-fake-device-for-media-stream"])
    ctx = await br.new_context(viewport={"width":1440,"height":900}); await ctx.add_init_script("try{localStorage.setItem('lr-me','Anne')}catch(e){}")
    pg = await ctx.new_page(); errs=[]; pg.on("pageerror", lambda e: errs.append(str(e))); ERR=[]
    await pg.goto(U+"#/import"); await pg.wait_for_timeout(500)
    await pg.set_input_files("#file",FIX+"/sample.docx"); await pg.wait_for_selector("#create")
    await pg.fill("#it","FX Book"); await pg.click("#create"); await pg.wait_for_selector("table.ch"); await pg.wait_for_function("Store.books.length>0")
    bid = await pg.evaluate("Store.books[0].id")
    await pg.goto(U+f"#/booth/{bid}/1"); await pg.wait_for_selector("#booth-dock"); await pg.wait_for_timeout(800)
    await pg.evaluate("Booth.state.side=null; Booth.state.tab='fx'; Booth._test.act('tools')"); await pg.wait_for_timeout(400)
    await pg.click("[data-p='open:pitch']"); await pg.wait_for_timeout(200)
    print("before arming:", await pg.evaluate(BTN))
    await pg.click("[data-p='arm:pitch']"); await pg.wait_for_timeout(300); a = await pg.evaluate(BTN); print("after arming:", a)
    if a != "✓ Updated": ERR.append("no confirmation after arming")
    await pg.evaluate("(()=>{const r=document.querySelector('[data-pv=\"pitch.semis\"]'); r.value=String(+r.value+1); r.dispatchEvent(new Event('input',{bubbles:true})); r.dispatchEvent(new Event('change',{bubbles:true}));})()"); await pg.wait_for_timeout(300)
    b = await pg.evaluate(BTN); print("after changing a setting:", b)
    if b != "↻ Update armed": ERR.append("didn't go back to Update armed")
    await pg.click("[data-p='arm:pitch']"); await pg.wait_for_timeout(300); c = await pg.evaluate(BTN); print("after updating:", c)
    if c != "✓ Updated": ERR.append("no confirmation after updating")
    print("armed:", await pg.evaluate("JSON.stringify(Booth._test.trackSet()[0].armed)"))
    print("ERR:", ERR); print("ERRORS:", errs); await br.close()
asyncio.run(main()); srv.terminate()
