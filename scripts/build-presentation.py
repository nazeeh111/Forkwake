"""Compose a held-frame walkthrough from actual browser captures.

Requires Pillow only for this optional asset build, never to run Forkwake.
Recapture instructions and exact source/input identities: docs/demos/README.md.
No nodes, source, result values or interface text are drawn by this script.
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
frames = ROOT / 'docs/demos/frames'
titles = [('tree', 'Explore a real response tree'),
          ('origin', 'Inspect recorded callers at dispatch'),
          ('outcome', 'Read the actual unpaid-dispatch output')]
font_path = Path('/System/Library/Fonts/Supplemental/Arial.ttf')
font = ImageFont.truetype(str(font_path), 22) if font_path.exists() else ImageFont.load_default(size=22)
images = []
for name, title in titles:
    screenshot = Image.open(frames / f'{name}.jpg').convert('RGB')
    screenshot.thumbnail((1152, 800), Image.Resampling.LANCZOS)
    frame = Image.new('RGB', (1152, 856), '#ffffff')
    draw = ImageDraw.Draw(frame)
    draw.rectangle((0, 0, 1152, 55), fill='#202a3b')
    draw.text((20, 15), title, font=font, fill='white')
    frame.paste(screenshot, ((1152-screenshot.width)//2, 56))
    images.append(frame)
images[0].save(ROOT/'docs/futures-walkthrough.gif', save_all=True,
    append_images=images[1:], duration=[4000,5000,5000], loop=0,
    optimize=False, disposal=2)
print('Built docs/futures-walkthrough.gif from three unretouched interface frames.')
