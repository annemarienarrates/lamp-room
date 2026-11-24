# Pace: a series' own pace once it has an hour of real reading, else the overall pace (3 h in 60 days), else People's
# typed pace. Sessions under 5 minutes or with no words don't count. The book page and the planner use the same number.
from _env import *
import asyncio, subprocess, sys
from playwright.async_api import async_playwright
srv = subprocess.Popen([sys.executable,"-m","http.server","8653","-d",ROOT],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
U="http://localhost:8653/index.html?test"
async def main():
  async with async_playwright() as p:
    br = await p.chromium.launch(executable_path=CHROME, args=["--no-sandbox"])
    ctx = await br.new_context(viewport={"width":1440,"height":900}); await ctx.add_init_script("try{localStorage.setItem('lr-me','Anne')}catch(e){}")
    pg = await ctx.new_page(); errs=[]; pg.on("pageerror", lambda e: errs.append(str(e))); ERR=[]
    await pg.goto(U+"#/import"); await pg.wait_for_timeout(500)
    for k, (name, title) in enumerate([("sample.docx","Saltwater Saga 1"), ("duet.docx","Saltwater Saga 2"), ("sample.docx","Other Book")]):
        await pg.goto(U+"#/library"); await pg.goto(U+"#/import"); await pg.wait_for_selector("#file", state="attached", timeout=60000)
        await pg.set_input_files("#file",FIX+"/"+name); await pg.wait_for_selector("#create", timeout=60000); await pg.fill("#it",title); await pg.click("#create")
        await pg.wait_for_function(f"Store.books.length==={k+1} && location.hash.startsWith('#/book/')", timeout=60000)
    await pg.wait_for_function("Store.books.length===3")
    ids = await pg.evaluate("Object.fromEntries(Store.books.map(b=>[b.title,b.id]))")
    print("series keys:", await pg.evaluate("Store.books.map(b=>b.title+' → '+LRPace.seriesOf(b))"))
    # typed pace only, before any sessions
    await pg.evaluate("LRPace.refresh()"); await pg.wait_for_timeout(400)
    t0 = await pg.evaluate("LRPace.of('Anne', Store.books[0])"); print("no sessions:", t0)
    if t0["from"] != "typed": ERR.append("typed pace not used with no sessions")
    d = await pg.evaluate("new Date(Date.now()-3*864e5).toISOString().slice(0,10)")
    # 1.5 h on the saga at 1,200/h (book 1 and 2 count together), 2 h elsewhere at 4,000/h, plus noise that mustn't count
    sess = [("s1", ids["Saltwater Saga 1"], 3600, 1200), ("s2", ids["Saltwater Saga 2"], 1800, 600), ("s3", ids["Other Book"], 7200, 8000),
            ("n1", ids["Other Book"], 120, 900), ("n2", ids["Saltwater Saga 1"], 3600, 0)]
    for sid, bid, sec, words in sess:
        await pg.evaluate(f"Store.saveSession('Anne', {{id:'{sid}', date:'{d}', titleId:'{bid}', boothSec:{sec}, words:{words}}})")
    await pg.evaluate("LRPace.refresh()"); await pg.wait_for_timeout(500)
    saga = await pg.evaluate(f"LRPace.of('Anne', Store.byId('{ids['Saltwater Saga 2']}'))"); other = await pg.evaluate(f"LRPace.of('Anne', Store.byId('{ids['Other Book']}'))")
    print("saga:", saga, "| other book:", other)
    if saga["from"] != "series" or saga["pace"] != 1200: ERR.append("series pace wrong (1,800 words over 1.5 h should be 1,200)")
    if other["from"] != "series" or other["pace"] != 4000: ERR.append("other book's pace wrong")
    ov = await pg.evaluate("LRPace.overall('Anne')"); print("overall:", ov)
    if abs(ov["hours"] - 3.5) > 0.05 or ov["pace"] != round(9800/3.5): ERR.append("overall should ignore the short and wordless sessions")
    # the book page and the planner say the same
    await pg.goto(U+f"#/book/{ids['Saltwater Saga 1']}"); await pg.wait_for_timeout(900)
    tile = await pg.evaluate("[...document.querySelectorAll('.tile em')].map(e=>e.textContent).find(t=>/words \\/ hr/.test(t))"); print("book page:", tile)
    if not tile or "1,200 words / hr on this series" not in tile: ERR.append("book page doesn't show the series pace")
    print("ERR:", ERR); print("ERRORS:", errs); await br.close()
asyncio.run(main()); srv.terminate()
