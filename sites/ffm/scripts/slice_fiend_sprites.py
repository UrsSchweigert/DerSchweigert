#!/usr/bin/env python3
"""One-off slicer for the WS4 fiend sprite sheets.

Slices fiend_sprites_1.png and fiend_sprites_2.png (each 1536x1024, RGBA,
18 creatures in a 6-col x 3-row grid) into 36 individual auto-cropped PNGs.

Run once from the repo root with the project venv active:
    source ../../DerSchweigert/.venv/bin/activate
    python3 sites/ffm/scripts/slice_fiend_sprites.py

Idempotent: safe to re-run; it overwrites existing output files.
"""
from collections import deque
from pathlib import Path

from PIL import Image

FFM_ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIR = FFM_ROOT / "static" / "game" / "source-assets"
OUTPUT_DIR = FFM_ROOT / "static" / "game" / "fiend-sprites"

SHEETS = [
    ("set1", SOURCE_DIR / "fiend_sprites_1.png"),
    ("set2", SOURCE_DIR / "fiend_sprites_2.png"),
]

COLS = 6
ROWS = 3
SHEET_W = 1536
SHEET_H = 1024
CELL_W = SHEET_W // COLS

PADDING = 6
ALPHA_THRESHOLD = 8


def cell_box(row, col):
    """Nominal (left, top, right, bottom) box for 0-indexed grid cell."""
    left = col * CELL_W
    right = left + CELL_W
    top = (row * SHEET_H) // ROWS
    bottom = ((row + 1) * SHEET_H) // ROWS
    return left, top, right, bottom


def find_components(mask, width, height):
    """Find all 4-connected components of solid pixels using iterative flood fill.
    
    Returns list of (component_id, set of (x, y) tuples in this component).
    """
    visited = [[False] * width for _ in range(height)]
    components = []
    
    for y in range(height):
        for x in range(width):
            if visited[y][x]:
                continue
            pixel = mask.getpixel((x, y))
            if pixel == 0:
                continue
            
            # Start flood fill from this unvisited solid pixel
            component = set()
            queue = deque([(x, y)])
            visited[y][x] = True
            
            while queue:
                cx, cy = queue.popleft()
                component.add((cx, cy))
                
                # Check 4-connected neighbors
                for nx, ny in [(cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)]:
                    if 0 <= nx < width and 0 <= ny < height and not visited[ny][nx]:
                        neighbor_pixel = mask.getpixel((nx, ny))
                        if neighbor_pixel > 0:
                            visited[ny][nx] = True
                            queue.append((nx, ny))
            
            components.append(component)
    
    return components


def autocrop_cell(sheet, row, col, index, sheet_name):
    left, top, right, bottom = cell_box(row, col)
    cell = sheet.crop((left, top, right, bottom))
    alpha = cell.getchannel("A")
    mask = alpha.point(lambda a: 255 if a > ALPHA_THRESHOLD else 0)
    
    # Find all connected components
    components = find_components(mask, cell.width, cell.height)
    
    if not components:
        print(f"WARNING: {sheet_name} grid index {index} (row {row + 1}, col {col + 1}) is empty - skipping")
        return None
    
    # Find largest component (main creature)
    largest_comp = max(components, key=len)
    main_min_x = min(x for x, y in largest_comp)
    main_max_x = max(x for x, y in largest_comp)
    
    # Keep components that overlap horizontally with main creature
    kept_components = []
    dropped_count = 0
    
    for comp in components:
        comp_min_x = min(x for x, y in comp)
        comp_max_x = max(x for x, y in comp)
        
        # Check overlap: NOT (comp_max_x < main_min_x or comp_min_x > main_max_x)
        if not (comp_max_x < main_min_x or comp_min_x > main_max_x):
            kept_components.append(comp)
        else:
            dropped_count += 1
    
    # Build cleaned image by erasing dropped components
    cleaned_cell = cell.convert("RGBA")
    pixels = cleaned_cell.load()
    
    for x in range(cell.width):
        for y in range(cell.height):
            r, g, b, a = pixels[x, y]
            # Check if this pixel is in a kept component
            in_kept = any((x, y) in comp for comp in kept_components)
            if not in_kept:
                pixels[x, y] = (r, g, b, 0)
    
    # Compute bbox from cleaned mask
    cleaned_alpha = cleaned_cell.getchannel("A")
    cleaned_mask = cleaned_alpha.point(lambda a: 255 if a > ALPHA_THRESHOLD else 0)
    bbox = cleaned_mask.getbbox()
    
    if bbox is None:
        print(f"WARNING: {sheet_name} grid index {index} (row {row + 1}, col {col + 1}) is empty after cleanup - skipping")
        return None
    
    bx0, by0, bx1, by1 = bbox
    bx0 = max(0, bx0 - PADDING)
    by0 = max(0, by0 - PADDING)
    bx1 = min(cell.width, bx1 + PADDING)
    by1 = min(cell.height, by1 + PADDING)
    
    cropped = cleaned_cell.crop((bx0, by0, bx1, by1))
    return cropped, dropped_count


def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    for set_name, path in SHEETS:
        if not path.exists():
            raise FileNotFoundError(f"Missing source sheet: {path}")
        sheet = Image.open(path).convert("RGBA")
        assert sheet.size == (SHEET_W, SHEET_H), f"{path} is not {SHEET_W}x{SHEET_H}: {sheet.size}"

        index = 0
        for row in range(ROWS):
            for col in range(COLS):
                index += 1
                result = autocrop_cell(sheet, row, col, index, set_name)
                if result is None:
                    continue
                cropped, dropped_count = result
                out_path = OUTPUT_DIR / f"{set_name}-{index:02d}.png"
                cropped.save(out_path)
                if dropped_count > 0:
                    print(f"{out_path.name}: {cropped.width}x{cropped.height} (dropped {dropped_count} stray blobs)")
                else:
                    print(f"{out_path.name}: {cropped.width}x{cropped.height}")


if __name__ == "__main__":
    main()
