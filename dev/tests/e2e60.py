# People is only who works in this Library: cast records from before are cleared (books keep their names), the card sits
# on Books & money as "Who works in this Library", nothing is suggested from the books, and cast names still match by
# first name.
from _env import *
import asyncio, subprocess, sys
from playwright.async_api import async_playwright
srv = subprocess.Popen([sys.executable,"-m","http.server","8660","-d",ROOT],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
U="http://localhost:8660/index.html?test"
async def main():
  async with async_playwright() as p:
    br = await p.chromium.launch(executable_path=CHROME, args=["--no-sandbox"])
    ctx = await br.new_context(viewport={"width":1440,"height":900}); await ctx.add_init_script("try{localStorage.setItem('lr-me','Anne')}catch(e){}")
    pg = await ctx.new_page(); errs=[]; pg.on("pageerror", lambda e: errs.append(str(e))); ERR=[]
    await pg.goto(U+"#/library"); await pg.wait_for_timeout(900)
    await pg.evaluate("Store.books.push({id:'b1',title:'Moonfall',folder:'Moonfall',chapters:[],parts:{n:'Anne','c:F8CBDE':'Cast 1'},castNames:{'Cast 1':'Rowan Pike'}})")
    await pg.evaluate("""(()=>{const S=Store.settings; S.people=[{id:'a',name:'Anne',full:'Anne Marie',credit:'Anne Marie',aka:[],team:true},{id:'j',name:'Jack',credit:'Jack Smith',aka:[],team:true},
      {id:'c1',name:'Rowan Pike',full:'Rowan Pike',aka:[],team:false},{id:'c2',name:'Mira',full:'Mira Hale',aka:[],team:false}]; LRPeople.reconcile();})()""")
    ppl = await pg.evaluate("Store.settings.people.map(p=>p.name)"); print("people after:", ppl)
    if ppl != ["Anne","Jack"]: ERR.append("cast records should be cleared, the team kept")
    print("book keeps its cast name:", await pg.evaluate("Store.books.find(b=>b.id==='b1').castNames['Cast 1']"))
    same = await pg.evaluate("[Store.samePerson('Mira','Mira Hale'), Store.samePerson('Anne','Anne Marie'), Store.samePerson('Rowan','Jack')]"); print("matching:", same)
    if same != [True, True, False]: ERR.append("name matching")
    await pg.goto(U+"#/settings?tab=money"); await pg.wait_for_timeout(700)
    money = await pg.evaluate("[...document.querySelectorAll('.card:not([hidden]) h3')].filter(h=>h.offsetParent).map(h=>h.textContent)"); print("Books & money tab:", money)
    if "Who works in this Library" not in money: ERR.append("card should be on Books & money")
    await pg.click("[data-stab=me]"); await pg.wait_for_timeout(300)
    me = await pg.evaluate("[...document.querySelectorAll('.card h3')].filter(h=>h.offsetParent).map(h=>h.textContent)"); print("Me tab:", me)
    if any("People" in x or "Library" in x for x in me): ERR.append("People shouldn't be on the Me tab")
    if await pg.query_selector("[data-addu]") or "In your books but not in People" in await pg.inner_text("main"): ERR.append("no suggestions from the books")
    print("ERR:", ERR); print("ERRORS:", errs); await br.close()
asyncio.run(main()); srv.terminate()
