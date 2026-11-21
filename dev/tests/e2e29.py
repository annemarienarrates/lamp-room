from _env import *
import asyncio, subprocess, sys
from playwright.async_api import async_playwright
srv = subprocess.Popen([sys.executable,"-m","http.server","8629","-d",ROOT],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
U="http://localhost:8629/index.html?test"
async def main():
  async with async_playwright() as p:
    b = await p.chromium.launch(executable_path=CHROME, args=["--no-sandbox","--use-fake-device-for-media-stream","--use-fake-ui-for-media-stream"])
    ctx = await b.new_context(permissions=["microphone"], viewport={"width":1440,"height":1000}); pg = await ctx.new_page()
    errs=[]; pg.on("pageerror", lambda e: errs.append(str(e))); pg.on("console", lambda m: m.type=="error" and errs.append("console:"+m.text))
    pg.on("dialog", lambda d: asyncio.ensure_future(d.accept()))
    await pg.goto(U+"#/settings"); await pg.wait_for_timeout(800)
    print("clients:", await pg.evaluate("LRCredits.clients().map(c=>c.name)"))
    await pg.evaluate("(()=>{const S=Store.settings; S.narrators=[{name:'Anne',pace:4035,credit:'Anne Marie Lebeaur'},{name:'Jack',pace:2000,credit:'Rowan Pike'}]; Store.saveSettings();})()")
    await pg.goto(U+"#/import"); await pg.wait_for_timeout(500)
    await pg.set_input_files("#file",FIX+"/duet.docx"); await pg.wait_for_selector("#create")
    await pg.fill("#it","The Earl of Dracumont"); await pg.click("#create"); await pg.wait_for_selector("table.ch"); await pg.wait_for_timeout(500)
    bid = await pg.evaluate("Store.books[0].id")
    await pg.evaluate(f"(()=>{{const b=Store.books[0]; b.author='B.H. Crogen'; b.client='Royal Guard Publishing'; b.due='2026-12-15'; b.parts=Object.assign({{}},b.parts,{{n:'Jack',m:'Jack',f:'Anne'}}); b.credits={{title:'The Earl of Dracumont - Book One',authorYear:'2026'}}; Store.saveBook(b,true);}})()")
    await pg.goto(U+"#/library"); await pg.wait_for_timeout(300); await pg.goto(U+f"#/book/{bid}"); await pg.wait_for_timeout(800)
    await pg.click("#credits summary"); await pg.wait_for_timeout(200)
    print("dbg:", await pg.evaluate(f"(()=>{{const b=Store.books.find(x=>x.id==='{bid}'); return [Store.books.length, b.client, !!LRCredits.clientOf(b), document.querySelector('#credits').innerText.slice(0,200)]}})()"))
    print("preview:\n", await pg.evaluate("document.querySelector('.cr-prev').innerText"))
    await pg.click("#crapply"); await pg.wait_for_timeout(500)
    print("chapters:", await pg.evaluate("Store.books[0].chapters.map(c=>(c.included?'':'(x)')+c.title)"))
    names = await pg.evaluate("(()=>{const b=Store.books[0]; return b.chapters.map((c,i)=>LRExport.fileName('{seq}_{name}',b,c,i))})()")
    print("file names:", names)
    # full cast: guild + tags
    await pg.evaluate("(()=>{const b=Store.books[0]; b.credits.performedBy='the NPC Audiobook Guild'; b.credits.cast=[{name:'Rowan Pike',as:'The Narrator and Boone',reader:'Jack'},{name:'Anne Marie Lebeaur',as:'Dottie and the System',reader:'Anne'}]; Store.saveBook(b,true);})()")
    await pg.goto(U+"#/library"); await pg.goto(U+f"#/book/{bid}"); await pg.wait_for_timeout(600)
    await pg.evaluate("document.querySelector('#credits').open=true"); await pg.click("#crapply"); await pg.wait_for_timeout(500)
    print("closing:", await pg.evaluate("JSON.stringify(Store.books[0].chapters.find(c=>c.credits==='close').paras.slice(-3))"))
    await pg.screenshot(path=SHOTS+"/credits.png", full_page=False)
    await pg.goto(U+f"#/booth/{bid}/0"); await pg.wait_for_selector("#booth-dock"); await pg.wait_for_timeout(800)
    print("booth chapter:", await pg.evaluate("Booth.state.chap.title"), "| export name:", await pg.evaluate("(()=>{Booth._test.exportDialog(); return document.querySelector('#xname') && document.querySelector('#xname').value})()"))
    print("ERRORS:", errs); await b.close()
asyncio.run(main()); srv.terminate()
