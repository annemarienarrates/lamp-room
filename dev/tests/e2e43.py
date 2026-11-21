# Word counts are cached per chapter: they must match a fresh count before and after edits, and repeat counts must be fast.
from _env import *
import asyncio, subprocess, sys
from playwright.async_api import async_playwright
srv = subprocess.Popen([sys.executable,"-m","http.server","8643","-d",ROOT],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
U="http://localhost:8643/index.html?test"
CHECK = """(() => { let bad = 0; const fresh = c => { const o = {}; for (const t of Prep.__tokenizeForTest(c)) { const w = Prep.readerOf(t.part, c, b) || "?"; o[w] = (o[w] || 0) + 1; } return o; };
  for (const c of b.chapters) { if (JSON.stringify(Prep.wordsByReader(c, b)) !== JSON.stringify(fresh(c))) bad++; if (JSON.stringify(Prep.tokens(c)) !== JSON.stringify(Prep.__tokenizeForTest(c))) bad++; } return bad; })()"""
async def main():
  async with async_playwright() as p:
    br = await p.chromium.launch(executable_path=CHROME, args=["--no-sandbox"])
    pg = await (await br.new_context(viewport={"width":1440,"height":900})).new_page()
    errs=[]; pg.on("pageerror", lambda e: errs.append(str(e)))
    await pg.goto(U+"#/import"); await pg.wait_for_timeout(500)
    await pg.set_input_files("#file",FIX+"/duet.docx"); await pg.wait_for_selector("#create")
    await pg.fill("#it","Count Book"); await pg.click("#create"); await pg.wait_for_selector("table.ch"); await pg.wait_for_function("Store.books.length>0")
    ERR=[]
    await pg.evaluate("window.b = Store.books[0]")
    print("readers:", await pg.evaluate("JSON.stringify(b.chapters.map(c => Prep.wordsByReader(c, b)))"))
    if await pg.evaluate(CHECK): ERR.append("counts differ before edits")
    # change who reads a stretch (in place), change the text, and reassign a part to someone else
    await pg.evaluate("Prep.setPart(b.chapters[0], 3, 25, 'r:Jack')")
    await pg.evaluate("b.chapters[1].paras[0] = 'A brand new opening line for this chapter.'")
    await pg.evaluate("b.parts = Object.assign({}, b.parts, {n: 'Jack'})")
    print("after edits:", await pg.evaluate("JSON.stringify(b.chapters.slice(0,2).map(c => Prep.wordsByReader(c, b)))"))
    if await pg.evaluate(CHECK): ERR.append("counts differ after edits")
    ms = await pg.evaluate("(() => { const t = performance.now(); for (let r = 0; r < 50; r++) for (const c of b.chapters) Prep.wordsByReader(c, b); return (performance.now() - t) / 50; })()")
    print("repeat full-book count: %.2f ms" % ms)
    if ms > 20: ERR.append("cached count is slow: %.1f ms" % ms)
    print("ERR:", ERR); print("ERRORS:", errs); await br.close()
asyncio.run(main()); srv.terminate()
