# Bring in: lines follow-along missed (or caught late) in the base read are found by their pauses, so the other
# readers' lines still land where they would with full timing, and each is flagged for a listen.
from _env import *
import asyncio, subprocess, sys
from playwright.async_api import async_playwright
srv = subprocess.Popen([sys.executable,"-m","http.server","8652","-d",ROOT],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
U="http://localhost:8652/index.html?test"
C = "Booth.state.audio.tracks.map((t,i)=>'T'+(i+1)+'('+((Booth._test.trackSet()[i]||{}).name||'')+'):'+t.clips.map(c=>'['+c.at.toFixed(2)+'–'+(c.at+c.dur).toFixed(2)+(c.line?' L'+c.line.r:'')+']').join('')).join('  ')"
async def main():
  async with async_playwright() as p:
    b = await p.chromium.launch(executable_path=CHROME, args=["--no-sandbox","--use-fake-device-for-media-stream","--use-fake-ui-for-media-stream","--autoplay-policy=no-user-gesture-required"])
    ctx = await b.new_context(permissions=["microphone"], viewport={"width":1440,"height":900}); pg = await ctx.new_page()
    ERR=[]; errs=[]; pg.on("pageerror", lambda e: errs.append(str(e))); pg.on("console", lambda m: m.type=="error" and errs.append("console:"+m.text))
    pg.on("dialog", lambda d: asyncio.ensure_future(d.accept()))
    SH = "Store.pickSharedFolder = async () => (await navigator.storage.getDirectory()).getDirectoryHandle('SharedBook', {create:true});"
    await pg.goto(U+"#/import"); await pg.wait_for_timeout(500); await pg.evaluate(SH)
    await pg.set_input_files("#file",FIX+"/duet.docx"); await pg.wait_for_selector("#create")
    await pg.fill("#it","Shared Duet"); await pg.click("#create"); await pg.wait_for_selector("table.ch"); await pg.wait_for_timeout(400)
    bid = await pg.evaluate("Store.books[0].id")
    await pg.evaluate("(()=>{const b=Store.books[0]; b.parts=Object.assign({}, b.parts, {n:'Anne', f:'Anne', m:'Jack'}); Store.settings.narrators=[{name:'Anne',pace:4035},{name:'Jack',pace:2000},{name:'Eddie',pace:1}]; Store.saveBook(b,true);})()")
    await pg.goto(U+"#/library"); await pg.goto(U+f"#/book/{bid}"); await pg.wait_for_timeout(600); await pg.evaluate(SH)
    await pg.evaluate("document.querySelector('#sharedc').open=true"); await pg.click("#shsetup"); await pg.wait_for_timeout(800)
    await pg.evaluate("document.querySelector('#sharedc').open=true"); await pg.click("#shadd"); await pg.wait_for_timeout(500)
    await pg.evaluate("(()=>{const b=Store.books[0]; b.sharedPeople[b.sharedPeople.length-1].name='Eddie'; Store.saveBook(b,true);})()"); await pg.wait_for_timeout(800)
    print("people:", await pg.evaluate("JSON.stringify(Store.books[0].sharedPeople)"), "| project.json:", await pg.evaluate("(async()=>{const d=await (await navigator.storage.getDirectory()).getDirectoryHandle('SharedBook'); const j=JSON.parse(await (await (await d.getFileHandle('project.json')).getFile()).text()); return j.title+' / '+j.people.length+' people / '+j.chapters.length+' ch'})()"))
    SYN = """async (spec) => { const B = Booth.state, d = await Store.chapterAudioDir(B.book, B.chap), R = 48000, L = spec.len;
      const x = new Float32Array(Math.round(L * R)); for (const [a, b] of spec.tones) for (let i = Math.round(a * R); i < Math.round(b * R) && i < x.length; i++) x[i] = 0.25 * Math.sin(i * 2 * Math.PI * 220 / R);
      const w = await LRAudio.WavWriter.create(d, spec.name, R); w.push(x); await w.close();
      B.audio.tracks = [{ clips: [{ file: spec.name, off: 0, dur: L, at: 0 }] }]; B.audio.anchors = spec.anchors; B.audio.markers = []; Store.saveBook(B.book); }"""
    async def be(who):
        await pg.evaluate(f"localStorage.setItem('lr-me','{who}')"); await pg.goto(U+"#/library"); await pg.wait_for_timeout(300)
        await pg.goto(U+f"#/booth/{bid}/0"); await pg.wait_for_selector("#booth-dock"); await pg.wait_for_timeout(1000); await pg.evaluate(SH)
    async def studio():
        await pg.evaluate("Booth.state.prerollSec=0"); await pg.keyboard.press("r"); await pg.wait_for_timeout(900); await pg.keyboard.press("s"); await pg.wait_for_timeout(600)
    # Jack: his lines as tone bursts, fully timed
    await be("Jack"); await studio()
    jr = await pg.evaluate("Booth._test.myRuns().map(x=>[x.from,x.to])")
    tones = [[0.5+1.5*k, 1.3+1.5*k] for k in range(len(jr))]; anchors = [[t[0]+0.05, r[0]] for t, r in zip(tones, jr)] + [[t[1]-0.1, r[1]] for t, r in zip(tones, jr)]
    await pg.evaluate(SYN, {"len": 1.5*len(jr)+1, "tones": tones, "anchors": sorted(anchors), "name": "jack-syn.wav"})
    await pg.evaluate("Booth._test.sendToShared(true)"); await pg.wait_for_function("!Booth.state.busy", timeout=60000)
    # Anne: her lines (everything that isn't Jack's) as tone bursts with a pause before each, fully timed
    await be("Anne"); await studio()
    ar = await pg.evaluate("Booth._test.everyoneRuns().filter(x=>x.r==='Anne').map(x=>[x.from,x.to])")
    atones = [[0.6+1.8*k, 1.6+1.8*k] for k in range(len(ar))]
    full = sorted([[t[0]+0.05, r[0]] for t, r in zip(atones, ar)] + [[t[1]-0.1, r[1]] for t, r in zip(atones, ar)])
    await pg.evaluate(SYN, {"len": 1.8*len(ar)+1, "tones": atones, "anchors": full, "name": "anne-syn.wav"})
    await pg.evaluate("Booth._test.sendToShared(true)"); await pg.wait_for_function("!Booth.state.busy", timeout=60000)
    print("Anne's lines:", len(ar), "| Jack's lines:", len(jr))
    JC = "Booth.state.audio.tracks.flatMap(t=>t.clips).filter(c=>c.line&&c.line.r==='Jack').sort((a,b)=>a.line.from-b.line.from).map(c=>Math.round(c.at*100)/100)"
    async def bring():
        await be("Eddie")
        await pg.evaluate("Booth._test.bringInSends(true)"); await pg.wait_for_timeout(300); await pg.wait_for_function("!Booth.state.busy", timeout=60000); await pg.wait_for_timeout(300)
        return await pg.evaluate(JC), await pg.evaluate("Booth.state.audio.markers.filter(m=>/follow-along/.test(m.note)).map(m=>m.note.slice(0,70))")
    ref, f0 = await bring(); print("full timing → Jack's lines at:", ref, "| flags:", len(f0))
    # now Anne's send as if follow-along missed lines 2 and 4, and caught line 3 late
    miss = [ar[1][0], ar[3][0]]; late = ar[2][0]
    await pg.evaluate("""async ([miss, late, ar]) => { const s = await (await navigator.storage.getDirectory()).getDirectoryHandle('SharedBook'); const c = await s.getDirectoryHandle('Chapters');
      for await (const [n, h] of c.entries()) { if (h.kind !== 'directory') continue; let d; try { d = await h.getDirectoryHandle('Anne'); } catch (e) { continue; }
        const fh = await d.getFileHandle('send.json'), j = JSON.parse(await (await fh.getFile()).text());
        const rOf = w => ar.find(r => w >= r[0] && w <= r[1]);
        j.anchors = j.anchors.filter(q => { const r = rOf(q[1]); if (!r) return true; if (miss.includes(r[0])) return false; if (r[0] === late && q[1] === r[0]) return false; return true; });
        const late3 = ar.find(r => r[0] === late); j.anchors.push([0, 0]); j.anchors = j.anchors.filter(q => !(q[0] === 0 && q[1] === 0));
        const w = await fh.createWritable(); await w.write(JSON.stringify(j)); await w.close(); } }""", [miss, late, ar])
    got, fl = await bring(); print("missed/late timing → Jack's lines at:", got); print("flags:", fl)
    off = max(abs(a-b) for a, b in zip(ref, got)) if ref and len(ref) == len(got) else 99
    print("largest difference from full timing: %.2f s" % off)
    # Anne's lines have 0.8 s pauses between them: landing anywhere in the same pause is the same place
    if off > 0.5: ERR.append("lines landed in the wrong place without timing")
    if len(fl) != 3: ERR.append("expected 3 flags, got %d" % len(fl))
    print("ERR:", ERR); print("ERRORS:", errs); await b.close()
asyncio.run(main()); srv.terminate()
