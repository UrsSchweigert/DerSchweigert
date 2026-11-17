#!/usr/bin/env python3
"""Split the original hero's atlas into colour regions, so schemes can recolour each one.

    hero_regions.py            write scripts/data/hero-regions.png  (index map, same size as hero/hero-atlas.webp)
    hero_regions.py --preview OUT.png   also write a flat-colour contact sheet to review the split

The map is a one-off of this script and is committed; hero_recolor.py reads only the map.
Regions are found from colour (hue/saturation/value) plus where the eyes are in each frame, which
is how hair is told from skin. Pixels that belong to none of the recolourable regions
(outline, belt, buckles, sword, pauldron, eyes) are FIXED or METAL and are never changed.
Rerun only if static/game/hero/ changes; review the preview, then commit the new map.
"""
import re
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

GAME = Path(__file__).resolve().parents[1] / "static" / "game"
MAP_PATH = Path(__file__).resolve().parent / "data" / "hero-regions.png"
REGIONS = ["none", "hair", "skin", "tunic", "scarf", "gloves", "boots", "cape", "metal", "fixed"]
PREVIEW_COLOURS = [(255, 255, 255), (255, 225, 0), (255, 150, 170), (40, 80, 255), (255, 0, 0), (0, 200, 0),
                   (140, 70, 0), (255, 100, 0), (170, 170, 170), (0, 0, 0)]


def frames():
    src=open(GAME/'hero'/'hero-frames.js').read()
    return {m[0]:tuple(int(x) for x in m[1:]) for m in re.findall(r"'([a-z]+-\d)': \{ x: (\d+), y: (\d+), w: (\d+), h: (\d+)",src)}
def hsv(rgb):
    x=np.asarray(Image.fromarray(rgb).convert('HSV')).astype(float)
    return x[...,0]*360/255,x[...,1]/255,x[...,2]/255
def classify_frame(a):
    rgb=a[...,:3]; op=a[...,3]>0; H,W=op.shape
    h,s,v=hsv(rgb)
    yy=np.arange(H)[:,None]*np.ones((1,W)); xx=np.ones((H,1))*np.arange(W)[None]
    red=((h>=335)|(h<12))&(s>.5)&(v>.3)
    warm=((h>=8)&(h<60))&(s>.3)&(v>.25)
    blue=(h>190)&(h<265)&(s>.25)
    eye=blue&(v>.6)&(s>.5)
    neutral=s<.3
    c=np.full((H,W),9)
    c[op&blue&(v>=.2)]=3
    c[op&blue&(v<.2)&(s>.4)]=3   # the shadowed, far-side cloth is very dark navy
    c[op&neutral&(v>.35)]=8
    c[op&red]=4
    c[op&warm]=2
    c[~op]=0
    # sword/pauldron: big bright neutral components, grown by 2px
    lab,n=ndi.label(op&neutral&(v>.35)&(~warm))
    from scipy.spatial import ConvexHull
    from PIL import ImageDraw
    def convex_hull_image(m):
        pts=np.argwhere(m)[:,::-1]
        hl=ConvexHull(pts); poly=[tuple(map(float,pts[i])) for i in hl.vertices]
        im=Image.new('L',(m.shape[1],m.shape[0]),0); ImageDraw.Draw(im).polygon(poly,fill=1,outline=1)
        return np.asarray(im).astype(bool)
    big=np.zeros((H,W),bool)
    for i in range(1,n+1):
        m=lab==i
        if m.sum()>=60: big|=convex_hull_image(m)
    swordzone=ndi.binary_dilation(big,iterations=1)&op
    # head
    ys,xs=np.nonzero(eye&op)
    top=np.nonzero(((c==2)&warm).any(1))[0][0]
    ys,xs=(ys[ys<top+int(.55*H)],xs[ys<top+int(.55*H)]) if len(ys) else (ys,xs)
    deepgold=(s>.55)|(v<.7)
    if len(ys):
        ey0,ey1,ex0,ex1=ys.min(),ys.max(),xs.min(),xs.max()
        headzone=(yy<ey1+14)&(xx>ex0-26)&(xx<ex1+26)
        face=(yy>=ey0-2)&(yy<ey1+9)&(xx>=ex0-5)&(xx<=ex1+5)
        hair=(c==2)&headzone&(~face|deepgold)
        headbot=ey1+14
    else:
        # eyes closed (dead frames): the biggest deep-gold blob is the hair
        wl,wn=ndi.label((c==2)&deepgold)
        sizes=ndi.sum(np.ones_like(wl),wl,range(1,wn+1)); k=1+int(np.argmax(sizes))
        blob=ndi.binary_dilation(wl==k,iterations=3)
        hair=(c==2)&blob&deepgold
        headbot=0
    c[hair]=1
    if len(ys):
        c[eye&op&(yy<ey1+14)&(xx>ex0-8)&(xx<ex1+8)]=9   # eyes keep their own colour
    # darks
    dark=op&(~warm)&(~red)&((v<.14)|(neutral&(v<=.35)))
    core=ndi.binary_opening(op&(~warm)&(~red)&neutral&(v<=.35)&(v>=.05),structure=np.ones((2,2)))
    thick=ndi.binary_dilation(core,iterations=2)&dark
    lowzone=yy>H*.74
    bootdark=ndi.binary_opening(dark&(v<.14),structure=np.ones((2,2)))&(yy>H*.74)
    thick=thick|bootdark
    if not len(ys): thick=np.zeros((H,W),bool)
    c[thick&(c!=1)]=5
    c[(c==5)&lowzone]=6
    brown=(c==2)&(v<.78)
    c[brown&lowzone]=6
    c[brown&(~lowzone)&(yy>headbot)&(v<.62)]=9
    c[c==4]=7
    if len(ys):
        sc=(yy>=ey1+3)&(yy<=ey1+24)&(xx>=ex0-14)&(xx<=ex1+20)
        c[(c==7)&sc]=4
    else:
        c[c==7]=4
    # sword zone overrides: only blade/guard colours stay fixed, red wraps stay scarf
    c[swordzone&((c==5)|(c==6)|(c==9)|(c==3)|((c==2)&(v<.78)))]=8
    return c

