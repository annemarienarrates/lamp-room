# Daily backups: made on their own, Back up now, restore a book (Lead only), restore the planner, keep 14 per person.
from _env import *
import asyncio, subprocess, sys
from playwright.async_api import async_playwright
srv = subprocess.Popen([sys.executable,"-m","http.server","8642","-d",ROOT],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
U="http://localhost:8642/index.html?test"
async def main():
  async with async_playwright() as p:
    b = await p.chromium.launch(executable_path=CHROME, args=["--no-sandbox"])
    ctx = await b.new_context(viewport={"width":1440,"height":900})
    await ctx.add_init_script("try{localStorage.setItem('lr-me','Anne')}catch(e){}")
    pg = await ctx.new_page()
    errs=[]; pg.on("pageerror", lambda e: errs.append(str(e)))
    ERR=[]
    await pg.goto(U+"#/import"); await pg.wait_for_timeout(500)
    await pg.set_input_files("#file",FIX+"/duet.docx"); await pg.wait_for_selector("#create")
    await pg.fill("#it","Backup Book"); await pg.click("#create"); await pg.wait_for_selector("table.ch"); await pg.wait_for_timeout(600)
    await pg.evaluate("Store.llPut('titles','t-one',{name:'Title One',client:'Made Up Co'})")
    await pg.evaluate("const b=Store.books[0]; b.chapters[0].prog={Anne:{done:false,words:5}}; Store.saveBook(b,true)"); await pg.wait_for_timeout(600)
    # the daily one appears on its own
    await pg.evaluate("localStorage.removeItem('lr-backup-last@Anne'); LRBackup.start()")
    for _ in range(40):
      L = await pg.evaluate("LRBackup.list()")
      if L: break
      await pg.wait_for_timeout(500); print("auto:", [x["name"] for x in L])
    if not any(x["name"].endswith(" Anne.zip") for x in L): ERR.append("no daily zip for Anne")
    # change things after the backup
    first = await pg.evaluate("Store.books[0].chapters[0].title")
    await pg.evaluate("const b=Store.books[0]; b.chapters[0].title='CHANGED'; b.chapters[0].prog.Anne={done:true,words:99}; Store.saveBook(b,true)")
    await pg.evaluate("Store.llPut('titles','t-two',{name:'Title Two'})"); await pg.wait_for_timeout(500)
    name = L[0]["name"]
    # restore the book through the dialog
    await pg.goto(U+"#/settings?tab=computer"); await pg.wait_for_selector("#bkRestore"); await pg.click("#bkRestore")
    await pg.wait_for_selector("[data-rb]"); await pg.click("[data-rb]"); await pg.wait_for_selector("#rsGo")
    print("confirm:", (await pg.inner_text(".overlay .card"))[:300].replace("\n"," | "))
    await pg.click("#rsGo"); await pg.wait_for_function("!document.querySelector('.overlay')", timeout=10000)
    after = await pg.evaluate("Store.books[0].chapters[0].title"); print("title:", first, "->", after)
    if after != first: ERR.append("book not restored")
    if await pg.evaluate("!!(Store.books[0].chapters[0].prog||{}).Anne?.done"): ERR.append("Anne's file not restored")
    L2 = await pg.evaluate("LRBackup.list()")
    if not any(x["beforeRestore"] for x in L2): ERR.append("no safety backup before restore")
    # Lead only
    await pg.evaluate("Store.books[0]._lead0=Store.books[0].lead; Store.books[0].lead='Jack'")
    print("Anne can restore when Jack leads:", await pg.evaluate("LRBackup.canRestore(Store.books[0])"))
    msg = await pg.evaluate("LRBackup.restoreBook(%r, Store.books[0].folder, []).then(()=>'went through').catch(e=>e.message)" % name)
    print("blocked:", msg)
    if "Only Jack" not in msg: ERR.append("non-Lead restore not blocked")
    await pg.evaluate("Store.books[0].lead=Store.books[0]._lead0; delete Store.books[0]._lead0")
    # planner
    print("titles before:", await pg.evaluate("Store.ll.titles.map(t=>t.name)"))
    await pg.evaluate("LRBackup.restorePlanner(%r)" % name)
    T = await pg.evaluate("Store.ll.titles.map(t=>t.name)"); print("titles after:", T)
    if sorted(T) != ["Backup Book","Title One"]: ERR.append("planner not restored exactly")
    # pruning: 16 old daily zips of Anne's, 3 of Jack's
    await pg.evaluate("""(async()=>{const d=await Store.root.getDirectoryHandle('Backups');
      for(let i=1;i<=16;i++){const day=new Date(Date.now()-i*864e5*2), k=day.toISOString().slice(0,10);
        for(const who of i<=3?['Anne','Jack']:['Anne']){const h=await d.getFileHandle(k+' '+who+'.zip',{create:true});const w=await h.createWritable();await w.write('x');await w.close();}}})()""")
    await pg.evaluate("LRBackup.prune()")
    L3 = await pg.evaluate("LRBackup.list()")
    anne=[x for x in L3 if x["by"]=="Anne" and not x["beforeRestore"]]; jack=[x for x in L3 if x["by"]=="Jack"]
    print("after prune: Anne daily", len(anne), "Jack", len(jack))
    if len(anne)!=14: ERR.append("Anne should keep 14, has %d"%len(anne))
    if len(jack)!=3: ERR.append("Jack's backups were touched")
    await pg.goto(U+"#/settings?tab=computer"); await pg.wait_for_selector("#bkLast"); print("card:", await pg.inner_text("#bkLast"))
    await pg.screenshot(path=SHOTS+"/backups-card.png")
    print("ERR:", ERR); print("ERRORS:", errs); await b.close()
asyncio.run(main()); srv.terminate()
