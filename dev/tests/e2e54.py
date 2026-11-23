# True hourly rate: booth and logged recording on the same day count once (the larger), editing and admin add on,
# net is after the partner's share; grouped by client and arrangement; general admin shown separately.
from _env import *
import asyncio, subprocess, sys
from playwright.async_api import async_playwright
srv = subprocess.Popen([sys.executable,"-m","http.server","8654","-d",ROOT],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
U="http://localhost:8654/index.html?test"
async def main():
  async with async_playwright() as p:
    br = await p.chromium.launch(executable_path=CHROME, args=["--no-sandbox"])
    ctx = await br.new_context(viewport={"width":1440,"height":900}); await ctx.add_init_script("try{localStorage.setItem('lr-me','Anne')}catch(e){}")
    pg = await ctx.new_page(); errs=[]; pg.on("pageerror", lambda e: errs.append(str(e))); ERR=[]
    await pg.goto(U+"#/library"); await pg.wait_for_timeout(900)
    st = lambda tid: f"[{{id:'{tid}-ra',type:'record',owner:'anne',words:40000,done:true}},{{id:'{tid}-rj',type:'record',owner:'jack',words:10000,done:true}},{{id:'{tid}-ed',type:'edit',owner:'anne',done:true}},{{id:'{tid}-dl',type:'deliver',owner:'anne',done:true}}]"
    await pg.evaluate(f"LL.put('titles','t-ember',{{kind:'narration',status:'done',name:'Ember Road',client:'Harbor Lane Press',category:'A',rateModel:'pfh',rate:300,actualFH:5,invoiceDate:'2026-10-01',checkDate:'2026-10-20',checkAmount:1500,software:0,stages:{st('t-ember')},color:'#b8862f'}})")
    await pg.evaluate(f"LL.put('titles','t-glass',{{kind:'narration',status:'done',name:'Glass Tide',client:'Indie Author',category:'B',partnerPct:50,partnerName:'Pat',rateModel:'pfh',rate:250,actualFH:2,invoiceDate:'2026-09-01',checkDate:'2026-09-20',checkAmount:500,software:0,stages:{st('t-glass')},color:'#4f7a8c'}})")
    logs = [("l1","2026-09-02","anne","[{person:'anne',titleId:'t-ember',stageId:'t-ember-ra',kind:'work',hours:3},{person:'anne',titleId:'t-glass',stageId:'t-glass-ra',kind:'work',hours:5}]"),
            ("l2","2026-09-03","anne","[{person:'anne',titleId:'t-ember',stageId:'t-ember-ed',kind:'work',hours:3},{person:'anne',titleId:'t-ember',stageId:null,kind:'admin',hours:1},{person:'anne',titleId:null,stageId:null,kind:'admin',hours:5}]")]
    for i,d,who,ents in logs: await pg.evaluate(f"LL.put('logs','{i}',{{date:'{d}',person:'{who}',raw:'',entries:{ents}}})")
    # booth clock: Anne 4 h on Ember the day she logged 3 (counts 4, not 7); Jack 2 h never logged
    await pg.evaluate("LL.S.boothFh=[{id:'b1',date:'2026-09-02',person:'anne',titleId:'t-ember',words:12000,boothHours:4,auto:true},{id:'b2',date:'2026-09-04',person:'jack',titleId:'t-ember',words:900,boothHours:2,auto:true}];LL.syncS();LL.compute()")
    await pg.goto(U+"#/titles"); await pg.wait_for_timeout(900); await pg.evaluate("LL.S.boothFh=[{id:'b1',date:'2026-09-02',person:'anne',titleId:'t-ember',words:12000,boothHours:4,auto:true},{id:'b2',date:'2026-09-04',person:'jack',titleId:'t-ember',words:900,boothHours:2,auto:true}];LL.syncS();LL.rerender()"); await pg.wait_for_timeout(500)
    rows = await pg.evaluate("[...document.querySelectorAll('#rates table.rates')].map(t=>[...t.querySelectorAll('tbody tr')].map(r=>r.innerText.replace(/\\s+/g,' ').trim()))")
    head = await pg.evaluate("document.querySelector('#rates').innerText.split('\\n').slice(0,12).join(' | ')")
    print(head); [print(" ", r) for t in rows for r in t]
    t = rows[0] if rows else []
    if not any(r.startswith("Ember Road") and "10h" in r and "$150.00" in r for r in t): ERR.append("Ember should be 10 h → $150/h (booth 4 not 3+4, Jack's 2, edit 3, admin 1)")
    if not any(r.startswith("Glass Tide") and "5h" in r and "$50.00" in r for r in t): ERR.append("Glass should be $250 net over 5 h")
    if "$116.67" not in head: ERR.append("finished-titles rate should be $1,750 / 15 h")
    if "$87.50" not in head: ERR.append("with general admin should be $1,750 / 20 h")
    if not any(r.startswith("Harbor Lane Press") for r in (rows[1] if len(rows)>1 else [])): ERR.append("no by-client table")
    kinds = await pg.evaluate("document.querySelector('#rates .kleg')?.innerText.replace(/\\s+/g,' ')"); print("kinds:", kinds)
    if not kinds or "Recording 11h" not in kinds or "Editing 3h" not in kinds: ERR.append("hours-by-kind wrong")
    await pg.select_option("[data-act=rate-year]", "2026"); await pg.wait_for_timeout(400)
    if "$116.67" not in await pg.inner_text("#rates"): ERR.append("year filter lost the 2026 titles")
    await pg.screenshot(path="shots/rates.png", full_page=False, clip=await pg.evaluate("(()=>{const r=document.querySelector('#rates').getBoundingClientRect();return {x:r.x,y:r.y+scrollY,width:r.width,height:Math.min(r.height,900)};})()"))
    print("ERR:", ERR); print("ERRORS:", errs); await br.close()
asyncio.run(main()); srv.terminate()