def smooth_darks(a, full):
    """Dark pixels (gloves, boots, outline, dark folds) alternate between labels at the pixel level; vote by 5x5 majority."""
    rgb = a[..., :3].astype(float) / 255
    dark = (a[..., 3] > 0) & (rgb.max(-1) < 0.36) & np.isin(full, [3, 5, 6, 9])
    cands = [3, 5, 6, 9]
    votes = np.stack([ndi.uniform_filter((np.isin(full, [k]) & dark).astype(float), size=5) for k in cands])
    best = np.array(cands)[votes.argmax(0)]
    # a boots/gloves vote must also clear a floor, so a lone outline pixel does not turn into a glove
    out = full.copy()
    out[dark] = best[dark]
    return out


def build_map():
    a = np.asarray(Image.open(GAME / "hero" / "hero-atlas.webp").convert("RGBA"))
    full = np.zeros(a.shape[:2], np.uint8)
    for _name, (x, y, w, hh) in frames().items():
        full[y:y + hh, x:x + w] = classify_frame(a[y:y + hh, x:x + w])
    return a, smooth_darks(a, full)


def main():
    a, full = build_map()
    MAP_PATH.parent.mkdir(parents=True, exist_ok=True)
    img = Image.frombytes("P", (full.shape[1], full.shape[0]), full.tobytes())
    pal = [c for col in PREVIEW_COLOURS for c in col] + [0] * (768 - 3 * len(PREVIEW_COLOURS))
    img.putpalette(pal)
    img.save(MAP_PATH, optimize=True)
    counts = {REGIONS[i]: int((full == i).sum()) for i in range(len(REGIONS))}
    print("wrote", MAP_PATH, counts)
    if "--preview" in sys.argv:
        out = Image.fromarray(np.asarray(img.convert("RGB")))
        out.save(sys.argv[sys.argv.index("--preview") + 1])


if __name__ == "__main__":
    main()
