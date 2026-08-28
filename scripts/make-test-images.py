"""Generate test images (jpg/png/webp) for Crop Images tool verification."""
import os
from PIL import Image, ImageDraw

out = '/home/z/my-project/upload'
os.makedirs(out, exist_ok=True)

# Image 1: JPG 1200x800 with a grid so crop results are visually verifiable
img = Image.new('RGB', (1200, 800), (240, 244, 248))
d = ImageDraw.Draw(img)
for x in range(0, 1200, 100):
    d.line([(x, 0), (x, 800)], fill=(180, 190, 200), width=2)
for y in range(0, 800, 100):
    d.line([(0, y), (1200, y)], fill=(180, 190, 200), width=2)
d.rectangle([100, 100, 1100, 700], outline=(220, 60, 60), width=6)
d.ellipse([500, 300, 700, 500], fill=(60, 120, 220))
d.text((60, 40), 'TEST JPG 1200x800', fill=(30, 30, 30))
img.save(f'{out}/test-photo.jpg', 'JPEG', quality=92)

# Image 2: PNG 640x480 with checker pattern
img2 = Image.new('RGB', (640, 480), (255, 255, 255))
d2 = ImageDraw.Draw(img2)
s = 40
for iy in range(0, 480 // s):
    for ix in range(0, 640 // s):
        if (ix + iy) % 2 == 0:
            d2.rectangle([ix * s, iy * s, (ix + 1) * s, (iy + 1) * s], fill=(90, 160, 120))
d2.text((20, 20), 'TEST PNG 640x480', fill=(0, 0, 0))
img2.save(f'{out}/test-checker.png', 'PNG')

# Image 3: WebP 800x600 gradient-ish
img3 = Image.new('RGB', (800, 600), (250, 240, 220))
d3 = ImageDraw.Draw(img3)
for i in range(12):
    d3.ellipse([i * 60, 100 + i * 20, i * 60 + 200, 300 + i * 20],
               outline=(200, 120, 40), width=4)
d3.text((20, 20), 'TEST WEBP 800x600', fill=(0, 0, 0))
img3.save(f'{out}/test-webp.webp', 'WEBP', quality=90)

for f in ['test-photo.jpg', 'test-checker.png', 'test-webp.webp']:
    p = os.path.join(out, f)
    print(f, os.path.getsize(p), 'bytes')
