# Booth time counts by itself: days with booth time and no log show in the Daybook and count toward the day's hours;
# a day with logged recording too counts the larger, never both; Today's card lists today's booth time.
from _env import *
import asyncio, subprocess, sys
from playwright.async_api import async_playwright
srv = subprocess.Popen([sys.executable,"-m","http.server","8657","-d",ROOT],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
U="http://localhost:8657/index.html?test"
async def main():
  async with async_playwright() as p:
    br = await p.chromium.launch(executable_path=CHROME, args=["--no-sandbox"])
    ctx = await br.new_context(viewport={"width":1440,"height":900}); await ctx.add_init_script("try{localStorage.setItem('lr-me','Anne')}catch(e){}")
    pg = await ctx.new_page(); errs=[]; pg.on("pageerror", lambda e: errs.append(str(e))); ERR=[]
    await pg.goto(U+"#/library"); await pg.wait_for_timeout(900)
    await pg.evaluate("LL.put('titles','t-ash',{kind:'narration',status:'active',name:'Ashfall Academy 1',client:'Harbor Lane Press',category:'A',rateModel:'pfh',rate:300,words:90000,due:'2027-02-01',color:'#b8862f',stages:[{id:'t-ash-ra',type:'record',owner:'anne',words:60000},{id:'t-ash-rj',type:'record',owner:'jack',words:30000},{id:'t-ash-ed',type:'edit',owner:'anne'}]})")
    today = await pg.evaluate("new Date().toISOString().slice(0,10)"); d1 = await pg.evaluate("new Date(Date.now()-3*864e5).toISOString().slice(0,10)"); d2 = await pg.evaluate("new Date(Date.now()-2*864e5).toISOString().slice(0,10)")
    # d1: booth only (2.4 h). d2: booth 1.9 h, and a log with 1.5 h recording + 1 h admin. today: booth 1 h.
    await pg.evaluate(f"LL.put('logs','l-d2',{{date:'{d2}',person:'anne',raw:'Recorded and did invoices',entries:[{{person:'anne',titleId:'t-ash',stageId:'t-ash-ra',kind:'work',hours:1.5}},{{person:'anne',titleId:null,stageId:null,kind:'admin',hours:1}}]}})")
    BF = f"[{{id:'b1',date:'{d1}',person:'anne',titleId:'t-ash',words:2600,boothHours:2.4,auto:true}},{{id:'b2',date:'{d2}',person:'anne',titleId:'t-ash',words:2300,boothHours:1.9,auto:true}},{{id:'b3',date:'{today}',person:'anne',titleId:'t-ash',words:900,boothHours:1,auto:true}}]"
    await pg.goto(U+"#/log"); await pg.wait_for_timeout(800)
    await pg.evaluate(f"LL.S.boothFh={BF};LL.syncS();LL.compute();LL.rerender()"); await pg.wait_for_timeout(500)
    hrs = await pg.evaluate(f"[LL.hoursOn('anne','{d1}'),LL.hoursOn('anne','{d2}'),LL.hoursOn('anne','{today}')]"); print("hours per day:", hrs)
    if [round(h,2) for h in hrs] != [2.4, 2.9, 1.0]: ERR.append("day hours should be 2.4 (booth only), 2.9 (1.9 booth beats 1.5 logged, + 1 admin), 1.0")
    cards = await pg.evaluate("[...document.querySelectorAll('.logcard')].map(c=>c.innerText.replace(/\\s+/g,' ').trim())"); [print(" ", c) for c in cards]
    if not any("from the Booth" in c and "Ashfall" in c and "2h 24m" in c.replace("2.4h","2h 24m") or ("from the Booth" in c and "2.4" in c) for c in cards): ERR.append("booth-only day missing from the Daybook")
    d2card = next((c for c in cards if "Recorded and did invoices" in c), "")
    if "🎙" not in d2card: ERR.append("logged day should show the booth's extra time")
    await pg.goto(U+"#/almanac"); await pg.wait_for_timeout(600); await pg.evaluate(f"LL.S.boothFh={BF};LL.syncS();LL.compute();LL.rerender()"); await pg.wait_for_timeout(500)
    spent = await pg.evaluate("document.querySelector('.today-card .spent')?.innerText.replace(/\\s+/g,' ')"); print("today's work:", spent)
    if not spent or "Ashfall" not in spent: ERR.append("today's booth time not on Today's card")
    print("ERR:", ERR); print("ERRORS:", errs); await br.close()
asyncio.run(main()); srv.terminate()
