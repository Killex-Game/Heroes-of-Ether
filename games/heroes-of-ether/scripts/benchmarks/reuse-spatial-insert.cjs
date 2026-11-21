"use strict";
const assert=require('node:assert/strict');
function candidateSource(source){
  source=source.replace(/\r\n/g,'\n');
  const replacements=[
    ['bodies.forEach((body, index) =>\n      this.visitCells(body, (x, y) => {','let index = 0;\n    const insert = (x, y) => {'],
    ['      }, centersOnly ? 0 : body.radius),\n    );','    };\n    for (; index < bodies.length; index++) {\n      const body = bodies[index];\n      this.visitCells(body, insert, centersOnly ? 0 : body.radius);\n    }'],
  ];
  for(const [from,to] of replacements){assert.equal(source.split(from).length,2,'single spatial insertion source match');source=source.replace(from,to);}
  return source;
}
module.exports={candidateSource};
