# Assigning lines: the Lead's choice changes the book for everyone; anyone else's goes in their own copy only (their
# people file), changes their own words and pacer, and can be put back to the Lead's highlighting.
from _env import *
import asyncio, subprocess, sys, json
from playwright.async_api import async_playwright
srv = subprocess.Popen([sys.executable,"-m","http.server","8658","-d",ROOT],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
U="http://localhost:8658/index.html?test"
SEL = """((a,b)=>{const ws=[...document.querySelectorAll('#ms .w')]; const x=ws.find(w=>+w.dataset.i===a), y=ws.find(w=>+w.dataset.i===b);
  const r=document.createRange(); r.setStart(x.firstChild,0); r.setEnd(y.firstChild,y.firstChild.length); const s=getSelection(); s.removeAllRanges(); s.addRange(r);
  document.querySelector('#ms').dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));})"""
async def main():
  async with async_playwright() as p:
    br = await p.chromium.launch(executable_path=CHROME, args=["--no-sandbox"])
    ctx = await br.new_context(viewport={"width":1440,"height":900}); await ctx.add_init_script("try{localStorage.getItem('lr-me')||localStorage.setItem('lr-me','Anne')}catch(e){}")
    pg = await ctx.new_page(); errs=[]; pg.on("pageerror", lambda e: errs.append(str(e))); ERR=[]
    await pg.goto(U+"#/import"); await pg.wait_for_timeout(500)
    await pg.set_input_files("#file",FIX+"/duet.docx"); await pg.wait_for_selector("#create"); await pg.fill("#it","Tidewater"); await pg.click("#create"); await pg.wait_for_function("Store.books.length===1"); await pg.wait_for_timeout(400)
    bid = await pg.evaluate("Store.books[0].id")
    await pg.evaluate("(()=>{const b=Store.books[0]; b.parts=Object.assign({},b.parts,{n:'Anne',f:'Anne',m:'Jack'}); b.lead='Anne'; Store.saveBook(b,true);})()")
    paras0 = await pg.evaluate("JSON.stringify(Store.books[0].chapters[0].paras)")
    # Jack: not the Lead. He gives three narration words to himself.
    await pg.evaluate("localStorage.setItem('lr-me','Jack')"); await pg.goto(U+"#/library"); await pg.wait_for_timeout(300)
    await pg.goto(U+f"#/booth/{bid}/0"); await pg.wait_for_selector("#booth-dock"); await pg.wait_for_timeout(900)
    i0 = await pg.evaluate("Booth.state.mine.findIndex((m,i)=>!m && Booth.state.toks[i].part==='n')")
    mine0 = await pg.evaluate("Booth.state.mine.filter(Boolean).length"); print("i0", i0, "rendered:", await pg.evaluate("[document.querySelectorAll('#ms .w').length, Booth.state.toks.length, Booth.state.readingAs, [...new Set(Booth.state.toks.map(t=>t.part))]]"))
    await pg.evaluate(f"{SEL}({i0},{i0+2})"); await pg.wait_for_selector("#part-pop")
    pop = await pg.inner_text("#part-pop"); print("Jack's pop:", pop.replace(chr(10)," | "))
    if "in your copy" not in pop or "Ask Anne to change it for everyone" not in pop: ERR.append("non-lead pop wording")
    await pg.click("#part-pop [data-who=Jack]"); await pg.wait_for_timeout(500)
    mine1 = await pg.evaluate("Booth.state.mine.filter(Boolean).length"); print("Jack's words:", mine0, "→", mine1)
    if mine1 != mine0 + 3: ERR.append("Jack's own copy should gain the 3 words")
    if await pg.evaluate("JSON.stringify(Store.books[0].chapters[0].paras)") != paras0: ERR.append("the shared highlighting changed")
    await pg.wait_for_timeout(1200)
    jf = await pg.evaluate("(async()=>{const b=Store.books[0]; const d=await (await Store.bookDir(b)).getDirectoryHandle('people'); return JSON.parse(await (await (await d.getFileHandle('Jack.json')).getFile()).text());})()")
    own = jf["chapters"].get(await pg.evaluate("Store.books[0].chapters[0].id"), {}).get("mine"); print("in Jack's file:", own)
    if not own or own[0]["part"] != "@Jack": ERR.append("personal assignment not saved in Jack's file")
    # Anne (the Lead) doesn't see Jack's change
    await pg.evaluate("localStorage.setItem('lr-me','Anne')"); await pg.goto(U+"#/library"); await pg.wait_for_timeout(300)
    await pg.goto(U+f"#/booth/{bid}/0"); await pg.wait_for_selector("#booth-dock"); await pg.wait_for_timeout(900)
    a_is_mine = await pg.evaluate(f"Booth.state.mine[{i0}]"); print("Anne still reads those words:", a_is_mine)
    if not a_is_mine: ERR.append("Jack's change leaked into Anne's copy")
    # Anne as Lead: her change goes into the book for everyone
    await pg.evaluate(f"{SEL}({i0+5},{i0+6})"); await pg.wait_for_selector("#part-pop")
    if "in your copy" in await pg.inner_text("#part-pop"): ERR.append("Lead's pop shouldn't say 'in your copy'")
    await pg.click("#part-pop [data-who=Jack]"); await pg.wait_for_timeout(500)
    if await pg.evaluate("JSON.stringify(Store.books[0].chapters[0].paras)") == paras0: ERR.append("Lead's change didn't reach the book")
    # Jack puts his own change back
    await pg.evaluate("localStorage.setItem('lr-me','Jack')"); await pg.goto(U+"#/library"); await pg.wait_for_timeout(300)
    await pg.goto(U+f"#/booth/{bid}/0"); await pg.wait_for_selector("#booth-dock"); await pg.wait_for_timeout(900)
    print("Jack sees his own and Anne's:", await pg.evaluate(f"[Booth.state.mine[{i0}], Booth.state.mine[{i0+5}]]"))
    if await pg.evaluate(f"!(Booth.state.mine[{i0}] && Booth.state.mine[{i0+5}])"): ERR.append("Jack should see both his own and the Lead's change")
    await pg.evaluate(f"{SEL}({i0},{i0+2})"); await pg.wait_for_selector("#part-pop [data-unown]"); await pg.click("#part-pop [data-unown]"); await pg.wait_for_timeout(500)
    back = await pg.evaluate(f"Booth.state.mine[{i0}]"); print("after ↩ back:", back)
    if back: ERR.append("↩ didn't put it back")
    print("ERR:", ERR); print("ERRORS:", errs); await br.close()
asyncio.run(main()); srv.terminate()
