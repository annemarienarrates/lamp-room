from _env import *
import asyncio, subprocess, sys
from playwright.async_api import async_playwright
srv = subprocess.Popen([sys.executable,"-m","http.server","8632","-d",ROOT],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
U="http://localhost:8632/index.html?test"
TILES="[...document.querySelectorAll('.tiles .tile')].map(t=>t.innerText.replace(/\\n+/g,' ')).join(' || ')"
async def main():
  async with async_playwright() as p:
    b = await p.chromium.launch(executable_path=CHROME, args=["--no-sandbox"])
    pg = await (await b.new_context(viewport={"width":1440,"height":900})).new_page()
    errs=[]; pg.on("pageerror", lambda e: errs.append(str(e))); pg.on("console", lambda m: m.type=="error" and errs.append("console:"+m.text))
    await pg.goto(U+"#/import"); await pg.wait_for_timeout(500)
    await pg.set_input_files("#file",FIX+"/duet.docx"); await pg.wait_for_selector("#create")
    await pg.fill("#it","Cast Book"); await pg.click("#create"); await pg.wait_for_selector("table.ch"); await pg.wait_for_timeout(400)
    bid = await pg.evaluate("Store.books[0].id")
    await pg.evaluate("(()=>{const b=Store.books[0]; b.parts=Object.assign({}, b.parts, {n:'Cast 1', f:'Anne', m:'Jack'}); b.rate={type:'pfh',amount:200}; Store.saveBook(b,true);})()")
    await pg.wait_for_timeout(8000)
    t = await pg.evaluate("JSON.stringify(LL.tById(Store.books[0].titleId).stages.filter(s=>s.type==='record').map(s=>[s.owner,s.words]))"); print("planner after parts:", t)
    await pg.goto(U+"#/library"); await pg.goto(U+f"#/book/{bid}"); await pg.wait_for_timeout(700)
    print("tiles:", await pg.evaluate(TILES))
    await pg.goto(U+"#/library"); await pg.wait_for_timeout(700)
    print("card:", (await pg.evaluate("[...document.querySelectorAll('.project-card')].map(c=>c.innerText.replace(/\\n+/g,' | ')).join(' ## ')"))[:400])
    await pg.evaluate("(()=>{const b=Store.books[0]; b.parts.m='Cast 2'; Store.saveBook(b,true);})()"); await pg.wait_for_timeout(8000)
    print("planner after Jack's lines go to Cast 2:", await pg.evaluate("JSON.stringify(LL.tById(Store.books[0].titleId).stages.filter(s=>s.type==='record').map(s=>[s.owner,s.words]))"))
    # editor
    await pg.evaluate("(()=>{const b=Store.books[0]; b.shared=true; b.sharedOwner='Anne'; b.sharedPeople=[{name:'Anne',role:'lead'},{name:'Eddie',role:'editor'}]; Store.settings.narrators.push({name:'Eddie',pace:1}); Store.saveBook(b,true);})()")
    await pg.evaluate("localStorage.setItem('lr-me','Eddie')"); await pg.goto(U+"#/library"); await pg.goto(U+f"#/book/{bid}"); await pg.wait_for_timeout(800)
    print("editor tiles:", await pg.evaluate(TILES))
    print("ERRORS:", errs); await b.close()
asyncio.run(main()); srv.terminate()
