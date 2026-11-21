from _env import *
import asyncio, subprocess, sys, json
from playwright.async_api import async_playwright
srv = subprocess.Popen([sys.executable,"-m","http.server","8621","-d",ROOT],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
U="http://localhost:8621/index.html?test"
async def main():
  async with async_playwright() as p:
    b = await p.chromium.launch(executable_path=CHROME, args=["--no-sandbox"])
    pg = await b.new_page(); errs=[]; pg.on("pageerror", lambda e: errs.append(str(e)))
    await pg.goto(U+"#/almanac"); await pg.wait_for_timeout(1200)
    await pg.evaluate("""(async()=>{
      await Store.llPut('bills','bill-mortgage',{name:'Mortgage',amount:2400,day:1,active:true,trackFrom:'2026-10',paid:{}});
      await Store.llPut('bills','bill-internet',{name:'Internet',amount:84,day:22,active:true,paid:{'2026-11':{date:'2026-11-17',amount:84}}});
      await Store.llPut('bills','bill-electric',{name:'Electric',amount:325,day:10,active:true,paid:{'2026-11':{date:'2026-11-12',amount:325}}});
      location.hash="#/"; })()""")
    await pg.wait_for_timeout(1200)
    async def ledger(tag):
      rows = await pg.evaluate("[...document.querySelectorAll('.ll table.led tr')].map(r=>r.innerText.replace(/\\s+/g,' ').trim())")
      print("--",tag); [print("  ",r) for r in rows if 'Mortgage' in r or 'Month' in r or 'Electric' in r or 'Internet' in r]
    await pg.wait_for_timeout(300); print("dashboard heads:", await pg.evaluate("[...document.querySelectorAll('.head-row')].map(r=>r.innerText).filter(t=>/late/.test(t))"))
    await pg.goto(U+"#/almanac"); await pg.wait_for_timeout(1000); print("almanac heads up:", await pg.evaluate("[...document.querySelectorAll('.alert')].map(a=>a.innerText).filter(t=>/late/.test(t))"))
    await pg.goto(U+"#/ledger"); await pg.wait_for_timeout(1000)
    await ledger("Nov before paying")
    al = await pg.evaluate("[...document.querySelectorAll('.alert')].map(a=>a.innerText).filter(t=>/late/.test(t))")
    print("heads up:", al)
    # pay October via its popover
    await pg.evaluate("""(async()=>{const el=document.querySelector('[data-act=bill-pop][data-ym="2026-10"]');el.click();})()""")
    await pg.wait_for_timeout(300); print("pop:", await pg.evaluate("document.querySelector('.pop')?.innerText"))
    await pg.click(".pop [data-act=bill-pay]"); await pg.wait_for_timeout(900)
    await ledger("Nov after paying Oct")
    print("mortgage record:", await pg.evaluate("JSON.stringify(LL.S.bills.find(b=>b.id==='bill-mortgage').paid)"))
    await pg.click(".ll [data-act=led-mon][data-d='-1']"); await pg.wait_for_timeout(500); await ledger("Oct")
    await pg.goto(U+"#/almanac"); await pg.wait_for_timeout(1200)
    chips = await pg.evaluate("[...document.querySelectorAll('.ll .mk')].map(m=>m.innerText.replace(/\\s+/g,' ')).filter(t=>/Mortgage/.test(t))")
    print("calendar chips:", chips)
    print("ERRORS:", errs); await b.close()
asyncio.run(main()); srv.terminate()
