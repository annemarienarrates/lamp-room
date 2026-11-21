from _env import *
import asyncio, subprocess, sys
from playwright.async_api import async_playwright
srv = subprocess.Popen([sys.executable,"-m","http.server","8637","-d",ROOT],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
U="http://localhost:8637/index.html?test"
LS="""(async()=>{const r=await navigator.storage.getDirectory(); const bd=await r.getDirectoryHandle('Books'); const out=[]; for await (const [n,h] of bd.entries()) if(h.kind==='directory'){ const fs=[]; for await (const [m,x] of h.entries()) fs.push(m); let pp=[]; try{const pd=await h.getDirectoryHandle('people'); for await (const [m] of pd.entries()) pp.push(m);}catch(e){} out.push(n+': '+fs.sort().join(',')+' | people: '+pp.sort().join(','));} return out.join(' ## ');})()"""
async def main():
  async with async_playwright() as p:
    b = await p.chromium.launch(executable_path=CHROME, args=["--no-sandbox","--use-fake-ui-for-media-stream","--use-fake-device-for-media-stream"])
    pg = await (await b.new_context(viewport={"width":1440,"height":900})).new_page()
    errs=[]; pg.on("pageerror", lambda e: errs.append(str(e)))
    await pg.goto(U+"#/import"); await pg.wait_for_timeout(500)
    await pg.set_input_files("#file",FIX+"/duet.docx"); await pg.wait_for_selector("#create")
    await pg.fill("#it","Drive Book"); await pg.click("#create"); await pg.wait_for_selector("table.ch"); await pg.wait_for_timeout(400)
    bid = await pg.evaluate("Store.books[0].id")
    await pg.evaluate("localStorage.setItem('lr-me','Anne')")
    await pg.goto(U+"#/library"); await pg.goto(U+f"#/booth/{bid}/1"); await pg.wait_for_selector("#booth-dock"); await pg.wait_for_timeout(1200)
    await pg.keyboard.press("r"); await pg.wait_for_timeout(1500); await pg.keyboard.press("s"); await pg.wait_for_timeout(1200)
    await pg.keyboard.press("c"); await pg.wait_for_timeout(100); await pg.keyboard.press("c")
    print("markers before leaving:", await pg.evaluate("Booth.state.audio.markers.length"))
    await pg.goto(U+"#/library"); await pg.wait_for_timeout(800)
    print("files:", await pg.evaluate(LS))
    # Drive's trick: the newest copy becomes 'name (1).json', an older one keeps the plain name (or none)
    await pg.evaluate("""(async()=>{const r=await navigator.storage.getDirectory(); const bd=await r.getDirectoryHandle('Books'); const f=Store.books[0].folder; const h=await bd.getDirectoryHandle(f);
      const mv=async(dir,a,b)=>{const t=await (await (await dir.getFileHandle(a)).getFile()).text(); const w=await (await dir.getFileHandle(b,{create:true})).createWritable(); await w.write(t); await w.close(); await dir.removeEntry(a);};
      await mv(h,'book.json','book (1).json'); const pd=await h.getDirectoryHandle('people');
      const t=await (await (await pd.getFileHandle('Anne.json')).getFile()).text(); await mv(pd,'Anne.json','Anne (1).json');
      await new Promise(r=>setTimeout(r,1100)); const old=JSON.parse(t); for(const k in old.chapters){ if(old.chapters[k].audio) old.chapters[k].audio.markers=[]; }
      const w=await (await pd.getFileHandle('Anne.json',{create:true})).createWritable(); await w.write(JSON.stringify(old)); await w.close();
      // make the (1) copy the newest
      await new Promise(r=>setTimeout(r,1100)); const t1=await (await (await pd.getFileHandle('Anne (1).json')).getFile()).text(); const w1=await (await pd.getFileHandle('Anne (1).json')).createWritable(); await w1.write(t1); await w1.close();})()""")
    print("after Drive mess:", await pg.evaluate(LS))
    await pg.reload(); await pg.wait_for_timeout(3500)
    print("books after reload:", await pg.evaluate("Store.books.map(b=>b.title)"))
    await pg.goto(U+f"#/booth/{bid}/1"); await pg.wait_for_selector("#booth-dock"); await pg.wait_for_timeout(1200)
    print("markers after reload:", await pg.evaluate("Booth.state.audio.markers.length"))
    await pg.goto(U+"#/library"); await pg.wait_for_timeout(2500)
    print("files repaired:", await pg.evaluate(LS))
    print("toast:", await pg.evaluate("[...document.querySelectorAll('.toast')].map(t=>t.innerText).join(' | ')")[:300] if False else (await pg.evaluate("[...document.querySelectorAll('.toast,#toast,.lr-toast')].map(t=>t.innerText).join(' | ')"))[:300])
    print("ERRORS:", errs); await b.close()
asyncio.run(main()); srv.terminate()
