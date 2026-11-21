from _env import *
import asyncio, subprocess, sys
from playwright.async_api import async_playwright
srv = subprocess.Popen([sys.executable,"-m","http.server","8638","-d",ROOT],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
U="http://localhost:8638/index.html?test"
async def main():
  async with async_playwright() as p:
    b = await p.chromium.launch(executable_path=CHROME, args=["--no-sandbox"])
    pg = await (await b.new_context(viewport={"width":1440,"height":900})).new_page()
    errs=[]; pg.on("pageerror", lambda e: errs.append(str(e)))
    await pg.goto(U+"#/import"); await pg.wait_for_timeout(500)
    await pg.set_input_files("#file",FIX+"/duet.docx"); await pg.wait_for_selector("#create")
    await pg.fill("#it","Upd Book"); await pg.click("#create"); await pg.wait_for_selector("table.ch"); await pg.wait_for_timeout(400)
    print("chapters:", await pg.evaluate("Store.books[0].chapters.map(c=>c.title+':'+c.words).join(' | ')"))
    for f in ["Book_Ch2_new.docx","Book_Ch2_headed.docx"]:
      async with pg.expect_file_chooser() as fc: await pg.click("#updms")
      await (await fc.value).set_files(FIX+"/"+f); await pg.wait_for_timeout(1200)
      print(f, "dialog:", (await pg.evaluate("(document.querySelector('.overlay .card')||{}).innerText||''")).replace("\n"," | ")[:400])
      if await pg.evaluate("!!document.querySelector('#pcf')"):
        await pg.click(".overlay [data-go]")
      elif await pg.evaluate("!!document.querySelector('.overlay [data-go]')"):
        await pg.click(".overlay [data-go]")
      await pg.wait_for_timeout(800)
      print("  after:", await pg.evaluate("Store.books[0].chapters.map(c=>c.title+':'+c.words).join(' | ')"))
    print("ERRORS:", errs); await b.close()
asyncio.run(main()); srv.terminate()
