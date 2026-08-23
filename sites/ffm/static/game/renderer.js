// renderer.js — SNES-era forest scene, 3-D cobblestone path, bright SNES palette

export const LOGICAL_PX = 4;
export const CANVAS_W   = 800;
export const CANVAS_H   = 450;
export const GROUND_Y   = 340;   // y where hero / front fiends anchor
export const HERO_X     = 110;

const _bgImage = new Image();
_bgImage.src = new URL('./background.png', import.meta.url).href;

// 5×7 pixel font — chars needed for math questions + HUD labels
export const PIXEL_FONT = {
  '0':['01110','10001','10011','10101','11001','10001','01110'],
  '1':['00100','01100','00100','00100','00100','00100','01110'],
  '2':['01110','10001','00001','00010','00100','01000','11111'],
  '3':['01110','10001','00001','00110','00001','10001','01110'],
  '4':['00010','00110','01010','10010','11111','00010','00010'],
  '5':['11111','10000','11110','00001','00001','10001','01110'],
  '6':['00110','01000','10000','11110','10001','10001','01110'],
  '7':['11111','00001','00010','00100','01000','01000','01000'],
  '8':['01110','10001','10001','01110','10001','10001','01110'],
  '9':['01110','10001','10001','01111','00001','00010','01100'],
  '+':['00000','00100','00100','11111','00100','00100','00000'],
  '-':['00000','00000','00000','11111','00000','00000','00000'],
  '×':['00000','10001','01010','00100','01010','10001','00000'],
  '÷':['00000','00100','00000','11111','00000','00100','00000'],
  '?':['01110','10001','00001','00110','00100','00000','00100'],
  '=':['00000','00000','11111','00000','11111','00000','00000'],
  ' ':['00000','00000','00000','00000','00000','00000','00000'],
  'A':['00100','01010','10001','11111','10001','10001','10001'],
  'B':['11110','10001','10001','11110','10001','10001','11110'],
  'C':['01110','10001','10000','10000','10000','10001','01110'],
  'D':['11100','10010','10001','10001','10001','10010','11100'],
  'E':['11111','10000','10000','11110','10000','10000','11111'],
  'G':['01110','10001','10000','10111','10001','10001','01111'],
  'H':['10001','10001','10001','11111','10001','10001','10001'],
  'I':['01110','00100','00100','00100','00100','00100','01110'],
  'L':['10000','10000','10000','10000','10000','10000','11111'],
  'M':['10001','11011','10101','10001','10001','10001','10001'],
  'O':['01110','10001','10001','10001','10001','10001','01110'],
  'P':['11110','10001','10001','11110','10000','10000','10000'],
  'R':['11110','10001','10001','11110','10100','10010','10001'],
  'S':['01110','10001','10000','01110','00001','10001','01110'],
  'T':['11111','00100','00100','00100','00100','00100','00100'],
  'V':['10001','10001','10001','10001','10001','01010','00100'],
  'W':['10001','10001','10001','10101','10101','11011','10001'],
  'X':['10001','10001','01010','00100','01010','10001','10001'],
  'Y':['10001','10001','01010','00100','00100','00100','00100'],
};

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx    = canvas.getContext('2d');
    this._tick  = 0;
  }

  clear() {
    this.ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    this._tick++;
  }

  // ─── main background ────────────────────────────────────────────────────────
  drawBackground(scrollX) {
    const ctx = this.ctx;
    if (!_bgImage.complete || !_bgImage.naturalWidth) {
      ctx.fillStyle = '#3a8ec8';
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
      return;
    }
    // scale image to fill canvas width; crop top+bottom if taller than canvas
    const dw  = CANVAS_W;
    const dh  = _bgImage.naturalHeight * (CANVAS_W / _bgImage.naturalWidth);
    const dy  = (CANVAS_H - dh) / 2;
    const off = mod(scrollX * 0.2, dw);
    ctx.drawImage(_bgImage, -off, dy, dw, dh);
    ctx.drawImage(_bgImage, -off + dw, dy, dw, dh);
  }

  // ─── layer helpers ──────────────────────────────────────────────────────────
  _clouds(ctx) {
    const c = [[52,26,90,22],[262,40,110,26],[492,20,94,21],[670,46,76,19]];
    c.forEach(([x,y,w,h]) => {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x,           y+~~(h*.40), w,         ~~(h*.60));
      ctx.fillRect(x+~~(w*.08), y+~~(h*.10), ~~(w*.32), ~~(h*.56));
      ctx.fillRect(x+~~(w*.28), y,           ~~(w*.38), ~~(h*.72));
      ctx.fillRect(x+~~(w*.56), y+~~(h*.10), ~~(w*.30), ~~(h*.56));
      ctx.fillStyle='#c8e8f8';
      ctx.fillRect(x, y+~~(h*.80), w, ~~(h*.20));
    });
  }

  _mountains(ctx, bx) {
    [[0,145,200,86],[185,130,215,102],[370,148,195,84],
     [545,134,220,96],[730,142,200,88]].forEach(([rx,top,w,h]) => {
      const px = ~~(bx+rx);
      ctx.fillStyle='#90b4cc';
      for(let i=0;i<h;i++){const rw=~~(w*(1-i/h*0.72));ctx.fillRect(px+~~((w-rw)/2),top+i,rw,1);}
      ctx.fillStyle='#d8ecf8';
      const sc=~~(h*.25);
      for(let i=0;i<sc;i++){const rw=~~(w*.32*(1-i/sc));ctx.fillRect(px+~~((w-rw)/2),top+i,rw,1);}
    });
  }

  _farForest(ctx, bx) {
    const H=150;
    ctx.fillStyle='#1a5016';
    ctx.fillRect(~~bx,H,CANVAS_W,54);
    const xs =[0,54,108,162,216,272,332,390,448,506,562,620,676,734,790];
    const ws =[60,50,70,55,78,60,66,74,52,64,80,58,70,62,56];
    const hs =[50,40,58,46,60,44,54,62,42,52,64,48,56,52,48];
    xs.forEach((rx,i)=>{
      const px=~~(bx+rx);const tw=ws[i];const th=hs[i];
      ctx.fillStyle='#1a5016';
      [[.15,.50,.70,.50],[.08,.32,.84,.28],[.20,.14,.60,.22],[.30,0,.40,.16]].forEach(([lx,ly,lw,lh])=>{
        ctx.fillRect(px+~~(tw*lx),H-th+~~(th*ly),~~(tw*lw),~~(th*lh));});
    });
  }

  _nearTrees(ctx, bx) {
    // [x, canopyW, canopyH, trunkW, trunkH, baseY]
    const trees=[
      [-18,96,110,16,70,308],[128,78,90,13,56,296],[292,114,120,18,76,318],
      [490,90,98,14,64,304],[658,106,112,16,72,312],[842,84,92,13,60,300],
    ];
    trees.forEach(([tx,cw,ch,tw,th,by])=>{
      const x=~~(bx+tx);
      // trunk
      ctx.fillStyle='#5a3818';
      ctx.fillRect(x+~~(cw/2)-~~(tw/2),by-th,tw,th);
      ctx.fillStyle='#7a4a20';
      ctx.fillRect(x+~~(cw/2)-~~(tw/2)+2,by-th,~~(tw/3),th);
      // bark lines
      ctx.fillStyle='#4a2810';
      for(let bi=0;bi<th;bi+=12)ctx.fillRect(x+~~(cw/2)-~~(tw/2),by-th+bi,tw,1);
      // canopy
      const cy=by-th-ch;
      ctx.fillStyle='#1a4c14';
      ctx.fillRect(x+~~(cw*.08),cy+~~(ch*.52),~~(cw*.84),~~(ch*.48));
      ctx.fillRect(x+~~(cw*.04),cy+~~(ch*.34),~~(cw*.92),~~(ch*.24));
      ctx.fillStyle='#287820';
      ctx.fillRect(x+~~(cw*.06),cy+~~(ch*.20),~~(cw*.88),~~(ch*.52));
      ctx.fillRect(x+~~(cw*.14),cy+~~(ch*.06),~~(cw*.72),~~(ch*.20));
      ctx.fillStyle='#3aaa28';
      ctx.fillRect(x+~~(cw*.22),cy+~~(ch*.02),~~(cw*.56),~~(ch*.14));
      ctx.fillRect(x+~~(cw*.14),cy+~~(ch*.10),~~(cw*.66),~~(ch*.22));
      ctx.fillStyle='#52c840';
      ctx.fillRect(x+~~(cw*.26),cy+~~(ch*.18),~~(cw*.18),4);
      ctx.fillRect(x+~~(cw*.52),cy+~~(ch*.32),~~(cw*.18),4);
      // vines
      ctx.fillStyle='#2a5c1a';
      const v1=x+~~(cw*.36),v2=x+~~(cw*.64);
      for(let vi=0;vi<~~(th*.44);vi+=2){ctx.fillRect(v1,by-th+vi,2,2);}
      for(let vi=0;vi<~~(th*.28);vi+=2){ctx.fillRect(v2,by-th+vi,2,2);}
    });

    // waterfall
    const wfX=~~(bx+185);
    if(wfX>-80&&wfX<CANVAS_W+80){
      ctx.fillStyle='#8a7a68';ctx.fillRect(wfX,198,64,84);
      ctx.fillStyle='#a89878';ctx.fillRect(wfX+4,200,22,10);ctx.fillRect(wfX+42,200,16,8);
      ctx.fillStyle='#6a5a48';ctx.fillRect(wfX,270,64,12);
      ctx.fillStyle='#70c8f0';ctx.fillRect(wfX+20,198,24,72);
      ctx.fillStyle='#a8e4f8';
      const wa=(this._tick%4)*2;
      for(let wy=200;wy<270;wy+=8){
        ctx.fillRect(wfX+22,wy+wa%8,4,3);ctx.fillRect(wfX+34,wy+(wa+4)%8,3,3);
      }
      ctx.fillStyle='#ffffff';ctx.fillRect(wfX+10,270,44,4);
      ctx.fillStyle='#68b8e0';ctx.fillRect(wfX-12,272,88,22);
      ctx.fillStyle='#88d0f0';ctx.fillRect(wfX-8,274,60,8);
    }
  }

  _ground(ctx, scrollX) {
    const P=LOGICAL_PX;

    // Grass fill
    const gg=ctx.createLinearGradient(0,242,0,CANVAS_H);
    gg.addColorStop(0,'#2e7020');gg.addColorStop(.4,'#3a8828');gg.addColorStop(1,'#4a9030');
    ctx.fillStyle=gg;ctx.fillRect(0,242,CANVAS_W,CANVAS_H-242);

    // Perspective cobblestone path
    // back edge: y=250, half-width=110 (centred); front edge: y=CANVAS_H, full width
    const backY=250,frontY=CANVAS_H,backCX=CANVAS_W/2,backHW=110,rows=20;
    const sc=['#c4a458','#b8984c','#d4b06a','#a88840','#c8ac60'];
    const sd='#7a5c30',hi='#e8cc80';
    const gOff=mod(scrollX,P*16);
    for(let r=0;r<rows;r++){
      const t=r/(rows-1);
      const y=~~(backY+t*(frontY-backY));
      const nh=Math.max(4,~~((frontY-backY)/rows));
      const pL=~~(backCX-backHW+t*(0-(backCX-backHW)));
      const pR=~~(backCX+backHW+t*(CANVAS_W-(backCX+backHW)));
      const pW=pR-pL;
      ctx.fillStyle=sc[r%sc.length];ctx.fillRect(pL,y,pW,nh);
      ctx.fillStyle=sd;ctx.fillRect(pL,y,pW,1);
      ctx.fillStyle=hi;ctx.fillRect(pL,y+1,pW,1);
      const stW=Math.max(10,~~(P*4*(0.35+0.65*t)));
      const jOff=~~(gOff*(0.4+0.6*t))%stW;
      for(let sx=pL-jOff+(r%2===0?0:~~(stW/2));sx<pR;sx+=stW){
        const jx=~~sx;if(jx>pL&&jx<pR){ctx.fillStyle=sd;ctx.fillRect(jx,y,1,nh);}
      }
    }

    // Ground details
    const dOff=mod(scrollX,CANVAS_W);
    for(let w=0;w<2;w++) this._grassDetails(ctx,dOff-CANVAS_W+w*CANVAS_W);
  }

  _grassDetails(ctx, bx) {
    // rocks
    [[25,306,26,17],[130,324,22,16],[692,304,28,18],[768,320,24,16]].forEach(([rx,ry,rw,rh])=>{
      const px=~~(bx+rx);
      ctx.fillStyle='#8a7a68';ctx.fillRect(px,ry,rw,rh);
      ctx.fillStyle='#a89880';ctx.fillRect(px+3,ry+2,~~(rw/2),~~(rh/3));
      ctx.fillStyle='#6a5a48';ctx.fillRect(px,ry+rh-4,rw,4);
    });
    // flowers
    [[58,336],[92,350],[198,340],[238,355],[562,336],[598,352],[742,342]].forEach(([fx,fy])=>{
      const px=~~(bx+fx);
      ctx.fillStyle='#3a6c18';ctx.fillRect(px+2,fy+4,2,6);
      ctx.fillStyle='#f0f0f0';
      ctx.fillRect(px,fy,2,2);ctx.fillRect(px+4,fy,2,2);
      ctx.fillRect(px+2,fy-2,2,2);ctx.fillRect(px+2,fy+2,2,2);
      ctx.fillStyle='#f8e040';ctx.fillRect(px+2,fy,2,2);
    });
    // bushes
    [[12,288,52,32],[158,278,62,36],[388,260,48,26],[640,274,56,34]].forEach(([bsx,bsy,bsw,bsh])=>{
      const px=~~(bx+bsx);
      ctx.fillStyle='#1a5016';ctx.fillRect(px,bsy+~~(bsh*.5),bsw,~~(bsh*.5));
      ctx.fillStyle='#287820';
      ctx.fillRect(px+~~(bsw*.08),bsy+~~(bsh*.22),~~(bsw*.84),~~(bsh*.58));
      ctx.fillRect(px+~~(bsw*.14),bsy,~~(bsw*.28),~~(bsh*.38));
      ctx.fillRect(px+~~(bsw*.38),bsy+~~(bsh*.06),~~(bsw*.32),~~(bsh*.34));
      ctx.fillRect(px+~~(bsw*.64),bsy+~~(bsh*.12),~~(bsw*.24),~~(bsh*.30));
      ctx.fillStyle='#50c040';
      ctx.fillRect(px+~~(bsw*.18),bsy+~~(bsh*.08),~~(bsw*.14),4);
      ctx.fillRect(px+~~(bsw*.52),bsy+~~(bsh*.24),~~(bsw*.14),4);
    });
    // fallen log
    ctx.fillStyle='#6a4020';ctx.fillRect(~~(bx+440),314,82,16);
    ctx.fillStyle='#8a5828';ctx.fillRect(~~(bx+441),315,80,6);
    ctx.fillStyle='#4a2810';ctx.fillRect(~~(bx+440),326,82,4);
    ctx.fillStyle='#8a5828';ctx.fillRect(~~(bx+440),314,10,16);
    ctx.fillStyle='#5a3018';ctx.fillRect(~~(bx+442),318,6,8);
  }

  _frontWall(ctx, scrollX) {
    const P=LOGICAL_PX,wallY=CANVAS_H-62;
    const wg=ctx.createLinearGradient(0,wallY,0,CANVAS_H);
    wg.addColorStop(0,'#8a7a68');wg.addColorStop(.3,'#7a6a58');wg.addColorStop(1,'#5a4a38');
    ctx.fillStyle=wg;ctx.fillRect(0,wallY,CANVAS_W,62);
    ctx.fillStyle='#b09880';ctx.fillRect(0,wallY,CANVAS_W,4);
    ctx.fillStyle='#5a4a38';
    ctx.fillRect(0,wallY+20,CANVAS_W,2);ctx.fillRect(0,wallY+42,CANVAS_W,2);
    const jS=P*12,jO=mod(scrollX,jS);
    for(let jx=-jO;jx<CANVAS_W;jx+=jS){
      const x=~~jx;
      ctx.fillRect(x,wallY,2,22);
      ctx.fillRect(x+~~(jS/2),wallY+22,2,22);
      ctx.fillRect(x,wallY+44,2,18);
    }
    ctx.fillStyle='#3a2a1a';ctx.fillRect(0,CANVAS_H-5,CANVAS_W,5);
  }

  // ─── public API ─────────────────────────────────────────────────────────────
  drawEntity(entity) { entity.draw(this.ctx); }

  /** isActive=true → blue border (combat question), false → grey (queued) */
  drawSpeechBubble(x, y, text, isActive = true) {
    const ctx=this.ctx,P=LOGICAL_PX;
    const charW=6*P,tW=text.length*charW,padX=12,padY=8;
    const bW=tW+padX*2,bH=7*P+padY*2;
    let bx=~~(x-bW/2);bx=Math.max(4,Math.min(CANVAS_W-bW-4,bx));
    const by=~~(y-bH-20);

    // shadow
    ctx.fillStyle='rgba(0,0,0,0.28)';ctx.fillRect(bx+3,by+3,bW,bH);
    // border
    ctx.fillStyle=isActive?'#1830b8':'#484848';ctx.fillRect(bx-2,by-2,bW+4,bH+4);
    // body
    ctx.fillStyle=isActive?'#f0f4ff':'#d8d8cc';ctx.fillRect(bx,by,bW,bH);
    // accent strip
    ctx.fillStyle=isActive?'#3050d8':'#686868';ctx.fillRect(bx,by,bW,4);
    // tail
    const tc=isActive?'#1830b8':'#484848',tf=isActive?'#f0f4ff':'#d8d8cc';
    ctx.fillStyle=tc;
    ctx.fillRect(bx+14,by+bH,P*2,P);ctx.fillRect(bx+12,by+bH+P,P*2,P);ctx.fillRect(bx+10,by+bH+P*2,P*2,P);
    ctx.fillStyle=tf;ctx.fillRect(bx+14,by+bH,P,P);
    // text
    this._text(text,bx+padX,by+padY+4,isActive?'#1020a0':'#303030');
  }

  drawTimerBar(x, y, w, ratio) {
    const ctx=this.ctx,h=LOGICAL_PX*2;
    ctx.fillStyle='#000';ctx.fillRect(x-1,y-1,w+2,h+2);
    ctx.fillStyle='#202020';ctx.fillRect(x,y,w,h);
    ctx.fillStyle=ratio>.5?'#40e840':ratio>.25?'#e8c040':'#e84040';
    const fw=Math.max(0,~~(w*ratio));
    ctx.fillRect(x,y,fw,h);
    if(fw>2){ctx.fillStyle='rgba(255,255,255,.35)';ctx.fillRect(x,y,fw,~~(h/2));}
  }

  drawHUD(hearts, maxHearts, score, combo, levelLabel) {
    const ctx=this.ctx,P=LOGICAL_PX;
    ctx.fillStyle='rgba(0,0,0,.55)';ctx.fillRect(0,0,CANVAS_W,38);
    ctx.fillStyle='#1a3060';ctx.fillRect(0,36,CANVAS_W,2);
    // HP label
    ctx.fillStyle='#e83030';ctx.fillRect(8,7,20,11);
    this._text('HP',10,8,'#fff',.65);
    // hearts
    for(let i=0;i<maxHearts;i++){
      const hx=32+i*16,hy=8,f=i<hearts;
      ctx.fillStyle=f?'#e82020':'#401010';
      ctx.fillRect(hx+1,hy,4,3);ctx.fillRect(hx+7,hy,4,3);
      ctx.fillRect(hx,hy+2,12,5);ctx.fillRect(hx+2,hy+7,8,2);ctx.fillRect(hx+4,hy+9,4,2);
      if(f){ctx.fillStyle='#ff6868';ctx.fillRect(hx+2,hy+1,3,2);}
    }
    // coin + score
    const sc=''+score;const scoreX=CANVAS_W-10-sc.length*6*P;
    ctx.fillStyle='#e8c040';ctx.fillRect(scoreX-18,9,12,12);
    ctx.fillStyle='#fce880';ctx.fillRect(scoreX-16,10,8,5);
    ctx.fillStyle='#b09020';ctx.fillRect(scoreX-18,19,12,2);
    this._text(sc,scoreX,9,'#f8e040');
    // combo
    if(combo>=2){const cs='×'+combo;this._text(cs,CANVAS_W-10-cs.length*6*P,28,'#ff8020');}
    // level
    const llX=~~(CANVAS_W/2-levelLabel.length*3*P);
    this._text(levelLabel,llX,9,'#f0f0f0');
  }

  drawBanner(text) {
    const ctx=this.ctx,scale=2;
    ctx.fillStyle='rgba(0,0,0,.68)';ctx.fillRect(0,0,CANVAS_W,CANVAS_H);
    const tw=text.length*6*LOGICAL_PX*scale;
    const tx=~~((CANVAS_W-tw)/2),ty=~~((CANVAS_H-7*LOGICAL_PX*scale)/2);
    ctx.fillStyle='#000055';ctx.fillRect(tx-22,ty-18,tw+44,7*LOGICAL_PX*scale+36);
    ctx.fillStyle='#2848e0';ctx.fillRect(tx-20,ty-16,tw+40,7*LOGICAL_PX*scale+32);
    ctx.fillStyle='#00003a';ctx.fillRect(tx-18,ty-14,tw+36,7*LOGICAL_PX*scale+28);
    this._text(text,tx,ty,'#f8f860',scale);
  }

  _text(text, x, y, colour, scale=1) {
    const ctx=this.ctx;ctx.fillStyle=colour;
    let cx=x;
    for(const ch of text){
      const m=PIXEL_FONT[ch.toUpperCase()]||PIXEL_FONT[ch]||PIXEL_FONT[' '];
      for(let r=0;r<7;r++)for(let c=0;c<5;c++)if(m[r][c]==='1')
        ctx.fillRect(~~(cx+c*LOGICAL_PX*scale),~~(y+r*LOGICAL_PX*scale),~~(LOGICAL_PX*scale),~~(LOGICAL_PX*scale));
      cx+=6*LOGICAL_PX*scale;
    }
  }
}

function mod(a, b) { return ((a % b) + b) % b; }
