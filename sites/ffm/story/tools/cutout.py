#!/usr/bin/env python3
"""Turn a raw layer image into a transparent diorama cutout.

Raw character and scenery layers are generated on a plain, near-white
background. The background is removed by flood-filling from the image edges
over near-white pixels only, so light areas *inside* the artwork (the cream
cut border, moonlit highlights) stay opaque. The result is trimmed to its
content plus a small margin and saved as an RGBA PNG.

Usage: cutout.py RAW.png OUT.png [--tolerance 24] [--max-width 1600]
"""
import argparse
import sys
from collections import deque

from PIL import Image, ImageFilter


def background_mask(img, tolerance):
    w, h = img.size
    px = img.load()
    floor = 255 - tolerance
    mask = Image.new('L', (w, h), 0)
    mp = mask.load()

    def is_bg(x, y):
        r, g, b = px[x, y][:3]
        return min(r, g, b) >= floor and max(r, g, b) - min(r, g, b) <= tolerance

    queue = deque()
    for x in range(w):
        queue.extend(((x, 0), (x, h - 1)))
    for y in range(h):
        queue.extend(((0, y), (w - 1, y)))
    while queue:
        x, y = queue.popleft()
        if mp[x, y] or not is_bg(x, y):
            continue
        mp[x, y] = 255
        if x > 0: queue.append((x - 1, y))
        if x < w - 1: queue.append((x + 1, y))
        if y > 0: queue.append((x, y - 1))
        if y < h - 1: queue.append((x, y + 1))
    return mask


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument('raw')
    parser.add_argument('out')
    parser.add_argument('--tolerance', type=int, default=24)
    parser.add_argument('--max-width', type=int, default=1600)
    args = parser.parse_args(argv)

    img = Image.open(args.raw).convert('RGBA')
    bg = background_mask(img, args.tolerance)
    # Grow the background by one pixel and soften it, so the light fringe left
    # by anti-aliasing against white disappears into a clean, slightly
    # feathered paper edge.
    bg = bg.filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.GaussianBlur(0.8))
    alpha = Image.eval(bg, lambda v: 255 - v)
    img.putalpha(alpha)

    box = alpha.point(lambda v: 255 if v > 8 else 0).getbbox()
    if not box:
        sys.exit(f'{args.raw}: nothing left after background removal')
    pad = 8
    box = (max(0, box[0] - pad), max(0, box[1] - pad),
           min(img.width, box[2] + pad), min(img.height, box[3] + pad))
    img = img.crop(box)
    if img.width > args.max_width:
        ratio = args.max_width / img.width
        img = img.resize((args.max_width, round(img.height * ratio)), Image.LANCZOS)
    img.save(args.out, optimize=True)
    opaque = sum(1 for v in img.getchannel('A').getdata() if v > 128) / (img.width * img.height)
    print(f'{args.out}: {img.width}x{img.height}, {opaque:.0%} opaque')


if __name__ == '__main__':
    main()
