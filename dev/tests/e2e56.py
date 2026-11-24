# Auphonic: the key stays on this computer and is checked; Export ▸ Master with Auphonic uploads a FLAC in the background
# (one file with the preset, or for love scenes a track per reader with each reader's own preset for noise and breath),
# named for delivery; the result comes back to Studio ▸ Mastered ▸ <book> by itself: straight from Auphonic, or, when
# the download is refused, through the Google Drive folder Auphonic writes to. Auphonic itself is faked here.
from _env import *
import asyncio, subprocess, sys, json
from playwright.async_api import async_playwright
srv = subprocess.Popen([sys.executable,"-m","http.server","8656","-d",ROOT],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
U="http://localhost:8656/index.html?test"
CORS = {"Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type", "Access-Control-Allow-Methods": "GET, POST, OPTIONS"}
PRESETS = [{"uuid":"pNorm","preset_name":"Audiobooks_Normal Breath","is_multitrack":False},{"uuid":"pBre","preset_name":"Auphonic_Breathy","is_multitrack":False}]
DETAIL = {"pNorm": {"algorithms":{"denoise":True,"denoisemethod":"dynamic","debreathamount":100,"leveler":True,"loudnesstarget":-19},"output_files":[{"format":"mp3","bitrate":"192"}]},
          "pBre": {"algorithms":{"denoise":True,"denoisemethod":"dynamic","debreathamount":30,"leveler":True,"loudnesstarget":-19},"output_files":[{"format":"mp3"}]}}
seen = []
async def fake(route, req):
    if req.method == "OPTIONS": return await route.fulfill(status=200, headers=CORS)
    url = req.url.split("auphonic.com/api")[1]; seen.append((req.method, url, req.headers.get("authorization"), req.post_data_buffer))
    ok = lambda d: route.fulfill(status=200, headers=dict(CORS, **{"Content-Type":"application/json"}), body=json.dumps({"status_code":200,"data":d}))
    if req.headers.get("authorization") != "bearer test-key-123": return await route.fulfill(status=403, headers=CORS, body=json.dumps({"status_code":403,"error_message":"Token doesn't exist"}))
    if url.startswith("/user.json"): return await ok({"username":"anne","credits":12.5})
    if url.startswith("/presets.json"): return await ok(PRESETS)
    if url.startswith("/preset/"): return await ok(DETAIL[url.split("/")[2].split(".")[0]])
    if url.startswith("/services.json"): return await ok([{"uuid":"svcGD","type":"googledrive","display_name":"My Google Drive"}])
    if url == "/productions.json": return await ok({"uuid": "prodM" if b'"is_multitrack": true' in (req.post_data_buffer or b"").replace(b'":true',b'": true') else "prodS"})
    if "/upload.json" in url or "/start.json" in url: return await ok({})
    if url.startswith("/production/"): return await ok({"status":3,"status_string":"Done","output_files":[{"format":"mp3","ending":"mp3","download_url":"https://auphonic.com/api/download/audio-result/"+url.split("/")[2].split(".")[0]+"/x.mp3"}]})
    if url.startswith("/download/audio-result/prodS"): return await route.abort("accessdenied")   # refused, as a cross-site redirect without CORS is
    if url.startswith("/download/"): return await route.fulfill(status=200, headers=dict(CORS, **{"Content-Type":"audio/mpeg"}), body=b"ID3fake-mastered-audio")
    await route.fulfill(status=404, headers=CORS, body="{}")
async def main():
  async with async_playwright() as p:
    b = await p.chromium.launch(executable_path=CHROME, args=["--no-sandbox","--use-fake-device-for-media-stream","--use-fake-ui-for-media-stream","--autoplay-policy=no-user-gesture-required"])
    ctx = await b.new_context(permissions=["microphone"], viewport={"width":1440,"height":900}); await ctx.add_init_script("try{localStorage.setItem('lr-me','Anne')}catch(e){}")
    pg = await ctx.new_page(); ERR=[]; errs=[]; pg.on("pageerror", lambda e: errs.append(str(e))); pg.on("crash", lambda: print("PAGE CRASHED", flush=True)); pg.on("console", lambda m: print("console:", m.type, m.text[:200], flush=True) if m.type in ("error","warning") else None); pg.on("close", lambda: print("PAGE CLOSED", flush=True))
    await pg.route("https://auphonic.com/**", fake)
    await pg.goto(U+"#/import"); await pg.wait_for_timeout(500)
    await pg.set_input_files("#file",FIX+"/duet.docx"); await pg.wait_for_selector("#create"); await pg.fill("#it","Ember Hearts"); await pg.click("#create"); await pg.wait_for_function("Store.books.length===1"); await pg.wait_for_timeout(500)
    bid = await pg.evaluate("Store.books[0].id")
    await pg.evaluate("(()=>{const b=Store.books[0]; b.parts=Object.assign({}, b.parts, {n:'Anne', f:'Anne', m:'Jack'}); Store.saveBook(b,true);})()")
    # the key: a wrong one is refused, the right one connects and lists the presets
    await pg.goto(U+"#/settings?tab=computer"); await pg.wait_for_selector("#aupkey")
    await pg.fill("#aupkey","wrong"); await pg.click("#aupsave"); await pg.wait_for_function("!/Checking/.test(document.querySelector('#aupstat').textContent)")
    bad = await pg.inner_text("#aupstat"); print("wrong key:", bad)
    await pg.fill("#aupkey","test-key-123"); await pg.click("#aupsave"); await pg.wait_for_function("/Connected|didn't/.test(document.querySelector('#aupstat').textContent)")
    good = await pg.inner_text("#aupstat"); print("right key:", good)
    if "didn't accept" not in bad or "Connected as anne" not in good or "Auphonic_Breathy" not in good: ERR.append("key check")
    inlib = await pg.evaluate("JSON.stringify(Store.settings).includes('test-key-123') || JSON.stringify(Store.books).includes('test-key-123')"); print("key in the Library:", inlib)
    if inlib: ERR.append("the key leaked into the Library")
    # a chapter with Anne's narration and one of Jack's lines on its own track
    await pg.goto(U+f"#/booth/{bid}/0"); await pg.wait_for_selector("#booth-dock"); await pg.wait_for_timeout(800)
    await pg.evaluate("Booth.state.prerollSec=0"); await pg.keyboard.press("r"); await pg.wait_for_timeout(2500); await pg.keyboard.press("s"); await pg.wait_for_timeout(900)
    await pg.evaluate("(()=>{const a=Booth.state.audio, c=a.tracks[0].clips[0]; while(a.tracks.length<2) a.tracks.push({clips:[]}); a.tracks[1].clips=[Object.assign({}, c, {at:c.at+0.2, dur:Math.min(c.dur,1), line:{r:'Jack', from:5}})];})()")
    await pg.evaluate("Booth._test.exportDialog()"); await pg.wait_for_selector("[data-f=auphonic]"); await pg.click("[data-f=auphonic]"); await pg.wait_for_selector("#aupmain"); await pg.wait_for_timeout(600)
    main = await pg.evaluate("document.querySelector('#aupmain').selectedOptions[0].textContent"); print("preset chosen:", main)
    if main != "Audiobooks_Normal Breath": ERR.append("Normal Breath should be the default")
    # love scene: a track each, Anne breathy
    await pg.click("#aupmulti"); await pg.wait_for_selector("[data-aupr]")
    await pg.select_option("[data-aupr=Anne]", "pBre")
    await pg.screenshot(path="shots/auphonic.png")
    await pg.click("#xgo"); await pg.wait_for_function("!document.querySelector('.overlay #xgo')", timeout=60000); await pg.wait_for_timeout(500)
    calls = [(m,u) for m,u,a,_ in seen]; print("calls:", calls)
    body = json.loads(next(d for m,u,a,d in seen if u == "/productions.json"))
    tracks = {t["id"]: t["algorithms"] for t in body["multi_input_files"]}; print("tracks:", tracks, "| master:", body["algorithms"])
    if not body.get("is_multitrack") or set(tracks) != {"Anne","Jack"}: ERR.append("multitrack should have a track per reader")
    if body.get("output_basename") != "001_Chapter_01": ERR.append("result should be named for delivery")
    if tracks.get("Anne",{}).get("debreathamount") != 30 or tracks.get("Jack",{}).get("debreathamount") != 100: ERR.append("each reader's breath setting should come from their preset")
    if "debreathamount" in body["algorithms"] or body["algorithms"].get("loudnesstarget") != -19: ERR.append("master settings should be the mix's, without track settings")
    await pg.wait_for_function("LRAuphonic.jobs().every(j=>!j.up)", timeout=30000)
    up = next(d for m,u,a,d in seen if "/upload.json" in u)
    if b'name="Anne"' not in up or b'name="Jack"' not in up: ERR.append("both tracks should be uploaded under their names")
    if b"fLaC" not in up: ERR.append("uploads should be FLAC")
    print("upload size:", len(up), "bytes (FLAC)")
    if not any("/start.json" in u for m,u in calls): ERR.append("production not started")
    # the poller brings it home
    await pg.evaluate("LRAuphonic.poll()"); await pg.wait_for_function("LRAuphonic.jobs().length===0", timeout=20000)
    got = await pg.evaluate("(async()=>{const b=Store.books[0]; const d=await (await Store.studio.getDirectoryHandle('Mastered')).getDirectoryHandle(b.folder); const out=[]; for await (const [n,h] of d.entries()) out.push(n+':'+(await h.getFile()).size); return out;})()")
    st = await pg.evaluate("Store.books[0].chapters[0].status"); print("mastered files:", got, "| chapter:", st)
    if not got or not got[0].endswith(".mp3:22") or st != "mastered": ERR.append("result not brought home")
    tmp = await pg.evaluate("(async()=>{const d=await (await Store.studio.getDirectoryHandle(Store.books[0].folder)).getDirectoryHandle('auphonic-upload'); const o=[]; for await (const [n] of d.entries()) o.push(n); return o;})()"); print("left in the upload folder:", tmp)
    if tmp: ERR.append("upload files not cleaned up")
    # one reader, results through Google Drive: the download is refused, so it waits for Drive, then files it
    await pg.goto(U+"#/settings?tab=computer"); await pg.wait_for_selector("#aupsvcload"); await pg.click("#aupsvcload"); await pg.wait_for_timeout(500)
    await pg.select_option("#aupsvc", "svcGD"); await pg.wait_for_timeout(200)
    await pg.evaluate("(async()=>{const h=await Store.root.getDirectoryHandle('_gdrive_auphonic',{create:true}); await Store.keepFolder('auphonic-drive', h);})()")
    await pg.goto(U+f"#/booth/{bid}/0"); await pg.wait_for_selector("#booth-dock"); await pg.wait_for_timeout(800)
    seen.clear()
    await pg.evaluate("Booth._test.exportDialog()"); await pg.click("[data-f=auphonic]"); await pg.wait_for_selector("#aupmain"); await pg.wait_for_timeout(500)
    if await pg.is_checked("#aupmulti"): await pg.click("#aupmulti"); await pg.wait_for_timeout(200)
    await pg.click("#xgo"); await pg.wait_for_function("!document.querySelector('.overlay #xgo')", timeout=60000)
    await pg.wait_for_function("LRAuphonic.jobs().length && LRAuphonic.jobs().every(j=>!j.up)", timeout=30000)
    body = json.loads(next(d for m,u,a,d in seen if u == "/productions.json")); print("single production:", body)
    if body.get("preset") != "pNorm" or body.get("outgoing_services") != [{"uuid":"svcGD"}] or body.get("output_basename") != "001_Chapter_01": ERR.append("single production: preset, Drive service and name")
    await pg.evaluate("LRAuphonic.poll()"); await pg.wait_for_timeout(1500)
    st1 = await pg.evaluate("LRAuphonic.jobs().map(j=>j.state)"); print("before Drive brings it:", st1)
    if not st1 or "Waiting for Google Drive" not in st1[0]: ERR.append("should wait for Drive when the download is refused")
    heads = await pg.goto(U+"#/library"); await pg.wait_for_timeout(600)
    hu = await pg.evaluate("[...document.querySelectorAll('.head-row')].map(r=>r.innerText).filter(t=>t.includes('🎚'))"); print("Heads up:", hu)
    if not hu: ERR.append("Auphonic job not in Heads up")
    # Drive brings it down (in a subfolder, as Auphonic may do)
    await pg.evaluate("(async()=>{const h=await (await Store.root.getDirectoryHandle('_gdrive_auphonic')).getDirectoryHandle('auphonic-results',{create:true}); const w=await (await h.getFileHandle('001_Chapter_01.mp3',{create:true})).createWritable(); await w.write('ID3from-drive'); await w.close();})()")
    await pg.evaluate("LRAuphonic.poll()"); await pg.wait_for_function("LRAuphonic.jobs().length===0", timeout=20000)
    got = await pg.evaluate("(async()=>{const b=Store.books[0]; const d=await (await Store.studio.getDirectoryHandle('Mastered')).getDirectoryHandle(b.folder); return (await (await d.getFileHandle('001_Chapter_01.mp3')).getFile()).text();})()")
    gone = await pg.evaluate("(async()=>{const h=await (await Store.root.getDirectoryHandle('_gdrive_auphonic')).getDirectoryHandle('auphonic-results'); const o=[]; for await (const [n] of h.entries()) o.push(n); return o;})()")
    print("filed from Drive:", got, "| left in Drive folder:", gone)
    if got != "ID3from-drive" or gone: ERR.append("Drive result not filed into Studio ▸ Mastered")
    print("ERR:", ERR); print("ERRORS:", errs); await b.close()
asyncio.run(main()); srv.terminate()
