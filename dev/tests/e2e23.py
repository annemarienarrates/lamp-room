from _env import *
import asyncio, subprocess, sys, json
from playwright.async_api import async_playwright
srv = subprocess.Popen([sys.executable,"-m","http.server","8623","-d",ROOT],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
U="http://localhost:8623/index.html?test"
async def main():
  async with async_playwright() as p:
    b = await p.chromium.launch(executable_path=CHROME, args=["--no-sandbox","--use-fake-device-for-media-stream","--use-fake-ui-for-media-stream","--autoplay-policy=no-user-gesture-required"])
    ctx = await b.new_context(permissions=["microphone"], viewport={"width":1440,"height":900}); pg = await ctx.new_page()
    errs=[]; pg.on("pageerror", lambda e: errs.append(str(e))); pg.on("console", lambda m: m.type=="error" and errs.append("console:"+m.text))
    await pg.goto(U+"#/settings"); await pg.wait_for_timeout(800)
    print("settings card:", (await pg.evaluate("[...document.querySelectorAll('.card h3')].map(h=>h.innerText).filter(t=>/Proof/.test(t))")))
    await pg.select_option("#pfm","stop"); await pg.wait_for_timeout(200)
    await pg.goto(U+"#/import"); await pg.wait_for_timeout(600)
    await pg.set_input_files("#file",FIX+"/sample.docx"); await pg.wait_for_selector("#create")
    await pg.fill("#it","Proof Test"); await pg.click("#create"); await pg.wait_for_selector("table.ch"); await pg.wait_for_function("Store.books.length>0"); await pg.wait_for_timeout(300)
    bid = await pg.evaluate("Store.books[0].id")
    await pg.goto(U+f"#/booth/{bid}/0"); await pg.wait_for_selector("#booth-dock"); await pg.wait_for_timeout(1200)
    print("mode:", await pg.evaluate("Store.settings.proofMode"))
    # the model is faked: it "hears" the text read with one word swapped and one skipped
    await pg.evaluate("""(()=>{const B=Booth.state; const ws=B.toks.slice(0,40).filter((t,i)=>B.mine[i]).map(t=>t.w);
      window._said = ws.slice(); window._said[5]='banana'; window._said.splice(12,1);
      LRProof._mock = async (x,kind)=>{ window._heardLen=(window._heardLen||0)+x.length; window._kind=kind; return window._said.join(' '); };})()""")
    await pg.evaluate("Booth.state.prerollSec=0"); await pg.keyboard.press("r"); await pg.wait_for_timeout(1500)
    await pg.evaluate("(()=>{const B=Booth.state; B.rec.anchors.push([0.1,0]); B.rec.anchors.push([1.2,30]); B.f.set(30);})()")
    await pg.keyboard.press("s"); await pg.wait_for_timeout(2000)
    print("model kind:", await pg.evaluate("window._kind"), "| audio samples:", await pg.evaluate("window._heardLen"))
    print("flags:", await pg.evaluate("JSON.stringify(Booth.state.audio.markers.filter(m=>m.proof).map(m=>m.note))"))
    print("underlined:", await pg.evaluate("[...document.querySelectorAll('#ms .w.proof')].map(e=>e.innerText)"))
    await pg.evaluate("Booth.state.side=null; Booth.state.tab='pickups'; Booth._test.act('tools')"); await pg.wait_for_timeout(300)
    await pg.screenshot(path=SHOTS+"/proof.png")
    await pg.click("[data-p^='pign']"); await pg.wait_for_timeout(300)
    print("after ignore:", await pg.evaluate("JSON.stringify(Booth.state.book.proofIgnore)"), "| open flags:", await pg.evaluate("Booth.state.audio.markers.filter(m=>m.proof&&!m.done).length"))
    # live mode
    await pg.evaluate("Store.settings.proofMode='live'; window._kind=null; window._heardLen=0")
    await pg.evaluate("Booth.state.prerollSec=0"); await pg.keyboard.press("r"); await pg.wait_for_timeout(2500); await pg.keyboard.press("s"); await pg.wait_for_timeout(1500)
    print("live model kind:", await pg.evaluate("window._kind"), "| samples:", await pg.evaluate("window._heardLen"))
    # export with the checks
    await pg.evaluate("Booth.state.audio.markers=Booth.state.audio.markers.filter(m=>!m.proof); Booth.state.book.proofIgnore=[]")
    await pg.evaluate("Booth._test.exportDialog()"); await pg.wait_for_timeout(300)
    await pg.check("#xproof"); await pg.check("#xspace"); await pg.click("#xgo"); await pg.wait_for_timeout(5000)
    print("export msg:", await pg.evaluate("(document.querySelector('#xmsg')||{}).innerText"))
    await pg.screenshot(path=SHOTS+"/export-proof.png")
    await pg.click("[data-anyway]"); await pg.wait_for_timeout(4000)
    print("exported:", await pg.evaluate("!!Booth.state.chap.exportedAt"), "| dialog gone:", await pg.evaluate("!document.querySelector('#xgo')"))
    print("remembered:", await pg.evaluate("[Store.lsGet('lr-xproof'),Store.lsGet('lr-xspace')]"))
    print("ERRORS:", errs); await b.close()
asyncio.run(main()); srv.terminate()
