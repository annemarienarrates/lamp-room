from _env import *
import asyncio, subprocess, sys, json
from playwright.async_api import async_playwright
srv = subprocess.Popen([sys.executable,"-m","http.server","8614","-d",ROOT],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
U="http://localhost:8614/index.html?test"
async def main():
  async with async_playwright() as p:
    b = await p.chromium.launch(executable_path=CHROME, args=["--no-sandbox","--use-fake-device-for-media-stream","--use-fake-ui-for-media-stream"])
    ctx = await b.new_context(permissions=["microphone"], viewport={"width":1440,"height":900}); pg = await ctx.new_page()
    errs=[]; pg.on("pageerror", lambda e: errs.append(str(e)+" @ "+(e.stack or "")[:500])); pg.on("console", lambda m: m.type=="error" and errs.append("console:"+m.text))
    await pg.goto(U+"#/library"); await pg.wait_for_timeout(900)
    # legacy state: shared file has a theme; Anne has no personal prefs yet
    print("me:", await pg.evaluate("Store.me()"), "theme:", await pg.evaluate("Store.settings.theme"))
    await pg.goto(U+"#/settings?tab=look"); await pg.wait_for_timeout(500)
    await pg.select_option("#th","foundry"); await pg.wait_for_timeout(300)
    await pg.evaluate("Store.lsSet('lr-tzoom','1.4')")
    shared = await pg.evaluate("(async()=>JSON.parse(await (await (await Store.root.getFileHandle('lamp-room.json')).getFile()).text()))()")
    print("Anne theme:", await pg.evaluate("Store.settings.theme"), "| shared file theme:", shared.get("theme"))
    # switch to Jack via the chip
    await pg.click("#whochip"); await pg.wait_for_timeout(200)
    await pg.screenshot(path="shots/w-menu.png")
    await pg.click(".who-menu [data-who=Jack]"); await pg.wait_for_timeout(500)
    print("now:", await pg.evaluate("Store.me()"), "theme:", await pg.evaluate("document.documentElement.dataset.theme"), "tzoom:", await pg.evaluate("Store.lsGet('lr-tzoom')"))
    await pg.goto(U+"#/settings?tab=look"); await pg.wait_for_timeout(400)
    await pg.select_option("#th","signal"); await pg.wait_for_timeout(300)
    await pg.evaluate("Store.lsSet('lr-tzoom','0.9')")
    await pg.evaluate("Store.setMe('Anne')"); await pg.wait_for_timeout(400)
    print("back to Anne:", await pg.evaluate("[Store.settings.theme, document.documentElement.dataset.theme, Store.lsGet('lr-tzoom')]"))
    shared = await pg.evaluate("(async()=>JSON.parse(await (await (await Store.root.getFileHandle('lamp-room.json')).getFile()).text()))()")
    print("shared theme still:", shared.get("theme"), "| narrators shared:", [n["name"] for n in shared["narrators"]])
    # external settings change keeps personal theme
    await pg.evaluate("(async()=>{const fh=await Store.root.getFileHandle('lamp-room.json');const j=JSON.parse(await (await fh.getFile()).text());j.wpfh=9400;j.theme='velvet';const w=await fh.createWritable();await w.write(JSON.stringify(j));await w.close();})()")
    await pg.evaluate("Store.checkExternal()"); await pg.wait_for_timeout(300)
    print("after external:", await pg.evaluate("[Store.settings.wpfh, Store.settings.theme]"))
    # help page
    await pg.goto(U+"#/help"); await pg.wait_for_timeout(500)
    print("help sections:", await pg.evaluate("document.querySelectorAll('.hp-sec').length"), "| keys rows:", await pg.evaluate("document.querySelectorAll('.hp-k').length"), "| first key:", await pg.evaluate("document.querySelector('.hp-k kbd').textContent"))
    await pg.screenshot(path="shots/w-help.png")
    await pg.click("[data-go=hp-keys]"); await pg.wait_for_timeout(700); await pg.screenshot(path="shots/w-help-keys.png")
    # booth: a book, record a little as Anne, switch to Jack in the booth, record, export Jack's takes
    await pg.goto(U+"#/import"); await pg.wait_for_timeout(400)
    await pg.set_input_files("#file",FIX+"/duet.docx"); await pg.wait_for_selector("#create")
    await pg.fill("#it","Shared Booth Book"); await pg.click("#create"); await pg.wait_for_timeout(1200)
    bid = await pg.evaluate("Store.books.find(b=>b.title==='Shared Booth Book').id")
    await pg.goto(U+f"#/booth/{bid}/0"); await pg.wait_for_timeout(1500)
    await pg.evaluate("Booth.state.prerollSec=0"); await pg.keyboard.press("r"); await pg.wait_for_timeout(1500); await pg.keyboard.press("s"); await pg.wait_for_timeout(900)
    print("Anne clips:", await pg.evaluate("Booth.state.audio.tracks[0].clips.length"), "reading as", await pg.evaluate("Booth.state.readingAs"))
    await pg.click("[data-b=menu]"); await pg.wait_for_timeout(200)
    await pg.click("[data-sw=Jack]"); await pg.wait_for_timeout(1200)
    print("booth now:", await pg.evaluate("Booth.state.readingAs"), "| theme:", await pg.evaluate("document.documentElement.dataset.theme"), "| clips:", await pg.evaluate("Booth.state.audio.tracks[0].clips.length"))
    await pg.evaluate("Booth.state.prerollSec=0"); await pg.keyboard.press("r"); await pg.wait_for_timeout(1500); await pg.keyboard.press("s"); await pg.wait_for_timeout(900)
    await pg.screenshot(path="shots/w-booth-jack.png")
    print("Jack takes:", await pg.evaluate("Store.takesOf('Jack').length"), "Anne takes:", await pg.evaluate("Store.takesOf('Anne').length"))
    r = await pg.evaluate("(async()=>{const d=await Store.root.getDirectoryHandle('_out',{create:true});return Store.exportTakes('Jack', d);})()")
    print("export:", r)
    # simulate Jack's own Mac: fresh studio, bring in
    r2 = await pg.evaluate("(async()=>{const old=Store.studio;Store.studio=await Store.root.getDirectoryHandle('_studio2',{create:true});const r=await Store.importTakes(await Store.root.getDirectoryHandle('_out'));const again=await Store.importTakes(await Store.root.getDirectoryHandle('_out'));Store.studio=old;return [r,again];})()")
    print("import:", r2)
    await pg.goto(U+"#/settings?tab=look"); await pg.wait_for_timeout(500); await pg.screenshot(path="shots/w-settings.png", full_page=True)
    print("ERRORS:", errs); await b.close()
asyncio.run(main()); srv.terminate()
