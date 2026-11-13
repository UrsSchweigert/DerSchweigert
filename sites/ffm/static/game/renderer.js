// renderer.js — SNES-era forest scene, 3-D cobblestone path, bright SNES palette

import {
  FALLBACK_BACKGROUND_URL,
  LEVEL_ART_MANIFEST,
  levelArtUrl,
  parseLevelArtManifest,
  resolveLevelBackground,
  resolveLevelGroundY,
} from './level-art.js';

export const LOGICAL_PX = 4;
export const CANVAS_W   = 800;
export const CANVAS_H   = 450;
// y where the hero and the front fiends anchor their feet. The per-level backgrounds paint their walkable
// ground plane across the lower ~40 % of a 1536x1024 image, which reaches the canvas at y 293 and runs to the
// bottom edge; 312 sat in the far half of that plane, so both characters read as hovering. Measured against
// level-01 and confirmed on a rendered frame: 360 puts the feet on the near floor. The six chapter fallbacks
// paint their courtyard higher, so they now stand slightly lower than before - acceptable, because level art
// is what every campaign level uses and the stage images only appear if a level image fails to load.
// This is the default line. The 60 level images do not share one floor, so a level can move the hero and the
// fiends onto its own floor through the `groundY` overrides in levels/manifest.json; see Renderer.groundY.
export const GROUND_Y   = 360;
export const HERO_X     = 110;

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
  '.':['00000','00000','00000','00000','00000','01100','01100'],
  'A':['00100','01010','10001','11111','10001','10001','10001'],
  'B':['11110','10001','10001','11110','10001','10001','11110'],
  'C':['01110','10001','10000','10000','10000','10001','01110'],
  'D':['11100','10010','10001','10001','10001','10010','11100'],
  'E':['11111','10000','10000','11110','10000','10000','11111'],
  'F':['11111','10000','10000','11110','10000','10000','10000'],
  'G':['01110','10001','10000','10111','10001','10001','01111'],
  'H':['10001','10001','10001','11111','10001','10001','10001'],
  'I':['01110','00100','00100','00100','00100','00100','01110'],
  'J':['00111','00010','00010','00010','00010','10010','01100'],
  'K':['10001','10010','10100','11000','10100','10010','10001'],
  'L':['10000','10000','10000','10000','10000','10000','11111'],
  'M':['10001','11011','10101','10001','10001','10001','10001'],
  'N':['10001','11001','10101','10101','10011','10001','10001'],
  'O':['01110','10001','10001','10001','10001','10001','01110'],
  'P':['11110','10001','10001','11110','10000','10000','10000'],
  'Q':['01110','10001','10001','10001','10101','10010','01101'],
  'R':['11110','10001','10001','11110','10100','10010','10001'],
  'S':['01110','10001','10000','01110','00001','10001','01110'],
  'T':['11111','00100','00100','00100','00100','00100','00100'],
  'U':['10001','10001','10001','10001','10001','10001','01110'],
  'V':['10001','10001','10001','10001','10001','01010','00100'],
  'W':['10001','10001','10001','10101','10101','11011','10001'],
  'X':['10001','10001','01010','00100','01010','10001','10001'],
  'Y':['10001','10001','01010','00100','00100','00100','00100'],
  'Z':['11111','00001','00010','00100','01000','10000','11111'],
};

// Matches Fireball/LightningBolt trailColor and the DragonSummon ice-breath
// palette in entities.js so the combo frame reads as "that ability's color".
const COMBO_FRAME_COLORS = {
  fireball: '#ffcf40',
  lightning: '#8fd8ff',
  dragon: '#eaffff',
};

