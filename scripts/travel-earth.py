"""Builds the satellite textures for the travel map (web/travel-earth/).

Source: NASA Blue Marble (public domain), as shipped in the three-globe npm package
(example/img/earth-blue-marble.jpg, 4096x2048, equirectangular, -180..180).

    npm pack three-globe@2.45.6 && tar xzf three-globe-2.45.6.tgz package/example/img/earth-blue-marble.jpg
    python3 scripts/travel-earth.py package/example/img/earth-blue-marble.jpg

Writes:
  earth-2048.webp, earth-4096.webp  equirectangular, for the 3D globe (WebGL texture)
  merc-2048.webp, merc-4096.webp    Web Mercator from 84N to 57S, for the flat map
"""
import math
import os
import sys

import numpy as np
from PIL import Image

NORTH, SOUTH = 84.0, -57.0
OUT = os.path.join(os.path.dirname(__file__), '..', 'web', 'travel-earth')


def merc_y(lat):
    return math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))


def mercator(src, width):
    """Resamples an equirectangular image to Web Mercator, row by row (linear between source rows)."""
    img = src.resize((width, width // 2), Image.LANCZOS)
    arr = np.asarray(img).astype(np.float32)
    rows = arr.shape[0]
    top, bottom = merc_y(NORTH), merc_y(SOUTH)
    height = round(width * (top - bottom) / (2 * math.pi))
    out = np.empty((height, width, 3), np.float32)
    for j in range(height):
        y = top - (j + 0.5) / height * (top - bottom)
        lat = math.degrees(math.atan(math.sinh(y)))
        pos = (90 - lat) / 180 * rows - 0.5
        lo = max(0, min(rows - 1, math.floor(pos)))
        hi = min(rows - 1, lo + 1)
        t = min(1.0, max(0.0, pos - lo))
        out[j] = arr[lo] * (1 - t) + arr[hi] * t
    return Image.fromarray(out.clip(0, 255).astype(np.uint8))


def main(path):
    os.makedirs(OUT, exist_ok=True)
    src = Image.open(path).convert('RGB')
    for width, quality in ((2048, 78), (4096, 74)):
        src.resize((width, width // 2), Image.LANCZOS).save(os.path.join(OUT, f'earth-{width}.webp'), 'WEBP', quality=quality, method=6)
        mercator(src, width).save(os.path.join(OUT, f'merc-{width}.webp'), 'WEBP', quality=quality, method=6)
    for name in sorted(os.listdir(OUT)):
        print(name, os.path.getsize(os.path.join(OUT, name)))


if __name__ == '__main__':
    main(sys.argv[1])
