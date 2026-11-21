from _env import *
import asyncio, subprocess, sys
from playwright.async_api import async_playwright
srv = subprocess.Popen([sys.executable,"-m","http.server","8626","-d",ROOT],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
U="http://localhost:8626/index.html?test"
async def main():
  async with async_playwright() as p:
    b = await p.chromium.launch(executable_path=CHROME, args=["--no-sandbox","--use-fake-device-for-media-stream","--use-fake-ui-for-media-stream"])
    ctx = await b.new_context(permissions=["microphone"], viewport={"width":1440,"height":900}); pg = await ctx.new_page()
    errs=[]; pg.on("pageerror", lambda e: errs.append(str(e))); pg.on("console", lambda m: m.type=="error" and errs.append("console:"+m.text))
    await pg.goto(U+"#/settings"); await pg.wait_for_timeout(700)
    print("labels:", await pg.evaluate("[...document.querySelectorAll('.card h3')].map(h=>h.textContent).filter(t=>/Read|Proof|just/i.test(t))"))
    await pg.select_option("#pcr","manual")
    await pg.goto(U+"#/import"); await pg.wait_for_timeout(500)
    await pg.set_input_files("#file",FIX+"/duet.docx"); await pg.wait_for_selector("#create")
    await pg.fill("#it","Duet"); await pg.click("#create"); await pg.wait_for_selector("table.ch"); await pg.wait_for_function("Store.books.length>0")
    await pg.evaluate("(()=>{const b=Store.books[0]; b.parts=Object.assign({}, b.parts, {n:'Anne', f:'Anne', m:'Jack'}); Store.settings.narrators=[{name:'Anne',pace:4035},{name:'Jack',pace:2000}]; Store.saveBook(b);})()")
    bid = await pg.evaluate("Store.books[0].id")
    await pg.evaluate("localStorage.setItem('lr-me','Jack')"); await pg.goto(U+"#/library"); await pg.wait_for_timeout(300)
    await pg.evaluate("Store.settings.pacer='manual'")
    await pg.goto(U+f"#/booth/{bid}/0"); await pg.wait_for_selector("#booth-dock"); await pg.wait_for_timeout(1000)
    st = await pg.evaluate("(()=>{const B=Booth.state; const p0=B.f.pos, lim=B.f.lim; const ws=B.toks.slice(p0,lim).map(t=>t.w.toLowerCase().replace(/[^a-z']/g,'')); Booth._test.heard(ws); const a=B.f.pos; Booth._test.heard(ws); Booth._test.heard(B.toks.slice(lim,lim+6).map(t=>t.w.toLowerCase().replace(/[^a-z']/g,''))); return {p0,lim,afterSentence:a,afterRereadAndNext:B.f.pos,manual:B.f.manual,atEnd:B.f.atEnd()}})()")
    print("manual pacing:", st, "| button:", await pg.evaluate("(document.querySelector('#fnext')||{}).innerText"))
    await pg.click("#fnext"); await pg.wait_for_timeout(200)
    print("after Next:", await pg.evaluate("[Booth.state.f.pos, Booth.state.f.lim]"), await pg.evaluate("document.querySelector('#fnext').innerText"))
    await pg.screenshot(path=SHOTS+"/fnext.png")
    # record a bit then complete the chapter → Send my lines offered
    await pg.evaluate("Booth.state.prerollSec=0"); await pg.keyboard.press("r"); await pg.wait_for_timeout(1500); await pg.keyboard.press("s"); await pg.wait_for_timeout(700)
    await pg.evaluate("Booth._test.chapterComplete(true)"); await pg.wait_for_timeout(1200)
    print("complete dialog:", await pg.evaluate("[...document.querySelectorAll('.overlay button')].map(b=>b.innerText)"))
    await pg.screenshot(path=SHOTS+"/complete-send.png")
    print("ERRORS:", errs); await b.close()
asyncio.run(main()); srv.terminate()
