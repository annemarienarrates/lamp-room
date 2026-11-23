# Builds the guide PDFs (Mac and PC editions) from guide/src. Run once per batch of changes, not on every fix:
#   python3 dev/tools/mkpdf.py
import asyncio, os, subprocess, sys
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CHROME = os.environ.get("LR_CHROME", "/usr/bin/google-chrome")
from playwright.async_api import async_playwright
srv = subprocess.Popen([sys.executable,"-m","http.server","8781","-d",ROOT],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
async def main():
  async with async_playwright() as p:
    b = await p.chromium.launch(executable_path=CHROME, args=["--no-sandbox"])
    pg = await b.new_page()
    errs=[]; pg.on("pageerror", lambda e: errs.append(str(e)))
    await pg.goto("http://localhost:8781/guide/src/guide.html"); await pg.wait_for_timeout(1200)
    await pg.pdf(path=ROOT+"/guide/Lamp Room Guide.pdf", format="Letter", print_background=True, prefer_css_page_size=True)
    await pg.goto("http://localhost:8781/guide/src/keyboard.html"); await pg.wait_for_timeout(1200)
    await pg.pdf(path=ROOT+"/guide/Lamp Room Keyboard.pdf", print_background=True, prefer_css_page_size=True)
    await pg.goto("http://localhost:8781/guide/src/guide.html?pc"); await pg.wait_for_timeout(1500)
    await pg.pdf(path=ROOT+"/guide/Lamp Room Guide (PC).pdf", format="Letter", print_background=True, prefer_css_page_size=True)
    await pg.goto("http://localhost:8781/guide/src/keyboard.html?pc"); await pg.wait_for_timeout(1500)
    await pg.pdf(path=ROOT+"/guide/Lamp Room Keyboard (PC).pdf", print_background=True, prefer_css_page_size=True)
    await pg.goto("http://localhost:8781/guide/src/fx.html"); await pg.wait_for_timeout(1200)
    await pg.pdf(path=ROOT+"/guide/Lamp Room FX Guide.pdf", format="Letter", print_background=True, prefer_css_page_size=True)
    for who, name in [("conarr", "Co-narrator Quick Start")]:
      for pc in ["", "&pc"]:
        await pg.goto(f"http://localhost:8781/guide/src/start.html?who={who}{pc}"); await pg.wait_for_timeout(1000)
        await pg.pdf(path=ROOT+f"/guide/Lamp Room {name}{' (PC)' if pc else ''}.pdf", format="Letter", print_background=True, prefer_css_page_size=True)
    print("ERR", errs); await b.close()
asyncio.run(main()); srv.terminate()
