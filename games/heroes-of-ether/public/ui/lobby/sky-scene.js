/* Animate lobby water and fire in the painted landscape's source coordinates.
   One GPU surface, no image readback, no work while the arena is visible. */
"use strict";
(() => {
  const lobbyRoot = document.getElementById("lobby");
  if (!lobbyRoot) return;
  // Reuse one GPU surface for the visible scene; an open mini-profile replaces it.
  let lobby = lobbyRoot, profileScene = false;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  let canvas,
    gl,
    program,
    texture,
    image,
    frame = 0,
    frameTimer = 0,
    elapsed = 0,
    previous = 0;
  let loadedTheme = "";
  let loaded = false,
    failed = false,
    lost = false,
    covered = false,
    resizePending = true;
  let locations;
  const vertex = `
    attribute vec2 position;
    varying vec2 uv;
    void main() {
      uv = vec2((position.x + 1.0) * .5, (1.0 - position.y) * .5);
      gl_Position = vec4(position, 0.0, 1.0);
    }`;
  const fragment = `
    precision highp float;
    uniform sampler2D scene;
    uniform vec2 viewport;
    uniform vec4 sceneRect;
    uniform float citadel;
    uniform float royal;
    uniform float heroic;
    uniform float portrait;
    uniform float time;
    varying vec2 uv;
    const vec2 sourceSize = vec2(1920.0, 1080.0);

    float rectangle(vec2 p, vec4 box) {
      vec2 feather = max(citadel, heroic) > .5 ? vec2(2.0, 2.0) : vec2(6.0, 16.0);
      vec2 a = smoothstep(box.xy, box.xy + feather, p);
      vec2 b = 1.0 - smoothstep(box.zw - vec2(feather.x, 20.0), box.zw, p);
      return a.x * a.y * b.x * b.y;
    }
    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
    }
    float noise(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1., 0.)), f.x),
        mix(hash(i + vec2(0., 1.)), hash(i + vec2(1., 1.)), f.x), f.y);
    }
    // Water has continuous downward advection, not a flashing horizontal band.
    // Only the water material changes; the painted rocks and banks never move.
    vec3 water(vec3 base, vec2 p, vec4 box, float phase) {
      float mask = rectangle(p, box);
      if (mask < .001) return base;
      float x = p.x - box.x, y = p.y - box.y;
      float speed = 105.0 + phase * 34.0;
      float streams = noise(vec2(x * .28 + phase * 13.0, (y - time * speed) * .026));
      float threads = noise(vec2(x * .65 + phase * 7.0, (y - time * speed * 1.32) * .065));
      float mist = noise(vec2(x * .13, (y - time * speed * .72) * .047 + phase));
      float foam = smoothstep(.43, .78, streams * .64 + threads * .36);
      float trough = smoothstep(.48, .78, 1.0 - streams);
      vec3 result = mix(base, vec3(.50, .73, .86), mask * trough * .24);
      result = mix(result, vec3(.94, .98, 1.0), mask * foam * .70);
      float foot = smoothstep(.65, .95, y / (box.w - box.y));
      return mix(result, vec3(.94, .97, 1.0), mask * foot * mist * .12);
    }
    vec3 bubble(vec3 base, vec2 p, float seed) {
      float cycle = fract(time / (66.0 + seed * 2.7) + seed * .137);
      vec2 centre = vec2(150.0 + mod(seed * 277.0, 1630.0), 1160.0 - cycle * 1340.0);
      centre.x += sin(time * .17 + seed * 2.1) * (18.0 + seed * 2.0);
      float radius = 11.0 + mod(seed * 7.0, 21.0);
      vec2 q = (p - centre) / radius;
      float d = length(q);
      if (d > 1.1) return base;
      float fade = smoothstep(0.0, .09, cycle) * (1.0 - smoothstep(.86, 1.0, cycle));
      float edge = smoothstep(.83, .96, d) * (1.0 - smoothstep(.97, 1.06, d));
      vec3 pearl = .78 + .2 * cos(vec3(0.0, 2.1, 4.2) + q.x * 3.1 + q.y * 2.0 + time * .22);
      float highlight = exp(-length(q - vec2(-.38, -.58)) * 12.0);
      float inside = (1.0 - smoothstep(.7, 1.0, d)) * .035;
      return mix(base, pearl, (edge * .42 + inside + highlight * .65) * fade);
    }
    float flicker(float seed) {
      return noise(vec2(time * 3.4, seed)) * .55
        + noise(vec2(time * 1.7, seed + 9.0)) * .30
        + sin(time * 2.3 + seed) * .075 + .075;
    }
    vec3 torch(vec3 base, vec2 p, vec2 root, vec2 size, float seed) {
      vec2 q = (p - root) / size;
      if (abs(q.x) > 4.5 || abs(q.y) > 3.8) return base;
      float pulse = flicker(seed);
      // Local warm light. Each fire has its own rhythm, never a full-screen flash.
      float glow = exp(-dot(q / vec2(2.2, 1.8), q / vec2(2.2, 1.8)) * 1.8);
      base += vec3(.11, .052, .012) * glow * (pulse - .35);
      if (q.y < 0.0 && q.y > -1.35 && abs(q.x) < 1.3) {
        float h = clamp(-q.y, 0.0, 1.25);
        float bend = (noise(vec2(h * 2.8 - time * 2.2, seed)) - .5) * 11.0 * h;
        float stretch = 1.0 + (pulse - .5) * .20;
        vec2 source = vec2(p.x - bend, root.y + (p.y - root.y) / stretch);
        vec3 warped = texture2D(scene, source / sourceSize).rgb;
        vec3 original = texture2D(scene, p / sourceSize).rgb;
        float warm = max(original.r - original.b, warped.r - warped.b);
        float bright = max(original.g, warped.g);
        float flame = smoothstep(.22, .50, warm) * smoothstep(.40, .68, bright);
        float edge = (1.0 - smoothstep(.85, 1.3, abs(q.x)))
          * (1.0 - smoothstep(1.05, 1.35, h)) * smoothstep(0.0, .08, h);
        base = mix(base, warped * (1.0 + (pulse - .5) * .10), flame * edge);
      }
      // Few short-lived sparks, rising from inside the bowl.
      for (int i = 0; i < 3; i++) {
        float n = float(i), age = fract(time * (.23 + n * .04) + seed * .17 + n * .31);
        vec2 spark = root + vec2(sin(age * 5.0 + seed + n) * size.x * .32,
          -size.y * (.38 + age * 1.25));
        float d = length((p - spark) / vec2(1.2, 2.1));
        float fade = smoothstep(0.0, .16, age) * (1.0 - smoothstep(.65, 1.0, age));
        base += vec3(.62, .29, .07) * exp(-d * d * 1.5) * fade;
      }
      return base;
    }
    vec3 royalFire(vec3 base, vec2 p) {
      // Source anchors are the tops of the painted bowls, not the light halos.
      base = torch(base, p, vec2(345., 535.), vec2(38., 100.), 1.0);
      base = torch(base, p, vec2(1574., 535.), vec2(40., 108.), 4.7);
      base = torch(base, p, vec2(660., 215.), vec2(27., 65.), 8.3);
      base = torch(base, p, vec2(1258., 215.), vec2(26., 65.), 11.2);
      base = torch(base, p, vec2(662., 573.), vec2(16., 53.), 15.1);
      base = torch(base, p, vec2(1257., 573.), vec2(16., 53.), 18.3);
      // Reflected warmth on the floor and soft occluded light beside the columns.
      float left = flicker(1.0) - .5, right = flicker(4.7) - .5;
      vec2 l = (p - vec2(310., 874.)) / vec2(155., 170.);
      vec2 r = (p - vec2(1615., 874.)) / vec2(155., 170.);
      base += vec3(.12, .062, .018) * (exp(-dot(l,l)*2.)*left + exp(-dot(r,r)*2.)*right);
      vec2 sl = (p - vec2(445., 460.)) / vec2(88., 250.);
      vec2 sr = (p - vec2(1475., 460.)) / vec2(88., 250.);
      base *= 1.0 - .05 * (exp(-dot(sl,sl)*2.)*(.5-left) + exp(-dot(sr,sr)*2.)*(.5-right));
      return base;
    }
    vec3 lantern(vec3 base, vec2 p, vec2 centre, vec2 size, float seed) {
      vec2 q = (p - centre) / size;
      if (abs(q.x) > 3.5 || abs(q.y) > 3.5) return base;
      float pulse = flicker(seed);
      float halo = exp(-dot(q, q) * .9);
      float core = exp(-dot(q, q) * 6.0);
      return base + vec3(.42, .22, .045) * halo * (.22 + .78 * pulse)
        + vec3(.10, .065, .025) * core * pulse;
    }
    vec3 glint(vec3 base, vec2 p, vec2 centre, float seed) {
      vec2 q = p - centre;
      if (abs(q.x) > 18.0 || abs(q.y) > 18.0) return base;
      float shine = pow(max(0.0, sin(time * .65 + seed)), 14.0);
      float cross = exp(-abs(q.x) * 2.4 - abs(q.y) * .3)
        + exp(-abs(q.y) * 2.4 - abs(q.x) * .3);
      return base + vec3(.7, .5, .23) * cross * shine;
    }
    float ellipse(vec2 p, vec2 centre, vec2 size) {
      vec2 q = (p - centre) / size;
      return 1.0 - smoothstep(.65, 1.0, dot(q,q));
    }
    // A tapered, curved channel follows the painted lip and falling stream.
    // Sampling stays inside its banks; rocks are never repainted as water.
    vec3 fall(vec3 base, vec2 p, vec2 lip, vec2 foot, vec2 widths, float seed) {
      float u = (p.y - lip.y) / (foot.y - lip.y);
      if (u <= 0.0 || u >= 1.0) return base;
      float centre = mix(lip.x, foot.x, sqrt(u));
      float width = mix(widths.x, widths.y, u);
      float across = p.x - centre;
      float mask = (1.0 - smoothstep(width*.65, width, abs(across)))
        * smoothstep(0.0, .07, u) * (1.0 - smoothstep(.82, 1.0, u));
      if (mask < .001) return base;
      // Preserve the painting's material and its reflected sunset colour.
      float desaturated = 1.0 - smoothstep(.16, .33, max(base.r,max(base.g,base.b))-min(base.r,min(base.g,base.b)));
      mask *= desaturated;
      float along = u * (foot.y-lip.y) - time * (28.0 + seed*8.0);
      float strands = noise(vec2(across*1.35 + seed*7.0, along*.10));
      float fine = noise(vec2(across*2.6, along*.19 + seed));
      float foam = smoothstep(.46,.78,strands*.7+fine*.3);
      return mix(base, base * (.94 + .10*strands) + vec3(.10,.105,.11)*foam, mask*.78);
    }
    float banner(vec2 p, vec4 box, float point) {
      float u=clamp((p.y-box.y)/(box.w-box.y),0.0,1.0);
      float edge=1.0-smoothstep(.88,1.0,abs((p.x-(box.x+box.z)*.5)/((box.z-box.x)*.5)));
      float bottom=box.w-point*abs((p.x-(box.x+box.z)*.5)/((box.z-box.x)*.5));
      return edge*smoothstep(box.y,box.y+30.,p.y)*(1.0-smoothstep(bottom-8.,bottom,p.y))*u;
    }
    vec2 livingShift(vec2 p, vec3 base) {
      vec2 shift=vec2(0.0);
      float cloth=portrait>.5
        ? max(banner(p,vec4(433.,108.,503.,441.),54.),banner(p,vec4(1168.,108.,1239.,439.),54.))
        : max(banner(p,vec4(438.,146.,501.,492.),60.),banner(p,vec4(1166.,147.,1231.,492.),60.));
      // Gold embroidery follows the cloth too. The hanging rail stays fixed.
      shift.x += sin(time*1.18+p.y*.032)*1.8*cloth;
      shift.y += cos(time*.93+p.y*.022)*.6*cloth;
      float plants=portrait>.5
        ? max(max(ellipse(p,vec2(548.,438.),vec2(44.,26.)),ellipse(p,vec2(1121.,436.),vec2(43.,27.))),max(ellipse(p,vec2(195.,449.),vec2(38.,28.)),ellipse(p,vec2(1476.,454.),vec2(39.,30.))))
        : max(ellipse(p,vec2(147.,469.),vec2(54.,35.)),ellipse(p,vec2(1520.,470.),vec2(52.,34.)));
      shift += vec2(sin(time*1.4+p.y*.07)*1.2,cos(time*1.17+p.x*.06)*.55)*plants;
      vec4 sky=portrait>.5?vec4(568.,272.,769.,385.):vec4(605.,319.,915.,437.);
      float clouds=rectangle(p,sky);
      // Exclude the bright sun and the bridge/rooftops at the edge of the sky.
      clouds *= 1.0-ellipse(p,portrait>.5?vec2(703.,384.):vec2(765.,455.),vec2(40.,28.));
      clouds *= 1.0-smoothstep(portrait>.5?365.:411.,portrait>.5?385.:437.,p.y);
      shift += vec2(sin(time*.105+p.y*.012)*3.2,cos(time*.087+p.x*.01)*.7)*clouds;
      return shift;
    }
    vec3 leaf(vec3 base, vec2 p, vec2 origin, float seed, float direction) {
      if(abs(p.x-origin.x)>108. || abs(p.y-origin.y)>65.)return base;
      float age=fract(time/23.0+seed*.271);
      if(age>.24)return base;
      float u=age/.24;
      vec2 centre=origin+vec2(direction*85.*u,-25.*sin(u*3.14159)+46.*u);
      float angle=u*6.0+seed;
      vec2 q=p-centre;
      q=mat2(cos(angle),-sin(angle),sin(angle),cos(angle))*q;
      float shape=1.0-smoothstep(.65,1.0,length(q/vec2(2.6,1.15)));
      float fade=smoothstep(0.,.12,u)*(1.-smoothstep(.7,1.,u));
      return mix(base,vec3(.62,.51,.19),shape*fade*.85);
    }
    vec3 heroicScene(vec3 base, vec2 source) {
      vec2 p = source * vec2(1672.0 / 1920.0, 941.0 / 1080.0);
      vec2 shifted=p-livingShift(p,base);
      base=texture2D(scene,shifted/vec2(1672.,941.)).rgb;
      if (portrait > .5) {
        base = fall(base,p,vec2(938.,404.),vec2(930.,442.),vec2(2.0,3.5),.0);
        base = fall(base,p,vec2(982.,405.),vec2(970.,458.),vec2(5.5,7.5),.27);
        base = fall(base,p,vec2(1031.,421.),vec2(1024.,461.),vec2(1.7,3.3),.54);
        base = lantern(base,p,vec2(392.,347.),vec2(28.,36.),1.7);
        base = lantern(base,p,vec2(1283.,349.),vec2(28.,36.),4.2);
        base = glint(base,p,vec2(1022.,328.),.5);
        base = glint(base,p,vec2(685.,181.),3.1);
        base = glint(base,p,vec2(985.,181.),5.7);
        for(int i=0;i<2;i++){
          base=leaf(base,p,vec2(549.,438.),float(i)+1.0,1.0);
          base=leaf(base,p,vec2(1120.,438.),float(i)+3.0,-1.0);
        }
      } else {
        base = fall(base,p,vec2(888.,478.),vec2(877.,516.),vec2(2.0,4.2),.0);
        base = fall(base,p,vec2(959.,464.),vec2(946.,538.),vec2(5.5,8.5),.27);
        base = fall(base,p,vec2(1053.,511.),vec2(1046.,560.),vec2(3.,6.5),.79);
        base = lantern(base,p,vec2(394.,390.),vec2(29.,39.),1.7);
        base = lantern(base,p,vec2(1280.,390.),vec2(29.,39.),4.2);
        base = lantern(base,p,vec2(90.,665.),vec2(44.,50.),8.1);
        base = lantern(base,p,vec2(1585.,660.),vec2(44.,50.),11.4);
        base = glint(base,p,vec2(994.,310.),.5);
        base = glint(base,p,vec2(951.,394.),2.7);
        base = glint(base,p,vec2(1024.,411.),5.9);
        base = glint(base,p,vec2(866.,449.),8.1);
        for(int i=0;i<2;i++){
          base=leaf(base,p,vec2(145.,466.),float(i)+1.0,1.0);
          base=leaf(base,p,vec2(1521.,469.),float(i)+3.0,-1.0);
        }
      }
      vec2 sun=portrait>.5?vec2(840.,140.):vec2(839.,190.);
      vec2 q=(p-sun)/vec2(72.,66.);
      float pulse=.45+.35*sin(time*.72)+.12*sin(time*1.31);
      base+=vec3(.14,.085,.018)*exp(-dot(q,q)*1.4)*pulse;
      vec2 horizon=portrait>.5?vec2(703.,384.):vec2(765.,455.);
      q=(p-horizon)/vec2(34.,18.);
      base+=vec3(.11,.075,.025)*exp(-dot(q,q))*(.6+.4*sin(time*.53));
      float floorGlow=ellipse(p,vec2(400.,659.),vec2(115.,97.))*(flicker(1.7)-.5)
        +ellipse(p,vec2(1270.,659.),vec2(115.,97.))*(flicker(4.2)-.5);
      return base+vec3(.06,.029,.006)*floorGlow;
    }
    void main() {
      vec2 p = (uv * viewport - sceneRect.xy) / sceneRect.zw * sourceSize;
      vec2 shift = vec2(0.0);
      // Islands and the horizon are fixed. Movement begins below them,
      // inside the cloud banks; airborne bubbles are independent drawings.
      float cloud = smoothstep(630.0, 800.0, p.y);
      float middle = smoothstep(570.0, 740.0, p.x) * (1.0 - smoothstep(1220.0, 1400.0, p.x));
      float foreground = smoothstep(960.0, 1080.0, p.y);
      float cloudMask = cloud * max(middle, foreground) * (1.0 - citadel) * (1.0 - royal) * (1.0 - heroic);
      shift += vec2(sin(time * .105 + p.y * .003) * 15.0,
        sin(time * .14 + p.x * .003) * 4.0) * cloudMask;
      vec2 samplePoint = clamp(p - shift, vec2(.5), sourceSize - .5);
      vec3 color = texture2D(scene, samplePoint / sourceSize).rgb;
      if (heroic > .5) {
        color = heroicScene(color, p);
      } else if (royal > .5) {
        color = royalFire(color, p);
      } else if (citadel > .5) {
        // Two streams spill over separate lips of the left island.
        color = water(color, p, vec4(789.0, 488.0, 807.0, 604.0), .0);
        color = water(color, p, vec4(819.0, 492.0, 835.0, 610.0), .18);
        color = water(color, p, vec4(1105.0, 610.0, 1165.0, 713.0), .37);
        color = water(color, p, vec4(304.0, 494.0, 362.0, 560.0), .74);
      } else {
        color = water(color, p, vec4(76.0, 388.0, 154.0, 586.0), .0);
        color = water(color, p, vec4(193.0, 402.0, 251.0, 582.0), .19);
        color = water(color, p, vec4(397.0, 470.0, 453.0, 628.0), .37);
        color = water(color, p, vec4(1518.0, 585.0, 1558.0, 675.0), .58);
        color = water(color, p, vec4(1520.0, 738.0, 1562.0, 888.0), .74);
        color = water(color, p, vec4(1648.0, 736.0, 1751.0, 879.0), .92);
        for (int i = 0; i < 7; i++) color = bubble(color, p, float(i) + 1.0);
      }
      gl_FragColor = vec4(color, 1.0);
    }`;

  function wanted() {
    return (
      !document.hidden &&
      !reduced.matches &&
      !covered &&
      !lobby.hidden && lobby.isConnected &&
      (!profileScene || !!lobby.closest("dialog[open]")) &&
      document.body.dataset.screen === "lobby" &&
      ["glass", "prism", "visual", "heroic"].includes(lobby.dataset.leagueBackground)
    );
  }
  function shader(type, source) {
    const result = gl.createShader(type);
    gl.shaderSource(result, source);
    gl.compileShader(result);
    if (!gl.getShaderParameter(result, gl.COMPILE_STATUS)) {
      gl.deleteShader(result);
      throw Error("Sky shader could not compile");
    }
    return result;
  }
  function initialize() {
    if (canvas || failed) return;
    canvas = document.createElement("canvas");
    canvas.className = "sky-lobby-scene";
    canvas.setAttribute("aria-hidden", "true");
    canvas.hidden = true;
    lobby.prepend(canvas);
    gl = canvas.getContext("webgl", {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: false,
      powerPreference: "low-power",
    });
    if (!gl) {
      failed = true;
      canvas.remove();
      return;
    }
    canvas.addEventListener("webglcontextlost", (event) => {
      event.preventDefault();
      lost = true;
      pause();
    });
    canvas.addEventListener("webglcontextrestored", () => {
      lost = false;
      loaded = false;
      loadedTheme = "";
      canvas.remove();
      canvas = null;
      update();
    });
    try {
      const vs = shader(gl.VERTEX_SHADER, vertex),
        fs = shader(gl.FRAGMENT_SHADER, fragment);
      program = gl.createProgram();
      gl.attachShader(program, vs);
      gl.attachShader(program, fs);
      gl.linkProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw Error("Sky link failed");
      gl.useProgram(program);
      const buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
        gl.STATIC_DRAW,
      );
      const position = gl.getAttribLocation(program, "position");
      gl.enableVertexAttribArray(position);
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
      locations = {
        viewport: gl.getUniformLocation(program, "viewport"),
        sceneRect: gl.getUniformLocation(program, "sceneRect"),
        citadel: gl.getUniformLocation(program, "citadel"),
        royal: gl.getUniformLocation(program, "royal"),
        heroic: gl.getUniformLocation(program, "heroic"),
        portrait: gl.getUniformLocation(program, "portrait"),
        time: gl.getUniformLocation(program, "time"),
      };
      texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    } catch (_) {
      failed = true;
      pause();
    }
  }
  function loadScene(theme) {
    const key = theme + (profileScene ? ":profile" : ":lobby");
    if (loadedTheme === key || failed || lost) return;
    pause();
    loaded = false;
    loadedTheme = key;
    const next = new Image();
    image = next;
    next.onload = () => {
      if (lost || image !== next) return;
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, next);
      gl.uniform1f(locations.citadel, theme === "prism" ? 1 : 0);
      gl.uniform1f(locations.royal, theme === "visual" ? 1 : 0);
      gl.uniform1f(locations.heroic, theme === "heroic" ? 1 : 0);
      gl.uniform1f(locations.portrait, profileScene ? 1 : 0);
      loaded = true;
      resizePending = true;
      update();
    };
    next.onerror = () => {
      if (image !== next) return;
      failed = true;
      pause();
    };
    next.src = `assets/interface-packs/${theme}/${profileScene ? "profile" : "lobby"}.webp`;
  }
  function pause() {
    cancelAnimationFrame(frame);
    clearTimeout(frameTimer);
    frameTimer = 0;
    frame = 0;
    previous = 0;
    if (canvas) canvas.hidden = true;
    lobby.removeAttribute("data-sky-motion");
  }
  function scheduleFrame() {
    if (frame || frameTimer) return;
    // High-refresh displays must not wake the main thread hundreds of times
    // for a landscape rendered at 30 Hz. Leave a small margin for vsync.
    const delay = previous ? Math.max(0, 32 - (performance.now() - previous) - 4) : 0;
    if (delay > 0) frameTimer = setTimeout(() => {
      frameTimer = 0;
      frame = requestAnimationFrame(draw);
    }, delay);
    else frame = requestAnimationFrame(draw);
  }
  function draw(now) {
    frame = 0;
    if (!wanted() || failed || lost || !loaded) {
      pause();
      return;
    }
    // 30 fps is enough for this slow landscape. The game keeps its own frame loop.
    if (previous && now - previous < 32) { scheduleFrame(); return; }
    elapsed += previous ? Math.min(now - previous, 100) / 1000 : 0;
    previous = now;
    if (resizePending) {
      const width = lobby.clientWidth,
        height = lobby.clientHeight;
      if (!width || !height) { scheduleFrame(); return; }
      const density = Math.min(devicePixelRatio || 1, 1.25, Math.sqrt(2073600 / (width * height)));
      canvas.width = Math.round(width * density);
      canvas.height = Math.round(height * density);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(locations.viewport, width, height);
      // Share the static backdrop's actual positioning; no offset between
      // the waterfall animation, the platform and the avatar after resizing.
      const css = getComputedStyle(lobby);
      const size = css.backgroundSize.split(" ");
      const cover = Math.max(width / image.naturalWidth, height / image.naturalHeight);
      const length = (value, extent) => value.endsWith("%")
        ? parseFloat(value) * extent / 100 : parseFloat(value);
      const explicit = size.length === 2 && size.every(value => /[\d.](px|%)$/.test(value));
      const sceneWidth = explicit ? length(size[0], width) : image.naturalWidth * cover;
      const sceneHeight = explicit ? length(size[1], height) : image.naturalHeight * cover;
      const left = length(css.backgroundPositionX, width - sceneWidth);
      const top = length(css.backgroundPositionY, height - sceneHeight);
      gl.uniform4f(locations.sceneRect, left, top, sceneWidth, sceneHeight);
      resizePending = false;
    }
    gl.uniform1f(locations.time, elapsed);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    canvas.hidden = false;
    if (lobby.dataset.skyMotion !== "running") lobby.dataset.skyMotion = "running";
    scheduleFrame();
  }
  function update() {
    const hero = document.querySelector('dialog[open] .public-player-hero[data-league-background="heroic"]');
    const host = hero || lobbyRoot;
    if (host !== lobby) {
      pause();
      resizeObserver.unobserve(lobby);
      lobby = host;
      profileScene = !!hero;
      if (canvas) lobby.prepend(canvas);
      resizeObserver.observe(lobby);
      resizePending = true;
    }
    covered = !!document.querySelector('dialog[open][data-layout="fullscreen"]');
    lobbyRoot.dataset.sceneCovered = String(!!hero || covered);
    if (!wanted()) {
      pause();
      return;
    }
    initialize();
    if (gl && !failed && !lost) loadScene(lobby.dataset.leagueBackground);
    if (loaded && !failed && !lost) scheduleFrame();
  }
  new MutationObserver(update).observe(lobby, {
    attributes: true,
    attributeFilter: ["data-league-background", "hidden"],
  });
  new MutationObserver(update).observe(document.body, {
    attributes: true,
    subtree: true,
    attributeFilter: ["data-screen", "open"],
  });
  // Fullscreen panels can also be mounted or removed as complete nodes.
  new MutationObserver(update).observe(document.body, { childList: true });
  const resizeObserver = new ResizeObserver(() => {
    resizePending = true;
  });
  resizeObserver.observe(lobby);
  lobby.addEventListener("lobby:scene-aligned", () => {
    resizePending = true;
  });
  document.addEventListener("killex:profile-scene", update);
  document.addEventListener("visibilitychange", update);
  reduced.addEventListener("change", update);
  update();
})();
