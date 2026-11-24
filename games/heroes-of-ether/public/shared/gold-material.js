/* Selective material correction. The masks reject blue, violet, green and
   reddish leather; only yellow/gold pixels of the selected UI elements change. */
(() => {
  "use strict";
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.id = "goldMaterialDefinitions";
  svg.setAttribute("width", "0");
  svg.setAttribute("height", "0");
  svg.setAttribute("aria-hidden", "true");
  svg.style.cssText = "position:fixed;pointer-events:none;overflow:hidden";
  svg.innerHTML = `<defs><filter id="killex-saturated-gold" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
    <feColorMatrix in="SourceGraphic" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  6 -6 0 0 -0.08" result="warm"/>
    <feColorMatrix in="SourceGraphic" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  -10 20 -10 0 -0.05" result="yellow"/>
    <feComposite in="warm" in2="yellow" operator="in" result="goldMask"/>
    <feColorMatrix in="SourceGraphic" type="saturate" values="1.75" result="rich"/>
    <feComponentTransfer in="rich" result="bright">
      <feFuncR type="linear" slope="1.15"/><feFuncG type="linear" slope="1.15"/><feFuncB type="linear" slope="1.12"/>
    </feComponentTransfer>
    <feComposite in="bright" in2="goldMask" operator="in" result="selected"/>
    <feComposite in="SourceGraphic" in2="goldMask" operator="out" result="untouched"/>
    <feComposite in="selected" in2="untouched" operator="arithmetic" k2="1" k3="1"/>
  </filter><filter id="killex-rich-gold-frame" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
    <feColorMatrix type="saturate" values="2.1"/>
    <feComponentTransfer><feFuncR type="linear" slope="1.15"/><feFuncG type="linear" slope="1.17"/><feFuncB type="linear" slope="1.05"/></feComponentTransfer>
  </filter></defs>`;
  document.body.append(svg);
})();
