# Booth sessions split across Drive conflict copies ("2026-11 (1).json") are merged, read and backed up whole.
from _env import *
import asyncio, subprocess, sys
from playwright.async_api import async_playwright
srv = subprocess.Popen([sys.executable,"-m","http.server","8647","-d",ROOT],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
U="http://localhost:8647/index.html?test"
async def main():
  async with async_playwright() as p:
    br = await p.chromium.launch(executable_path=CHROME, args=["--no-sandbox"])
    ctx = await br.new_context(); await ctx.add_init_script("try{localStorage.setItem('lr-me','Anne')}catch(e){}")
    pg = await ctx.new_page(); errs=[]; pg.on("pageerror", lambda e: errs.append(str(e))); ERR=[]
    await pg.goto(U+"#/library"); await pg.wait_for_function("window.Store && Store.root")
    ym = await pg.evaluate("new Date().toISOString().slice(0,7)")
    await pg.evaluate(f"""(async()=>{{ const d = await (await Store.root.getDirectoryHandle('Sessions',{{create:true}})).getDirectoryHandle('Anne',{{create:true}});
      const put = async (n, l) => {{ const w = await (await d.getFileHandle(n,{{create:true}})).createWritable(); await w.write(JSON.stringify(l)); await w.close(); }};
      await put('{ym} (1).json', [{{id:'a',date:'{ym}-02',boothSec:100}},{{id:'b',date:'{ym}-03',boothSec:200}}]);
      await new Promise(r=>setTimeout(r,50));
      await put('{ym}.json', [{{id:'b',date:'{ym}-03',boothSec:250}}]); }})()""")
    got = await pg.evaluate("Store._sessCache=null, Store.sessions('Anne',1).then(l=>l.map(s=>s.id+':'+s.boothSec).sort())"); print("read:", got)
    if got != ["a:100","b:250"]: ERR.append("copies not merged (newest wins)")
    await pg.evaluate(f"Store.saveSession('Anne', {{id:'c', date:'{ym}-04', boothSec:300}})")
    canon = await pg.evaluate(f"""(async()=>{{ const d = await (await Store.root.getDirectoryHandle('Sessions')).getDirectoryHandle('Anne'); return JSON.parse(await (await (await d.getFileHandle('{ym}.json')).getFile()).text()).map(s=>s.id).sort(); }})()""")
    print("after a new session, the month file holds:", canon)
    if canon != ["a","b","c"]: ERR.append("save dropped sessions from the copy")
    r = await pg.evaluate("LRBackup.make('test').then(async r => { const {zip} = await LRBackup.open(r.name); return Object.keys(zip.files).filter(n=>n.startsWith('Sessions/')); })"); print("in the backup:", r)
    if not any("(1)" in n for n in r): ERR.append("conflict copy left out of the backup")
    print("ERR:", ERR); print("ERRORS:", errs); await br.close()
asyncio.run(main()); srv.terminate()
