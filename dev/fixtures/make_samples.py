import random
from docx import Document
from reportlab.lib.pagesizes import letter
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
random.seed(1)
W="the of and to in a was he she it that his her with as for on had at by not but from they said".split()
def para(n=80):
    s=" ".join(random.choice(W) for _ in range(n)); return s.capitalize()+"."
nums=["One","Two","Three","Four","Five","Six"]
# DOCX: title page, TOC, Chapter X + subtitle (Heading 1 style), scene breaks
d=Document(); d.add_paragraph("THE SALT CROWN"); d.add_paragraph("by Test Author"); d.add_paragraph("Contents")
for n in nums: d.add_paragraph("Chapter "+n)
d.add_heading("Prologue",1)
for _ in range(3): d.add_paragraph(para())
for i,n in enumerate(nums):
    d.add_heading("Chapter "+n,1); d.add_paragraph("The Drowned Road" if i==0 else "A Quieter Knife")
    for k in range(8):
        d.add_paragraph(para()); 
        if k==3: d.add_paragraph("* * *")
d.add_paragraph("Epilogue")
d.add_paragraph(para())
d.save("sample.docx")
# PDF: running header, page numbers, bare-number chapters, hard wrapped lines
ss=getSampleStyleSheet(); body=ParagraphStyle('b',parent=ss['Normal'],firstLineIndent=18,leading=14)
def onpage(c,doc):
    c.saveState(); c.setFont("Helvetica",9); c.drawCentredString(306,760,"THE SALT CROWN"); c.drawCentredString(306,30,str(doc.page)); c.restoreState()
story=[]
for ch in range(1,5):
    story.append(Paragraph(str(ch),ss['Heading1']))
    for _ in range(10): story.append(Paragraph(para(120)+" Well-intentioned extra-long hyphenation-heavy words appear here.",body))
    story.append(PageBreak())
SimpleDocTemplate("sample.pdf",pagesize=letter).build(story,onFirstPage=onpage,onLaterPages=onpage)
print("ok")