export class Renderer {
  constructor(canvas, manifest = LEVEL_ART_MANIFEST) {
    this.canvas = canvas;
    this.ctx    = canvas.getContext('2d');
    this._tick  = 0;
    this._levelArtManifest = parseLevelArtManifest(manifest);
    // The ground line of the level currently selected (see setBackgroundByLevel).
    // The characters stand on it; a level whose art paints its floor elsewhere
    // moves it through the `groundY` overrides in levels/manifest.json.
    this.groundY = GROUND_Y;
    this._bgImage = new Image();
    this._fallbackBgImage = new Image();
    // Nothing is requested eagerly: the level decides the background in
    // setBackgroundByLevel(). Only load the fallback (a generic, unbranded
    // scene not used by any stage — see background.webp) if the selected
    // level or stage image actually fails, so a failed chapter swap never
    // flashes the wrong picture. Until the real image loads,
    // drawBackground()'s solid-color rect covers the gap instead.
    this._bgUrl = '';
    this._bgFailed = false;
    // Lazily built 800x450 downscale of the art currently loaded into _bgImage
    // (see _scaledBackground). Keyed on the image object, so setBackgroundByLevel
    // drops it whenever a new src is assigned to the same object.
    this._bgScaled = null;
    this._bgScaledSource = null;
    this._preloadedLevelArt = new Set();
    this._bgImage.addEventListener('error', () => {
      this._bgFailed = true;
      if (!this._fallbackBgImage.src) this._fallbackBgImage.src = FALLBACK_BACKGROUND_URL;
    });
    // DOM overlay for the pulsating combo-ability border. It sits above the
    // canvas HUD bar (top), which otherwise paints over a border drawn onto
    // the canvas itself, making it visible on left/right only. See
    // index.html/styles.css for #combo-frame.
    this._comboFrameEl = canvas.parentElement && canvas.parentElement.querySelector('#combo-frame');
    // The band the frame is currently painted for, so the idle clear is not
    // re-applied on every frame (see drawComboFrame).
    this._comboBand = null;
  }

  clear() {
    this.ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    this._tick++;
  }

  // Pulsating border around the whole play area while the combo counter is
  // deep enough in a special-ability band, colored to match that ability's
  // own sprite/effect palette (see Fireball/LightningBolt trailColor and the
  // DragonSummon ice-breath palette in entities.js) so the frame telegraphs
  // which ability is "charged" before it actually fires.
  //
  // Drawn as a DOM overlay (#combo-frame) rather than onto the canvas: the
  // HUD bar (top) is painted over the canvas edges, so a border stroked
  // directly on the canvas is only ever visible on the left/right. The
  // overlay belongs to #playfield, so it frames the uncropped scene on all
  // four sides independently of the sibling answer panel.
  drawComboFrame(band, ts) {
    const el = this._comboFrameEl;
    if (!el) return;
    const color = COMBO_FRAME_COLORS[band];
    if (!color) {
      // The loop calls this on every frame; clearing an already-clear frame
      // re-set the style attribute 60 times a second, and each write cost a
      // style recalculation for the whole document.
      if (this._comboBand !== null) {
        this._comboBand = null;
        el.style.opacity = '0';
      }
      return;
    }
    this._comboBand = band;
    const pulse = (Math.sin(ts / 220) + 1) / 2; // 0..1
    const alpha = 0.35 + pulse * 0.45;
    const thickness = 3 + pulse * 3;
    el.style.opacity = String(alpha);
    el.style.borderWidth = thickness + 'px';
    el.style.borderColor = color;
    el.style.boxShadow = `0 0 ${6 + pulse * 6}px ${color} inset, 0 0 ${6 + pulse * 6}px ${color}`;
  }

  setBackgroundByLevel(levelNumber) {
    // Set before the URL short-circuit below: two levels can share one chapter
    // image yet still ship different ground lines.
    this.groundY = resolveLevelGroundY(levelNumber, this._levelArtManifest) ?? GROUND_Y;
    const url = resolveLevelBackground(levelNumber, this._levelArtManifest);
    // Cache on the resolved URL: a newly committed level image replaces the
    // stage art of the same chapter instead of being skipped by stage index.
    if (url === this._bgUrl && this._bgImage.src) return;
    this._bgUrl = url;
    this._bgFailed = false;
    this._bgImage.src = url;
    this._bgScaled = null;
    this._bgScaledSource = null;
  }

  // Warms the browser cache for the given levels without awaiting them. Only
  // levels with a manifest entry are requested, so no image is fetched for a
  // level whose art has not been committed yet.
  preloadLevelArt(levels) {
    for (const level of levels ?? []) {
      const number = Number.parseInt(level, 10);
      const file = this._levelArtManifest.levels[String(number)];
      const url = file ? levelArtUrl(number, file) : null;
      if (!url || this._preloadedLevelArt.has(url)) continue;
      this._preloadedLevelArt.add(url);
      const image = new Image();
      image.decoding = 'async';
      image.src = url;
    }
  }

