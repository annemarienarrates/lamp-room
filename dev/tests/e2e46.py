# People, the book's Lead and Lead-only editing, notes to the Lead, hand on, the format stamp, who's here, Read by.
from _env import *
import asyncio, subprocess, sys, json
from playwright.async_api import async_playwright
srv = subprocess.Popen([sys.executable,"-m","http.server","8646","-d",ROOT],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
U="http://localhost:8646/index.html?test"
async def as_(pg, who, url):
    await pg.evaluate(f"Store.setMe('{who}')"); await pg.goto(U+"#/library"); await pg.goto(U+url); await pg.wait_for_timeout(700)
async def main():
  async with async_playwright() as p:
    br = await p.chromium.launch(executable_path=CHROME, args=["--no-sandbox","--use-fake-ui-for-media-stream","--use-fake-device-for-media-stream"])
    ctx = await br.new_context(viewport={"width":1440,"height":900}); await ctx.add_init_script("try{if(!localStorage.getItem('lr-me'))localStorage.setItem('lr-me','Anne')}catch(e){}")
    pg = await ctx.new_page(); errs=[]; pg.on("pageerror", lambda e: errs.append(str(e))); ERR=[]
    pg.on("dialog", lambda d: asyncio.ensure_future(d.accept()))
    await pg.goto(U+"#/import"); await pg.wait_for_timeout(500)
    await pg.set_input_files("#file",FIX+"/duet.docx"); await pg.wait_for_selector("#create")
    await pg.fill("#it","Lead Book"); await pg.click("#create"); await pg.wait_for_selector("table.ch"); await pg.wait_for_function("Store.books.length>0")
    bid = await pg.evaluate("Store.books[0].id")
    await pg.evaluate("(()=>{const b=Store.books[0]; b.parts=Object.assign({}, b.parts, {n:'Anne', f:'Anne', m:'Jack'}); Store.saveBook(b,true);})()"); await pg.wait_for_timeout(700)
    ppl = await pg.evaluate("Store.settings.people.map(p=>p.name+(p.team?'*':''))"); print("people:", ppl)
    if "Anne*" not in ppl or "Jack*" not in ppl: ERR.append("People not seeded with the team")
    # Anne leads
    await as_(pg, "Anne", f"#/book/{bid}")
    print("Anne sees:", (await pg.inner_text(".lead-bar"))[:90].replace("\n"," "))
    st = await pg.evaluate("({lead: Store.books[0].lead, fmt: Store.books[0].fmt})"); print("stamped:", st)
    if st["lead"] != "Anne" or st["fmt"] != 2: ERR.append("lead/fmt not stamped on save")
    if await pg.evaluate("document.querySelector('[data-f=title]').disabled"): ERR.append("Lead is locked out")
    # Jack doesn't
    await as_(pg, "Jack", f"#/book/{bid}")
    bar = await pg.inner_text(".lead-bar"); print("Jack sees:", bar[:90].replace("\n"," "))
    locked = await pg.evaluate("['[data-f=title]','#updms','[data-inc]','[data-status]','#redetect'].map(s=>{const e=document.querySelector(s);return s+':'+(e?e.disabled:'none')})"); print("locked:", locked)
    if any(x.endswith(":false") for x in locked): ERR.append("Jack can still edit the book")
    if await pg.evaluate("!document.querySelector('a[href^=\"#/booth/\"]')"): ERR.append("Booth link gone")
    await pg.screenshot(path=SHOTS+"/lead-jack.png")
    await pg.click("#askLead"); await pg.wait_for_selector("#aktx"); await pg.select_option("#akch", "1"); await pg.fill("#aktx","Line 3 is mine, not Anne's."); await pg.click("#akgo"); await pg.wait_for_timeout(900)
    jf = await pg.evaluate("""(async()=>{const b=Store.books[0]; const d=await (await (await Store.root.getDirectoryHandle('Books')).getDirectoryHandle(b.folder)).getDirectoryHandle('people'); return await (await (await d.getFileHandle('Jack.json')).getFile()).text();})()""")
    bj = await pg.evaluate("""(async()=>{const b=Store.books[0]; const d=await (await Store.root.getDirectoryHandle('Books')).getDirectoryHandle(b.folder); return await (await (await d.getFileHandle('book.json')).getFile()).text();})()""")
    print("in Jack's file:", "Line 3 is mine" in jf, "| in book.json:", "Line 3 is mine" in bj)
    if "Line 3 is mine" not in jf or "Line 3 is mine" in bj: ERR.append("ask not in the asker's own file")
    # the Booth, as Jack
    await pg.goto(U+f"#/booth/{bid}/1"); await pg.wait_for_selector("#booth-dock"); await pg.wait_for_timeout(800)
    eb = await pg.evaluate("[...document.querySelectorAll('button')].map(b=>b.textContent.trim()).find(t=>t.startsWith('✎'))"); print("Booth edit button for Jack:", eb)
    if eb != "✎ Ask Anne": ERR.append("Booth text editor not routed to the Lead")
    # Anne sees the ask and clears it
    await as_(pg, "Anne", f"#/book/{bid}")
    print("Anne's asks:", (await pg.inner_text(".lead-bar")).replace("\n"," ")[:200])
    if "asked of you" not in (await pg.inner_text(".lead-bar")).lower(): ERR.append("Lead doesn't see the ask")
    await pg.click("[data-askdone]"); await pg.wait_for_timeout(500)
    if await pg.evaluate("LRPeople.openAsks(Store.books[0]).length"): ERR.append("ask not cleared")
    # who's here: Jack's presence file for this book
    await pg.evaluate(f"""(async()=>{{const d=await Store.root.getDirectoryHandle('Presence',{{create:true}}); const w=await (await d.getFileHandle('Jack.json',{{create:true}})).createWritable(); await w.write(JSON.stringify({{who:'Jack',at:new Date().toISOString(),book:'{bid}',where:'booth',ci:2,chapter:'Chapter 2'}})); await w.close(); await LRPresence.look();}})()""")
    await pg.wait_for_timeout(300); pres = await pg.evaluate("(document.getElementById('presence')||{}).textContent||''"); print("presence:", pres)
    if "Jack has this book open" not in pres: ERR.append("presence line missing")
    await pg.screenshot(path=SHOTS+"/lead-anne.png")
    # Read by on character scripts
    await pg.evaluate("document.querySelector('#cscripts').open=true"); await pg.wait_for_timeout(300)
    async with pg.expect_file_chooser() as fc: await pg.click("#csadd")
    await (await fc.value).set_files(FIX+"/captain-script.docx"); await pg.wait_for_timeout(1500)
    rb = await pg.evaluate("[...document.querySelectorAll('[data-csby]')].map(s=>s.options[s.selectedIndex].text)"); print("Read by:", rb)
    if not rb or "Highlighting says Jack" not in rb[0]: ERR.append("Read by guess wrong")
    await pg.select_option("[data-csby]", "Anne"); await pg.wait_for_timeout(800)
    dis = await pg.evaluate("(document.querySelector('#cscripts details[open] summary')||{}).textContent||''"); print("after naming Anne:", dis)
    if "disagree" not in dis: ERR.append("disagreements not listed")
    await pg.screenshot(path=SHOTS+"/readby.png")
    # follow the scripts: every disagreeing line goes to the script's reader
    n_off = await pg.evaluate("(()=>{const m=(document.querySelector('#cscripts details[open] summary')||{}).textContent.match(/(\\d+) line/); return m?+m[1]:0})()")
    await pg.click("#csfollow"); await pg.wait_for_timeout(900)
    await pg.evaluate("document.querySelector('#cscripts').open=true"); await pg.wait_for_timeout(500)
    left = await pg.evaluate("(document.querySelector('#cscripts details[open] summary')||{}).textContent||''"); print("follow the scripts:", n_off, "→ left:", left or "none")
    if not n_off or "disagree" in left: ERR.append("follow-the-scripts left disagreements")
    # hand on to Jack: Anne is now locked
    await pg.select_option("#handon", "Jack"); await pg.wait_for_timeout(800)
    print("after hand on:", await pg.evaluate("Store.books[0].lead"), "| Anne locked:", await pg.evaluate("document.querySelector('[data-f=title]').disabled"))
    if await pg.evaluate("Store.books[0].lead") != "Jack" or not await pg.evaluate("document.querySelector('[data-f=title]').disabled"): ERR.append("hand on")
    # format stamp: a book from a newer Lamp Room isn't saved over
    before = await pg.evaluate("Store.books[0].title")
    await pg.evaluate("Store.books[0].fmt=3; Store.books[0].title='SHOULD NOT SAVE'; Store.saveBook(Store.books[0])"); await pg.wait_for_timeout(2500)
    bj = await pg.evaluate("""(async()=>{const b=Store.books[0]; const d=await (await Store.root.getDirectoryHandle('Books')).getDirectoryHandle(b.folder); return await (await (await d.getFileHandle('book.json')).getFile()).text();})()""")
    print("newer-format save blocked:", "SHOULD NOT SAVE" not in bj)
    if "SHOULD NOT SAVE" in bj: ERR.append("saved over a newer format")
    print("ERR:", ERR); print("ERRORS:", errs); await br.close()
asyncio.run(main()); srv.terminate()
