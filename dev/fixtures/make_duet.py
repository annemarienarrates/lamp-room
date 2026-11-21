from docx import Document
from docx.oxml.ns import qn
from docx.oxml import OxmlElement
from docx.enum.text import WD_COLOR_INDEX
import random
random.seed(3)
W="the of and to in a was he she it that his her with as for on had at by not but from they".split()
def nar(n=40): return " ".join(random.choice(W) for _ in range(n)).capitalize()+"."
def shade(run,hexc):
    rpr=run._r.get_or_add_rPr(); shd=OxmlElement('w:shd'); shd.set(qn('w:val'),'clear'); shd.set(qn('w:color'),'auto'); shd.set(qn('w:fill'),hexc); rpr.append(shd)
d=Document()
for ch in range(1,4):
    d.add_heading(f"Chapter {ch}",1)
    for k in range(6):
        p=d.add_paragraph(nar())
        p=d.add_paragraph(); r=p.add_run("“Hold the gate, all of you,”"); shade(r,"BDD7EE"); p.add_run(" the captain said. ")
        r=p.add_run("“Now.”"); shade(r,"BDD7EE")
        p=d.add_paragraph(); r=p.add_run("“I will not,”"); shade(r,"F8CBDE"); p.add_run(" Mara answered, and turned away.")
        if k==2:
            p=d.add_paragraph(); r=p.add_run("[Skill gained: Iron Will]"); r.font.highlight_color=WD_COLOR_INDEX.YELLOW
d.save("duet.docx"); print("ok")
