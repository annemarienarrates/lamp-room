from _env import *
import asyncio, subprocess, sys
from playwright.async_api import async_playwright
srv = subprocess.Popen([sys.executable,"-m","http.server","8634","-d",ROOT],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
U="http://localhost:8634/index.html?test"
async def main():
  async with async_playwright() as p:
    b = await p.chromium.launch(executable_path=CHROME, args=["--no-sandbox","--use-fake-ui-for-media-stream","--use-fake-device-for-media-stream","--autoplay-policy=no-user-gesture-required"])
    pg = await (await b.new_context(viewport={"width":1440,"height":900})).new_page()
    errs=[]; pg.on("pageerror", lambda e: errs.append(str(e))); pg.on("console", lambda m: m.type=="error" and errs.append("console:"+m.text))
    await pg.goto(U+"#/import"); await pg.wait_for_timeout(500)
    await pg.set_input_files("#file",FIX+"/duet.docx"); await pg.wait_for_selector("#create")
    await pg.fill("#it","Cue Book"); await pg.click("#create"); await pg.wait_for_selector("table.ch"); await pg.wait_for_timeout(400)
    bid = await pg.evaluate("Store.books[0].id")
    await pg.evaluate("(()=>{const b=Store.books[0]; b.parts=Object.assign({}, b.parts, {n:'Anne', f:'Anne', m:'Jack'}); Store.saveBook(b,true);})()")
    await pg.goto(U+"#/library"); await pg.goto(U+f"#/book/{bid}"); await pg.wait_for_timeout(600)
    print("card before:", await pg.evaluate("document.querySelector('#cscripts summary').innerText"))
    await pg.evaluate("document.querySelector('#cscripts').open=true"); await pg.wait_for_timeout(300)
    async with pg.expect_file_chooser() as fc: await pg.click("#csadd")
    await (await fc.value).set_files(FIX+"/captain-script.docx"); await pg.wait_for_timeout(1500)
    print("card after:", await pg.evaluate("document.querySelector('#cscripts').innerText.replace(/\\n+/g,' | ')")[:500] if False else (await pg.evaluate("document.querySelector('#cscripts').innerText.replace(/\\n+/g,' | ')"))[:500])
    # Jack reads the captain
    await pg.evaluate("localStorage.setItem('lr-me','Jack')"); await pg.goto(U+"#/library"); await pg.goto(U+f"#/booth/{bid}/0"); await pg.wait_for_selector("#booth-dock"); await pg.wait_for_timeout(1500)
    if await pg.evaluate("Booth.state.readingAs") != 'Jack':
        await pg.evaluate("Booth._test.switchReader ? Booth._test.switchReader('Jack') : 0"); await pg.wait_for_timeout(800)
    print("reading as:", await pg.evaluate("Booth.state.readingAs"), "cues:", await pg.evaluate("Booth.state.cues.length"), "tags:", await pg.evaluate("document.querySelectorAll('.cue-tag').length"))
    print("window:", await pg.evaluate("document.querySelector('#cue-win').innerText.replace(/\\n+/g,' | ')"))
    await pg.evaluate("(()=>{const q=Booth.state.cues.filter(q=>Booth.state.mine[q.a])[3]; Booth.state.f.pos=q.a; Booth._test.markPos(true);})()"); await pg.wait_for_timeout(200)
    print("window at 4th:", await pg.evaluate("document.querySelector('#cue-win').innerText.replace(/\\n+/g,' | ')"))
    await pg.click("[data-cuet=mini]"); await pg.wait_for_timeout(200); print("mini:", await pg.evaluate("document.querySelector('#cue-win').className"), await pg.evaluate("document.querySelector('#cue-win').innerText.replace(/\\n+/g,' | ')"), await pg.evaluate("document.querySelector('#cue-win').offsetHeight"))
    await pg.click("[data-cuet=mini]"); await pg.wait_for_timeout(200); print("open again:", await pg.evaluate("document.querySelector('#cue-win').offsetHeight"))
    await pg.click("[data-cuet=tags]"); await pg.wait_for_timeout(300); print("tags off:", await pg.evaluate("document.querySelectorAll('.cue-tag').length"))
    await pg.click("[data-cuet=tags]"); await pg.click("[data-cuet=win]"); await pg.wait_for_timeout(300); print("window off:", await pg.evaluate("document.querySelector('#cue-win').className"))
    await pg.click("[data-cuet=win]"); await pg.wait_for_timeout(200)
    await pg.click(".cue-who"); await pg.wait_for_timeout(900); print("guide open:", await pg.evaluate("Booth.state.charsOpen"), await pg.evaluate("(Booth.state.chars.list||[]).map(c=>c.name)"))
    up = await pg.query_selector("#bd-chars [data-c='smup']")
    print("upload btn:", bool(up))
    async with pg.expect_file_chooser() as fc: await up.click()
    await (await fc.value).set_files(FIX+"/tone3s.wav"); await pg.wait_for_timeout(1200)
    sb = "#bd-chars [data-aud^='sm:']"
    print("sample btn:", await pg.evaluate(f"(document.querySelector(\"{sb}\")||{{}}).textContent"))
    await pg.click(sb); await pg.wait_for_timeout(500)
    print("playing:", await pg.evaluate(f"document.querySelector(\"{sb}\").textContent"), await pg.evaluate("!!(Booth.state.charAudio && !Booth.state.charAudio.paused)"))
    await pg.click(sb); await pg.wait_for_timeout(300)
    print("stopped:", await pg.evaluate(f"document.querySelector(\"{sb}\").textContent"), await pg.evaluate("!!Booth.state.charAudio"))
    await pg.click(sb); await pg.wait_for_timeout(3600)
    print("ended by itself:", await pg.evaluate(f"document.querySelector(\"{sb}\").textContent"))
    # a book with no script: no cue window
    await pg.evaluate("(()=>{const b=Store.books[0]; b.cues=null; Store.saveBook(b,true);})()"); await pg.goto(U+"#/library"); await pg.goto(U+f"#/booth/{bid}/1"); await pg.wait_for_selector("#booth-dock"); await pg.wait_for_timeout(1000)
    print("no script:", await pg.evaluate("document.querySelector('#cue-win').className"), await pg.evaluate("document.querySelectorAll('.cue-tag').length"))
    print("ERRORS:", errs); await b.close()
asyncio.run(main()); srv.terminate()