  // Resolves once the level or stage background most recently selected by
  // setBackgroundByLevel() has actually finished loading (or errored). Even
  // when its bytes are already in the browser's HTTP cache, swapping
  // `_bgImage.src` still requires a fresh decode before `.complete`/
  // `.naturalWidth` become true again — during that gap drawBackground()
  // falls back to a flat color rect. main.js awaits this before revealing a
  // level, so a chapter-boundary swap (every 10 levels) never flashes that
  // fallback rect on screen.
  waitForBackgroundLoad() {
    if (!this._bgImage.src || this._bgFailed) return Promise.resolve();
    if (this._bgImage.complete && this._bgImage.naturalWidth) return Promise.resolve();
    return new Promise((resolve) => {
      this._bgImage.addEventListener('load', resolve, { once: true });
      this._bgImage.addEventListener('error', resolve, { once: true });
    });
  }

  // ─── main background ────────────────────────────────────────────────────────
  // The level art is a 1536x1024 image that never changes while a level is on
  // screen — drawBackground() is only ever called with scrollX 0 — so it is
  // downscaled once into a canvas of exactly the playfield size and blitted
  // from there. Re-scaling it twice on every frame was the most expensive thing
  // in an otherwise flat frame, and with scrollX 0 the second copy landed at
  // x = CANVAS_W, entirely outside the canvas.
  _scaledBackground(bgImage) {
    if (this._bgScaled && this._bgScaledSource === bgImage) return this._bgScaled;
    const element = typeof document !== 'undefined' ? document.createElement?.('canvas') : null;
    const ctx = element && element.getContext?.('2d');
    if (!ctx) return null;
    const dh = bgImage.naturalHeight * (CANVAS_W / bgImage.naturalWidth);
    element.width = CANVAS_W;
    element.height = CANVAS_H;
    ctx.drawImage(bgImage, 0, (CANVAS_H - dh) / 2, CANVAS_W, dh);
    this._bgScaled = element;
    this._bgScaledSource = bgImage;
    return element;
  }

  drawBackground(scrollX) {
    const ctx = this.ctx;
    const bgImage = this._bgImage.complete && this._bgImage.naturalWidth ? this._bgImage : this._fallbackBgImage;
    if (!bgImage.complete || !bgImage.naturalWidth) {
      ctx.fillStyle = '#3a8ec8';
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
      return;
    }
    const off = mod(scrollX * 0.2, CANVAS_W);
    const scaled = this._scaledBackground(bgImage);
    if (!scaled) {
      // No DOM canvas to cache into (tests, or a context we could not get):
      // draw the image directly, exactly as before.
      const dh = bgImage.naturalHeight * (CANVAS_W / bgImage.naturalWidth);
      const dy = (CANVAS_H - dh) / 2;
      ctx.drawImage(bgImage, -off, dy, CANVAS_W, dh);
      ctx.drawImage(bgImage, -off + CANVAS_W, dy, CANVAS_W, dh);
      return;
    }
    ctx.drawImage(scaled, -off, 0);
    // The wrapped second copy only covers anything once the art is scrolled.
    if (off > 0) ctx.drawImage(scaled, -off + CANVAS_W, 0);
  }

  // ─── public API ─────────────────────────────────────────────────────────────
  drawEntity(entity) { entity.draw(this.ctx); }

  // Shared "chrome" (shadow/border/body/accent/tail) for the fiend problem
  // bubble, factored out so both the text-question bubble (drawSpeechBubble)
  // and the Shapes-mode shape-count bubble (drawShapeBubble) render with
  // an identical frame around whatever content each one draws inside it.
  _drawBubbleChrome(bx, by, bW, bH, isActive) {
    const ctx=this.ctx,P=LOGICAL_PX;
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
  }

