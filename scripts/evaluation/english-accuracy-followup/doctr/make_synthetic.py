"""生成自有两行文字冒烟样张；不下载字体或读取用户图片。"""
import argparse
import hashlib
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
p=argparse.ArgumentParser();p.add_argument('--output',type=Path,required=True);p.add_argument('--font',required=True);a=p.parse_args()
a.output.mkdir(parents=True,exist_ok=True)
image=Image.new('RGB',(768,384),'white');draw=ImageDraw.Draw(image);font=ImageFont.truetype(a.font,42)
draw.text((40,80),'HELLO WORLD',font=font,fill='black');draw.text((40,180),'COMIC OCR TEST',font=font,fill='black')
path=a.output/'two-lines.png';image.save(path)
row={'id':'SMOKE','file':str(path.resolve()),'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'width':768,'height':384}
(a.output/'sources.json').write_text(json.dumps([row],indent=2)+'\n')
