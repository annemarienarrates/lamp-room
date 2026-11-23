# A made-up full-cast manuscript shaded in the Lamp Room's fixed colours, and its casting sheet (CSV).
# Blue = Jack Smith (Corin, Jax), pink = Anne Marie (Wren), mint = Rowan Pike (Isolde), lavender = Tess Morrow (Marek, the System).
import os, random
from docx import Document
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
HERE = os.path.dirname(os.path.abspath(__file__)); random.seed(7)
COL = {"jack": "BDD7EE", "anne": "F8CBDE", "rowan": "C1F0C1", "tess": "D9C2F0"}
def shade(run, fill):
    rpr = run._r.get_or_add_rPr(); sh = OxmlElement("w:shd"); sh.set(qn("w:val"), "clear"); sh.set(qn("w:color"), "auto"); sh.set(qn("w:fill"), fill); rpr.append(sh)
def para(doc, *bits):
    p = doc.add_paragraph()
    for t, who in bits:
        r = p.add_run(t)
        if who: shade(r, COL[who])
LINES = [  # (before, line, after, who)
    ("", "“Hold the gate,”", " Corin said, and turned toward the cliffs.", "jack"),
    ("Wren shook her head. ", "“Not tonight.”", "", "anne"),
    ("", "“Then we wait for the tide,”", " said Isolde.", "rowan"),
    ("", "“You will wait for nothing,”", " Marek growled from the dark.", "tess"),
    ("A chime sounded in Wren's ear. ", "[Quest accepted: The Long Night.]", "", "tess"),
    ("Corin looked at Wren. ", "“Go. I'll follow.”", "", "jack"),
    ("", "“It always comes to this,”", " Jax muttered.", "jack"),
    ("", "“I know,”", " Wren whispered.", "anne"),
    ("Isolde laughed. ", "“The bells, listen.”", "", "rowan"),
    ("", "“One more hour,”", " Old Marek said.", "tess"),
]
doc = Document()
for ch in range(1, 4):
    doc.add_paragraph(f"Chapter {ch}")
    doc.add_paragraph("The road bent north along the cliffs and the wind came in off the water, cold and smelling of salt and old rope.")
    for b, l, a, who in random.sample(LINES, len(LINES)):
        para(doc, (b, None), (l, who), (a, None))
        doc.add_paragraph("They went on in silence for a while, and the lamps of the harbour fell away behind them.")
doc.save(os.path.join(HERE, "castsheet.docx"))
open(os.path.join(HERE, "castsheet.csv"), "w").write('Character,Actor,Gender\nNarrator,Anne Marie,F\nWREN,Anne Marie,F\nCORIN,Jack Smith,M\nJAX,Jack Smith,M\nISOLDE,Rowan Pike,F\n"OLD MAREK",Tess Morrow,M\nTHE SYSTEM,Tess Morrow,\nGUARD,Ned Hollis,M\n')
print("ok")
