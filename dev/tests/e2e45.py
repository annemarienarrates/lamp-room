# What's new: the Dashboard card lists what matters to the person's role; Got it clears it for them.
from _env import *
import asyncio, subprocess, sys
from playwright.async_api import async_playwright
srv = subprocess.Popen([sys.executable,"-m","http.server","8645","-d",ROOT],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
U="http://localhost:8645/index.html?test"
TITLES="[...document.querySelectorAll('#newsCard li b')].map(b=>b.textContent)"
async def main():
  async with async_playwright() as p:
    br = await p.chromium.launch(executable_path=CHROME, args=["--no-sandbox"])
    ctx = await br.new_context(viewport={"width":1440,"height":900}); await ctx.add_init_script("try{if(!localStorage.getItem('lr-me'))localStorage.setItem('lr-me','Anne')}catch(e){}")
    pg = await ctx.new_page(); errs=[]; pg.on("pageerror", lambda e: errs.append(str(e))); ERR=[]
    await pg.goto(U+"#/"); await pg.wait_for_selector("#newsCard", timeout=10000)
    anne = await pg.evaluate(TITLES); print("Anne (team):", anne)
    if "Read my note works on this computer." not in anne or "Smoother while recording." not in anne: ERR.append("team items missing")
    await pg.screenshot(path=SHOTS+"/news-anne.png")
    await pg.click("[data-news-ok]")
    if await pg.evaluate("!!document.getElementById('newsCard')"): ERR.append("Got it didn't clear")
    await pg.goto(U+"#/settings"); await pg.goto(U+"#/"); await pg.wait_for_timeout(800)
    if await pg.evaluate("!!document.getElementById('newsCard')"): ERR.append("came back after Got it")
    # an editor on a shared book, not on the Library's team
    await pg.evaluate("Store.books.push({id:'x1',title:'Shared One',chapters:[],shared:true,sharedOwner:'Anne',sharedPeople:[{name:'Edie',role:'editor'}]}); localStorage.setItem('lr-me','Edie')")
    await pg.goto(U+"#/settings"); await pg.evaluate("Store.books.push({id:'x1',title:'Shared One',chapters:[],shared:true,sharedOwner:'Anne',sharedPeople:[{name:'Edie',role:'editor'}]})")
    await pg.goto(U+"#/"); await pg.wait_for_timeout(800)
    print("Edie roles:", await pg.evaluate("[...LRNews.roles()]"))
    edie = await pg.evaluate(TITLES); print("Edie (editor):", edie)
    if any(t in edie for t in ["Read my note works on this computer.","Smoother while recording."]): ERR.append("editor saw team/recording items")
    if "Daily backups." not in edie: ERR.append("editor missed an all-roles item")
    print("ERR:", ERR); print("ERRORS:", errs); await br.close()
asyncio.run(main()); srv.terminate()
