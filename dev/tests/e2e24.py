from _env import *
import asyncio, subprocess, sys, json
from playwright.async_api import async_playwright
srv = subprocess.Popen([sys.executable,"-m","http.server","8624","-d",ROOT],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
U="http://localhost:8624/index.html?test"
C = "Booth.state.audio.tracks.map((t,i)=>'T'+(i+1)+':'+t.clips.map(c=>'['+c.at.toFixed(2)+'–'+(c.at+c.dur).toFixed(2)+(c.base?' base':'')+(c.g?' g'+c.g:'')+']').join('')).join('  ')"
async def main():
  async with async_playwright() as p:
    b = await p.chromium.launch(executable_path=CHROME, args=["--no-sandbox","--use-fake-device-for-media-stream","--use-fake-ui-for-media-stream","--autoplay-policy=no-user-gesture-required"])
    ctx = await b.new_context(permissions=["microphone"], viewport={"width":1440,"height":900}); pg = await ctx.new_page()
    errs=[]; pg.on("pageerror", lambda e: errs.append(str(e))); pg.on("console", lambda m: m.type=="error" and errs.append("console:"+m.text))
    pg.on("dialog", lambda d: asyncio.ensure_future(d.accept()))
    await pg.goto(U+"#/import"); await pg.wait_for_timeout(600)
    await pg.set_input_files("#file",FIX+"/sample.docx"); await pg.wait_for_selector("#create")
    await pg.fill("#it","Old Book"); await pg.click("#create"); await pg.wait_for_selector("table.ch"); await pg.wait_for_function("Store.books.length>0"); await pg.wait_for_timeout(300)
    bid = await pg.evaluate("Store.books[0].id")
    await pg.goto(U+f"#/booth/{bid}/1"); await pg.wait_for_selector("#booth-dock"); await pg.wait_for_timeout(1200)
    await pg.evaluate("Booth.state.side=null; Booth.state.tab='orig'; Booth._test.act('tools')"); await pg.wait_for_timeout(300)
    async with pg.expect_file_chooser() as fc:
      await pg.click("[data-p='oall']")
    await (await fc.value).set_files([FIX+"/ch01.wav",FIX+"/ch02.wav",FIX+"/ch03.wav"])
    await pg.wait_for_function("!Booth.state.busy", timeout=60000); await pg.wait_for_timeout(2500)
    print("chapters with audio:", await pg.evaluate("Booth.state.book.chapters.map((c,i)=>c.orig?i+':'+c.orig.name:null).filter(Boolean)"))
    print("this chapter:", await pg.evaluate("Booth.state.ci"), await pg.evaluate(C))
    # fake listening: each 30 s window "hears" the next ~70 words of the chapter text, in 3 timed chunks
    await pg.evaluate("""(()=>{ LRProof._mockTimed = async (x, rate)=>{ const st=window._mt=window._mt||{}; const key=x.length; 
        const ch=Booth.state.book.chapters[window._mapCi]; const toks=Prep.tokens(ch).map(t=>t.w); st[window._mapCi]=st[window._mapCi]||0; const k=st[window._mapCi];
        const ws=toks.slice(k,k+75); st[window._mapCi]+=75; const d=x.length/rate; return [0,1,2].map(j=>({text:ws.slice(j*25,j*25+25).join(' '), t:[j*d/3,(j+1)*d/3]})); }; })()""")
    await pg.evaluate("window._mapCi=Booth.state.ci")
    await pg.click("[data-p='omap1']"); await pg.wait_for_function("!Booth.state.busy", timeout=60000); await pg.wait_for_timeout(300)
    print("map points:", await pg.evaluate("(Booth.state.chap.origMap||[]).length"), "| first:", await pg.evaluate("JSON.stringify((Booth.state.chap.origMap||[]).slice(0,3))"), "| anchors:", await pg.evaluate("Booth.state.audio.anchors.length"))
    w = await pg.evaluate("Booth.state.toks[60].w"); print("finding:", w)
    await pg.fill("#ofind", w); await pg.click("[data-p='ofind']"); await pg.wait_for_timeout(300)
    print("hits:", await pg.evaluate("JSON.stringify(Booth.state.findHits.slice(0,3).map(h=>[h.ci,h.i,h.t]))"))
    await pg.screenshot(path=SHOTS+"/orig.png")
    await pg.click(f"[data-p='ohit:{1}:60']") if await pg.evaluate("Booth.state.findHits.some(h=>h.ci===1&&h.i===60)") else None
    await pg.wait_for_timeout(300); print("playhead after jump:", await pg.evaluate("Booth.state.playhead"), "| pos:", await pg.evaluate("Booth.state.f.pos"))
    # replace 10–12 s with a new read
    L0 = await pg.evaluate("Booth._test.len()")
    await pg.evaluate("Booth.state.sel={a:10,b:12}; Booth.state.prerollSec=0"); await pg.evaluate("Booth._test.replaceSel()"); await pg.wait_for_timeout(1500)
    await pg.keyboard.press("s"); await pg.wait_for_timeout(1500)
    print("after replace:", await pg.evaluate(C), "| length", round(L0,2), "→", round(await pg.evaluate("Booth._test.len()"),2))
    print("session words:", await pg.evaluate("Booth.state.session&&Booth.state.session.words"), "| corrections:", await pg.evaluate("!!Booth.state.book.corrections"))
    print("ERRORS:", errs); await b.close()
asyncio.run(main()); srv.terminate()