  /** isActive=true → blue border (combat question), false → grey (queued) */
  drawSpeechBubble(x, y, text, isActive = true) {
    const P=LOGICAL_PX;
    const charW=6*P,tW=text.length*charW,padX=12,padY=8;
    const bW=tW+padX*2,bH=7*P+padY*2;
    let bx=~~(x-bW/2);bx=Math.max(4,Math.min(CANVAS_W-bW-4,bx));
    const by=~~(y-bH-20);
    this._drawBubbleChrome(bx, by, bW, bH, isActive);
    this._text(text,bx+padX,by+padY+4,isActive?'#1020a0':'#303030');
  }

  /**
   * Shapes-mode bubble: draws `count` (1-10) filled shape icons
   * (square/circle/triangle) in a grid (up to 5 per row, wrapping to a
   * 2nd row) instead of a text question, using the same bubble chrome as
   * drawSpeechBubble so both problem styles read consistently in-game.
   */
  drawShapeBubble(x, y, shapeType, count, isActive = true) {
    const ctx=this.ctx,P=LOGICAL_PX;
    const cols=Math.min(count,5),rows=Math.ceil(count/5);
    const cell=5*P,gap=3*P,padX=12,padY=8;
    const gridW=cols*cell+(cols-1)*gap,gridH=rows*cell+(rows-1)*gap;
    const bW=gridW+padX*2,bH=gridH+padY*2;
    let bx=~~(x-bW/2);bx=Math.max(4,Math.min(CANVAS_W-bW-4,bx));
    const by=~~(y-bH-20);
    this._drawBubbleChrome(bx, by, bW, bH, isActive);

    ctx.fillStyle=isActive?'#1020a0':'#303030';
    for(let i=0;i<count;i++){
      const col=i%5,row=Math.floor(i/5);
      const cx=bx+padX+col*(cell+gap)+cell/2;
      const cy=by+padY+row*(cell+gap)+cell/2;
      this._drawShapeIcon(shapeType,cx,cy,cell);
    }
  }

