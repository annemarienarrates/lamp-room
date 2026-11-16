/* The Lamp Room — reads a Word .docx directly so run shading and highlights survive.
   Returns blocks: [{ text, heading, runs: [[text, part], ...] }] (see Prep.partOfColor for parts). */
(function () {
  "use strict";
  const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const kids = (el, name) => [...el.childNodes].filter(n => n.nodeType === 1 && n.localName === name && n.namespaceURI === W);
  const kid = (el, name) => kids(el, name)[0] || null;
  const attr = (el, name) => el ? (el.getAttributeNS(W, name) || el.getAttribute("w:" + name)) : null;

  async function readDocx(arrayBuffer) {
    const zip = await JSZip.loadAsync(arrayBuffer);
    const docXml = await zip.file("word/document.xml").async("string");
    const stylesFile = zip.file("word/styles.xml");
    const styleNames = {}, styleShade = {};
    if (stylesFile) {
      const sd = new DOMParser().parseFromString(await stylesFile.async("string"), "application/xml");
      for (const st of sd.getElementsByTagNameNS(W, "style")) {
        const id = attr(st, "styleId"), nm = kid(st, "name");
        styleNames[id] = (attr(nm, "val") || id || "").toLowerCase();
        const rpr = kid(st, "rPr"); const c = rpr && runColor(rpr); if (c) styleShade[id] = c;
      }
    }
    const doc = new DOMParser().parseFromString(docXml, "application/xml");
    const body = doc.getElementsByTagNameNS(W, "body")[0];
    const blocks = [];
    const walkParas = el => {
      for (const n of el.childNodes) {
        if (n.nodeType !== 1) continue;
        if (n.localName === "p") blocks.push(readPara(n, styleNames, styleShade));
        else if (["tbl", "tr", "tc", "sdt", "sdtContent", "customXml"].includes(n.localName)) walkParas(n);
      }
    };
    walkParas(body);
    return blocks;
  }

  // highlight or shading colour of a run's properties, or null
  function runColor(rpr) {
    const hl = attr(kid(rpr, "highlight"), "val");
    if (hl && hl !== "none") return hl;
    const fill = attr(kid(rpr, "shd"), "fill");
    if (fill && !/^(auto|FFFFFF)$/i.test(fill)) return fill.toUpperCase();
    return null;
  }

  function readPara(p, styleNames, styleShade) {
    const ppr = kid(p, "pPr");
    const styleId = attr(kid(ppr || p, "pStyle"), "val");
    const sname = styleNames[styleId] || (styleId || "").toLowerCase();
    const heading = /^(heading ?[1-3]|title)$/.test(sname);
    const paraFill = ppr ? attr(kid(ppr, "shd"), "fill") : null;
    const paraColor = paraFill && !/^(auto|FFFFFF)$/i.test(paraFill) ? paraFill.toUpperCase() : null;
    const runs = [];
    const walk = el => {
      for (const n of el.childNodes) {
        if (n.nodeType !== 1) continue;
        const ln = n.localName;
        if (ln === "r") readRun(n);
        else if (["del", "moveFrom", "pPr", "rPr"].includes(ln)) continue;          // deleted text and properties
        else walk(n);                                                                   // hyperlink, ins, smartTag, fldSimple…
      }
    };
    const readRun = r => {
      const rpr = kid(r, "rPr");
      const rs = rpr ? attr(kid(rpr, "rStyle"), "val") : null;
      const color = (rpr && runColor(rpr)) || (rs && styleShade[rs]) || paraColor;
      let text = "";
      for (const n of r.childNodes) {
        if (n.nodeType !== 1) continue;
        if (n.localName === "t") text += n.textContent;
        else if (n.localName === "tab") text += " ";
        else if (n.localName === "br" || n.localName === "cr") text += " ";
        else if (n.localName === "noBreakHyphen") text += "-";
      }
      if (text) runs.push([text, Prep.partOfColor(color)]);
    };
    walk(p);
    return { text: runs.map(r => r[0]).join(""), heading, runs };
  }

  window.readDocx = readDocx;
})();
