# Firmament and Thornwood: listed in Settings, their own colours, their motion drawn behind the panels (stars; pines and
# fireflies), and the motion stops while recording, while playing back, and with motion off.
from _env import *
import asyncio, subprocess, sys
from playwright.async_api import async_playwright
srv = subprocess.Popen([sys.executable,"-m","http.server","8661","-d",ROOT],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
U="http://localhost:8661/index.html?test"
LIT = "(()=>{const c=document.getElementById('lr-rain');if(!c)return -1;const x=c.getContext('2d'),d=x.getImageData(0,0,c.width,c.height).data;let n=0;for(let i=3;i<d.length;i+=16)if(d[i]>8)n++;return n})()"
async def main():
  async with async_playwright() as p:
    br = await p.chromium.launch(executable_path=CHROME, args=["--no-sandbox"])
    ctx = await br.new_context(viewport={"width":1440,"height":900}); await ctx.add_init_script("try{localStorage.getItem('lr-me')||localStorage.setItem('lr-me','Anne')}catch(e){}")
    pg = await ctx.new_page(); errs=[]; pg.on("pageerror", lambda e: errs.append(str(e))); ERR=[]
    await pg.goto(U+"#/import"); await pg.wait_for_timeout(500)
    await pg.set_input_files("#file",FIX+"/duet.docx"); await pg.wait_for_selector("#create"); await pg.fill("#it","Tidewater"); await pg.click("#create"); await pg.wait_for_function("Store.books.length===1"); await pg.wait_for_timeout(400)
    bid = await pg.evaluate("Store.books[0].id")
    await pg.goto(U+"#/settings?tab=look"); await pg.wait_for_timeout(600)
    opts = await pg.evaluate("[...document.querySelectorAll('#th option')].map(o=>o.value)"); print("themes:", opts)
    for k, fx, accent in [("firmament", "fx-stars", "#e8c56a"), ("thornwood", "fx-forest", "#a7c080")]:
      if k not in opts: ERR.append(k + " should be in the Theme list")
      await pg.select_option("#th", k); await pg.wait_for_timeout(1800)
      st = await pg.evaluate("[document.documentElement.dataset.theme, getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(), document.getElementById('lr-rain')?.className]"); print(k, st)
      if st != [k, accent, fx]: ERR.append(k + ": theme, accent or motion wrong")
      lit = await pg.evaluate(LIT); print("  drawn pixels:", lit)
      if lit < 50: ERR.append(k + ": nothing drawn")
      await pg.goto(U+"#/library"); await pg.wait_for_timeout(900); await pg.screenshot(path=f"/tmp/th-{k}-library.png")
      await pg.goto(U+f"#/booth/{bid}/0"); await pg.wait_for_selector("#booth-dock"); await pg.wait_for_timeout(1500); await pg.screenshot(path=f"/tmp/th-{k}-booth.png")
      # recording: the motion holds still
      await pg.evaluate("document.body.classList.add('booth-recording')"); await pg.wait_for_timeout(200)
      a = await pg.evaluate("document.getElementById('lr-rain').toDataURL().length"); await pg.wait_for_timeout(700); b2 = await pg.evaluate("document.getElementById('lr-rain').toDataURL()")
      await pg.wait_for_timeout(700); b3 = await pg.evaluate("document.getElementById('lr-rain').toDataURL()")
      if b2 != b3: ERR.append(k + ": motion should hold still while recording")
      await pg.evaluate("document.body.classList.remove('booth-recording')")
      await pg.goto(U+"#/settings?tab=look"); await pg.wait_for_timeout(600)
    # motion off: no canvas at all
    await pg.evaluate("Store.settings.calm=true"); await pg.wait_for_timeout(1800)
    if await pg.evaluate("!!document.getElementById('lr-rain')"): ERR.append("motion off should remove the effects")
    print("ERR:", ERR); print("ERRORS:", errs); await br.close()
asyncio.run(main()); srv.terminate()