  _drawShapeIcon(shapeType, cx, cy, size) {
    const ctx=this.ctx,half=size/2;
    if(shapeType==='circle'){
      ctx.beginPath();ctx.arc(cx,cy,half*0.85,0,Math.PI*2);ctx.fill();
    } else if(shapeType==='triangle'){
      ctx.beginPath();
      ctx.moveTo(cx,cy-half);ctx.lineTo(cx+half,cy+half);ctx.lineTo(cx-half,cy+half);
      ctx.closePath();ctx.fill();
    } else {
      ctx.fillRect(cx-half*0.85,cy-half*0.85,size*0.85,size*0.85);
    }
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

  drawHUD(hearts, maxHearts, score, combo, levelLabel, healGlowRatio=0, healFillRatio=0, hideScore=false) {
    const ctx=this.ctx,P=LOGICAL_PX;
    const hP=P>>1;                        // half-scale pixel for hearts/icons (2 when P=4)
    const barH=7*P+10;                    // bar height: 38px when P=4
    ctx.fillStyle='rgba(0,0,0,.55)';ctx.fillRect(0,0,CANVAS_W,barH);
    ctx.fillStyle='#1a3060';ctx.fillRect(0,barH-2,CANVAS_W,2);
    // HP label box — wide enough to contain "HP" text
    const hpS=0.65,hpTW=~~(2*6*P*hpS),hpBW=hpTW+6;
    ctx.fillStyle='#e83030';ctx.fillRect(4,5,hpBW,barH-10);
    this._text('HP',7,~~(5+(barH-10-7*P*hpS)/2),'#fff',hpS);
    // hearts — scaled with hP so they match the text height
    const heartY=~~((barH-10*hP)/2);
    // Pulsing green glow behind the hearts row while hold-to-heal is active
    // (same hue as the hero's healing aura — see entities.js Hero._drawHealAura),
    // drawn before the heart icons so it reads as a backdrop, not an overlay.
    if(healGlowRatio>0){
      const glowW=maxHearts*16*hP+6*hP,glowX=4+hpBW+4-3*hP,glowY=heartY-3*hP,glowH=10*hP+6*hP;
      const pulse=(Math.sin(Date.now()/260)+1)/2;
      ctx.save();
      ctx.globalAlpha=healGlowRatio*(0.25+pulse*0.35);
      ctx.fillStyle='#30f060';
      ctx.fillRect(glowX,glowY,glowW,glowH);
      ctx.globalAlpha=healGlowRatio*(0.2+pulse*0.25);
      ctx.fillStyle='#c8ffb0';
      ctx.fillRect(glowX+2*hP,glowY+2*hP,glowW-4*hP,glowH-4*hP);
      ctx.restore();
    }
    // Gradual per-heart cue: the *next* empty heart to be healed progressively
    // brightens/fills in (empty red → full red, plus its highlight fading in)
    // as healFillRatio climbs from 0 to 1, instead of only flipping at the
    // instant the heart is actually granted. healFillRatio is the raw
    // (unfloored) hold-to-heal progress ratio — see heal-hold.js.
    const nextHealIdx = healFillRatio>0 ? hearts : -1;
    for(let i=0;i<maxHearts;i++){
      const hx=4+hpBW+4+i*16*hP,hy=heartY,f=i<hearts;
      const healing=i===nextHealIdx;
      const bodyColor=healing?this._lerpColor('#6a2020','#e82020',healFillRatio):(f?'#e82020':'#6a2020');
      ctx.fillStyle=bodyColor;
      ctx.fillRect(hx+hP,hy,4*hP,3*hP);ctx.fillRect(hx+7*hP,hy,4*hP,3*hP);
      ctx.fillRect(hx,hy+2*hP,12*hP,5*hP);ctx.fillRect(hx+2*hP,hy+7*hP,8*hP,2*hP);
      ctx.fillRect(hx+4*hP,hy+9*hP,4*hP,hP);
      if(f||healing){
        ctx.save();
        ctx.globalAlpha=healing?healFillRatio:1;
        ctx.fillStyle='#ff6868';
        ctx.fillRect(hx+2*hP,hy+hP,3*hP,2*hP);
        ctx.restore();
      }
    }
    // coin + score (right-aligned) — hidden in Shapes mode, which is
    // deliberately unscored, so there's nothing to show here.
    if(!hideScore){
      const ty=~~((barH-7*P)/2);
      const sc=''+(score|0);const scoreX=CANVAS_W-10-sc.length*6*P;
      const cW=(7*P)>>1;                    // coin size: 14px when P=4
      const coinX=scoreX-cW-4,coinY=ty+~~((7*P-cW)/2);
      ctx.fillStyle='#e8c040';ctx.fillRect(coinX,coinY,cW,cW);
      ctx.fillStyle='#fce880';ctx.fillRect(coinX+1,coinY+1,cW-2,cW>>1);
      ctx.fillStyle='#b09020';ctx.fillRect(coinX,coinY+cW-2,cW,2);
      this._text(sc,scoreX,ty,'#f8e040');
      // combo — placed left of coin on the same row so it stays inside the bar
      if(combo>=2){
        const cs='×'+combo,csS=0.65,csW=~~(cs.length*6*P*csS);
        this._text(cs,coinX-6-csW,ty+~~(7*P*(1-csS)/2),'#ff8020',csS);
      }
    }
    // level (centred, but nudged right if a wide hearts row — e.g. the
    // generous heart count used by Shapes mode — would otherwise
    // run into it; centering alone assumes a short hearts row, which isn't
    // true for every difficulty setting)
    const heartsEndX = 4+hpBW+4+maxHearts*16*hP;
    const llX = Math.max(~~(CANVAS_W/2-levelLabel.length*3*P), heartsEndX+6);
    this._text(levelLabel,llX,~~((barH-7*P)/2),'#f0f0f0');
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

  // Linearly interpolates between two '#rrggbb' hex colors at t (0..1).
  // Used for the hearts row's gradual "next heart is healing" fill.
  _lerpColor(colorA, colorB, t) {
    const a=parseInt(colorA.slice(1),16),b=parseInt(colorB.slice(1),16);
    const ar=(a>>16)&255,ag=(a>>8)&255,ab=a&255;
    const br=(b>>16)&255,bg=(b>>8)&255,bb=b&255;
    const r=Math.round(ar+(br-ar)*t),g=Math.round(ag+(bg-ag)*t),bl=Math.round(ab+(bb-ab)*t);
    return `rgb(${r},${g},${bl})`;
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
