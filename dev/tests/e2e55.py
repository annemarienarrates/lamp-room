# Casting sheet: a CSV of characters and actors fills in who reads each colour (by the dialogue tags around the lines),
# keeps the Library's narrators as themselves, gives hired actors a Cast slot with their real name, and flags actors
# with no colour. Works on import and on the book page.
from _env import *
import asyncio, subprocess, sys
from playwright.async_api import async_playwright
srv = subprocess.Popen([sys.executable,"-m","http.server","8655","-d",ROOT],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
U="http://localhost:8655/index.html?test"
async def main():
  async with async_playwright() as p:
    br = await p.chromium.launch(executable_path=CHROME, args=["--no-sandbox"])
    ctx = await br.new_context(viewport={"width":1440,"height":1000}); await ctx.add_init_script("try{localStorage.setItem('lr-me','Anne')}catch(e){}")
    pg = await ctx.new_page(); errs=[]; pg.on("pageerror", lambda e: errs.append(str(e))); ERR=[]
    await pg.goto(U+"#/import"); await pg.wait_for_timeout(600)
    print("team:", await pg.evaluate("Store.settings.narrators.map(n=>n.name)"))
    await pg.set_input_files("#file",FIX+"/castsheet.docx"); await pg.wait_for_selector("#create")
    await pg.set_input_files("#cs-file",FIX+"/castsheet.csv"); await pg.wait_for_timeout(500)
    rows = await pg.evaluate("[...document.querySelectorAll('[data-ipart]')].map(s=>{const tr=s.closest('tr');return tr.cells[0].innerText.trim()+' → '+s.selectedOptions[0].textContent+' | '+tr.cells[4].innerText.trim()})")
    [print(" ", r) for r in rows]
    bar = await pg.inner_text(".castsheet"); print("bar:", bar)
    if "No colour found for Ned Hollis" not in bar: ERR.append("unplaced actor not flagged")
    await pg.fill("#it","Cast Sheet Test"); await pg.click("#create"); await pg.wait_for_timeout(1200)
    b = await pg.evaluate("(()=>{const b=Store.books.find(x=>x.title==='Cast Sheet Test');return {parts:b.parts,cast:b.castNames,sheet:(b.castSheet||[]).length};})()"); print("book:", b)
    P, C = b["parts"], b.get("cast") or {}
    want = {"BDD7EE":"Jack","F8CBDE":"Anne"}
    for k,v in P.items():
        if any(h in k for h in want) and v != [want[h] for h in want if h in k][0]: ERR.append(f"{k} should be {[want[h] for h in want if h in k][0]}, got {v}")
    rn = {v: C.get(v, v) for v in P.values()}
    mint = [v for k,v in P.items() if "C1F0C1" in k]; lav = [v for k,v in P.items() if "D9C2F0" in k]
    if not mint or C.get(mint[0]) != "Rowan Pike": ERR.append("mint should be Rowan Pike in a Cast slot")
    if not lav or C.get(lav[0]) != "Tess Morrow": ERR.append("lavender should be Tess Morrow in a Cast slot")
    if P.get("m") != "Jack" or P.get("f") != "Anne": ERR.append("blue should be Jack, pink Anne")
    if P.get("n") != "Anne": ERR.append("narration should be Anne (the Narrator row)")
    if b["sheet"] != 8: ERR.append("sheet rows not kept on the book")
    t = await pg.evaluate("(()=>{const b=Store.books.find(x=>x.title==='Cast Sheet Test');const t=LL.tById(b.titleId);return {cat:t.category,mode:t.partnerPayMode,pw:t.partnerPerWord,who:t.partnerName};})()"); print("schedule:", t)
    if t["cat"] != "C" or t["mode"] != "perword" or t["pw"] != 0.05 or "Rowan Pike" not in t["who"]: ERR.append("full cast should go on the schedule as C, $0.05 per cast word, with their names")
    # book page: the same button, and the column shows after using it
    await pg.set_input_files("#cs-file",FIX+"/castsheet.csv"); await pg.wait_for_timeout(700)
    col = await pg.evaluate("[...document.querySelectorAll('table.ch th')].some(t=>/casting sheet/i.test(t.textContent))"); print("book page column:", col)
    if not col: ERR.append("book page: no casting-sheet column")
    await pg.screenshot(path="shots/castsheet.png", full_page=True)
    print("ERR:", ERR); print("ERRORS:", errs); await br.close()
asyncio.run(main()); srv.terminate()
