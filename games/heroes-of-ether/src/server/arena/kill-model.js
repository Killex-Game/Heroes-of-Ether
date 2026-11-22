"use strict";
// A small, local, supervised model. It routes cases to people; it never bans.
// No model is enabled before both classes have enough independently reviewed players.
const clamp = n => Math.max(0, Math.min(1, n));
const sigmoid = n => 1 / (1 + Math.exp(-Math.max(-20, Math.min(20, n))));
function train(audit = []) {
  const latest = new Map();
  for (let i = audit.length - 1; i >= 0 && latest.size < 512; i--) {
    const e = audit[i], c = e?.action === 'killReview' && e.after?.case;
    if (!c || ['gift-dispatch-pattern','owner-reported-automation'].includes(c.reason) || !['confirmed','dismissed'].includes(c.status) || latest.has(e.targetId) ||
        !Array.isArray(c.features) || c.features.length !== 5 || !c.features.every(v => Number.isFinite(v) && v >= 0 && v <= 1)) continue;
    latest.set(e.targetId, { x:c.features, y:c.status === 'confirmed' ? 1 : 0 });
  }
  const rows = [...latest.values()], positive = rows.filter(r=>r.y).length, negative = rows.length-positive;
  const result = { version:1, ready:positive>=16 && negative>=16, positive, negative, weights:[0,0,0,0,0,0] };
  if (!result.ready) return result;
  // Balanced, regularized logistic regression; fixed ordering is reproducible.
  for (let epoch=0;epoch<80;epoch++) {
    const gradient = result.weights.map((w,i)=>i ? 0.02*w : 0);
    for (const {x,y} of rows) {
      const error = (predict(result,x)-y) / (2*(y?positive:negative));
      gradient[0]+=error;
      for(let i=0;i<5;i++)gradient[i+1]+=error*x[i];
    }
    for(let i=0;i<6;i++)result.weights[i]-=0.8*gradient[i];
  }
  return result;
}
function predict(model, x) { return sigmoid(model.weights[0]+x.reduce((n,v,i)=>n+model.weights[i+1]*clamp(v),0)); }
module.exports={train,predict};
