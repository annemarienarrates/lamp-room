# In a shared project, notes to the Lead travel through the shared folder (Asks/), and Done comes back the same way.
from _env import *
import asyncio, subprocess, sys
from playwright.async_api import async_playwright
srv = subprocess.Popen([sys.executable,"-m","http.server","8648","-d",ROOT],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
U="http://localhost:8648/index.html?test"
SHARE = "(async()=>{ const b=Store.books[0]; Store.sharedOpen[b.id] = await Store.root.getDirectoryHandle('FakeShared',{create:true}); })()"
async def main():
  async with async_playwright() as p:
    br = await p.chromium.launch(executable_path=CHROME, args=["--no-sandbox"])
    ctx = await br.new_context(viewport={"width":1440,"height":900}); await ctx.add_init_script("try{if(!localStorage.getItem('lr-me'))localStorage.setItem('lr-me','Anne')}catch(e){}")
    pg = await ctx.new_page(); errs=[]; pg.on("pageerror", lambda e: errs.append(str(e))); ERR=[]
    await pg.goto(U+"#/import"); await pg.wait_for_timeout(500)
    await pg.set_input_files("#file",FIX+"/duet.docx"); await pg.wait_for_selector("#create")
    await pg.fill("#it","Shared Book"); await pg.click("#create"); await pg.wait_for_selector("table.ch"); await pg.wait_for_function("Store.books.length>0")
    bid = await pg.evaluate("Store.books[0].id")
    await pg.evaluate("(()=>{const b=Store.books[0]; b.shared=true; b.sharedOwner='Anne'; b.sharedPeople=[{name:'Anne',role:'lead'},{name:'Mira Hale',role:'narrator'}]; Store.saveBook(b,true);})()")
    await pg.evaluate(SHARE)
    # a co-narrator asks
    await pg.evaluate("Store.setMe('Mira')"); await pg.goto(U+"#/library"); await pg.evaluate(SHARE); await pg.goto(U+f"#/book/{bid}"); await pg.wait_for_selector("#askLead")
    await pg.click("#askLead"); await pg.fill("#aktx","Ch 2 has a page turn at 3:10."); await pg.click("#akgo"); await pg.wait_for_timeout(800)
    f = await pg.evaluate("(async()=>{const d=await (await Store.root.getDirectoryHandle('FakeShared')).getDirectoryHandle('Asks'); const out={}; for await (const [n,h] of d.entries()) out[n]=await (await h.getFile()).text(); return out;})()")
    print("in the shared folder:", {k: v[:60] for k, v in f.items()})
    if not any("page turn" in v for v in f.values()): ERR.append("ask not written to the shared folder")
    # Anne's Lamp Room only knows what's in the shared folder: forget the local copy
    await pg.evaluate("Store.setMe('Anne'); delete Store.books[0].asks")
    await pg.goto(U+"#/library"); await pg.evaluate(SHARE); await pg.goto(U+f"#/book/{bid}"); await pg.wait_for_selector(".lead-bar"); await pg.wait_for_timeout(1200)
    bar = await pg.inner_text(".lead-bar"); print("Anne sees:", bar.replace("\n"," ")[-140:])
    if "page turn" not in bar: ERR.append("Lead doesn't see the co-narrator's ask")
    await pg.click("[data-askdone]"); await pg.wait_for_timeout(800)
    done = await pg.evaluate("(async()=>{const d=await (await Store.root.getDirectoryHandle('FakeShared')).getDirectoryHandle('Asks'); return await (await (await d.getFileHandle('_done.json')).getFile()).text();})()")
    print("done file:", done)
    if done == "[]": ERR.append("done not written back")
    # the co-narrator's copy doesn't have Anne's asksDone: it learns from the shared folder
    await pg.evaluate("Store.setMe('Mira'); Store.books[0].asksDone=[]; Store.books[0].asks={Mira:[{id:JSON.parse('"+done.replace('"','\\"')+"')[0],at:new Date().toISOString(),text:'Ch 2 has a page turn at 3:10.'}]}")
    await pg.goto(U+"#/library"); await pg.evaluate(SHARE); await pg.goto(U+f"#/book/{bid}"); await pg.wait_for_selector(".lead-bar"); await pg.wait_for_timeout(1200)
    mbar = await pg.inner_text(".lead-bar"); print("Mira sees:", mbar.replace("\n"," ")[:160])
    if "page turn" in mbar: ERR.append("co-narrator still sees a cleared ask as waiting")
    print("ERR:", ERR); print("ERRORS:", errs); await br.close()
asyncio.run(main()); srv.terminate()
