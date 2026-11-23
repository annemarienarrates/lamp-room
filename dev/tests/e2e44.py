# Settings in four tabs with search; the Booth's Tools drawer lists only the tabs a book uses, ＋ More, last tab remembered.
from _env import *
import asyncio, subprocess, sys
from playwright.async_api import async_playwright
srv = subprocess.Popen([sys.executable,"-m","http.server","8644","-d",ROOT],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
U="http://localhost:8644/index.html?test"
OPTS="[...document.querySelectorAll('.bd-tabsel option')].map(o=>o.value)"
async def main():
  async with async_playwright() as p:
    br = await p.chromium.launch(executable_path=CHROME, args=["--no-sandbox","--use-fake-ui-for-media-stream","--use-fake-device-for-media-stream"])
    ctx = await br.new_context(viewport={"width":1440,"height":900}); await ctx.add_init_script("try{localStorage.setItem('lr-me','Anne')}catch(e){}")
    pg = await ctx.new_page(); errs=[]; pg.on("pageerror", lambda e: errs.append(str(e))); ERR=[]
    # ---- settings ----
    await pg.goto(U+"#/settings"); await pg.wait_for_selector(".set-tabs")
    vis = "[...document.querySelectorAll('#main > .card:not(.hidden) h3')].map(h=>h.textContent.trim())"
    me = await pg.evaluate(vis); print("Me:", me)
    if "Who's working here" not in me or "Backups" in me: ERR.append("Me tab wrong")
    await pg.click("[data-stab=computer]"); comp = await pg.evaluate(vis); print("This computer:", comp)
    if set(comp) != {"This computer","Auphonic","Problem log","Recordings on this computer","Backups","Library folder"}: ERR.append("computer tab wrong")
    await pg.click("[data-stab=money]"); print("Books & money:", await pg.evaluate(vis))
    await pg.click("[data-stab=look]"); print("Look:", await pg.evaluate(vis))
    await pg.fill("#setq","confetti"); hits = await pg.evaluate(vis); print("search confetti:", hits, await pg.evaluate("document.querySelector('#main > .card:not(.hidden) h3').dataset.where"))
    if hits != ["Look & feel"]: ERR.append("search confetti")
    await pg.fill("#setq","back up"); print("search 'back up':", await pg.evaluate(vis))
    if "Backups" not in await pg.evaluate(vis): ERR.append("search backup")
    await pg.screenshot(path=SHOTS+"/settings-search.png")
    await pg.fill("#setq","zzqx"); print("none:", await pg.inner_text(".set-none"))
    await pg.fill("#setq",""); await pg.goto(U+"#/"); await pg.goto(U+"#/settings"); await pg.wait_for_selector(".set-tabs")
    if await pg.evaluate("document.querySelector('[aria-selected=true]').dataset.stab") != "look": ERR.append("tab not remembered")
    await pg.goto(U+"#/settings?tab=computer"); await pg.wait_for_selector(".set-tabs")
    if await pg.evaluate("document.querySelector('[aria-selected=true]').dataset.stab") != "computer": ERR.append("?tab= ignored")
    await pg.click("[data-stab=me]"); await pg.screenshot(path=SHOTS+"/settings-me.png")
    # ---- tools drawer: a solo book, then the same book as a duet ----
    await pg.goto(U+"#/import"); await pg.wait_for_timeout(500)
    await pg.set_input_files("#file",FIX+"/sample.docx"); await pg.wait_for_selector("#create")
    await pg.fill("#it","Solo Book"); await pg.click("#create"); await pg.wait_for_selector("table.ch"); await pg.wait_for_function("Store.books.length>0")
    bid = await pg.evaluate("Store.books[0].id")
    await pg.evaluate("const b=Store.books[0]; b.parts={n:'Anne'}; Store.saveBook(b,true)"); await pg.wait_for_timeout(500)
    await pg.goto(U+f"#/booth/{bid}/0"); await pg.wait_for_selector("#booth-dock"); await pg.wait_for_timeout(800)
    await pg.click("[data-s=tools]"); await pg.wait_for_selector(".bd-tabsel")
    solo = await pg.evaluate(OPTS); print("solo:", solo)
    if any(k in solo for k in ["shared","orig","duet"]) or "__more" not in solo: ERR.append("solo tabs wrong")
    await pg.select_option(".bd-tabsel","__more"); allt = await pg.evaluate(OPTS); print("after More:", allt)
    if not all(k in allt for k in ["shared","orig","duet"]) or "__fewer" not in allt: ERR.append("More didn't show all")
    await pg.select_option(".bd-tabsel","takes"); await pg.wait_for_timeout(200)
    await pg.screenshot(path=SHOTS+"/tools-solo.png")
    # duet: Jack reads a part → Collaborate appears; and the last tab (Takes) comes back
    await pg.goto(U+"#/"); await pg.wait_for_timeout(300)
    await pg.evaluate("const b=Store.books[0]; Prep.setPart(b.chapters[1],0,30,'r:x'); b.parts={n:'Anne','r:x':'Jack'}; Store.saveBook(b,true)"); await pg.wait_for_timeout(500)
    await pg.goto(U+f"#/booth/{bid}/1"); await pg.wait_for_selector("#booth-dock"); await pg.wait_for_timeout(800)
    await pg.click("[data-s=tools]"); await pg.wait_for_selector(".bd-tabsel")
    duet = await pg.evaluate(OPTS); sel = await pg.evaluate("document.querySelector('.bd-tabsel').value"); print("duet:", duet, "open on:", sel)
    if "duet" not in duet: ERR.append("Collaborate missing in a duet")
    if sel != "takes": ERR.append("last tab not remembered")
    print("ERR:", ERR); print("ERRORS:", errs); await br.close()
asyncio.run(main()); srv.terminate()
