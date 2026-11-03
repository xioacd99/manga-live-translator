#!/usr/bin/env python3
"""从独立复核后的聚合数据绘图，不读取漫画、预测全文或GT。"""
import argparse
import html
import json
import math
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

FOOT = '固定10图 / 2215字符（部分GT） · 云CPU1单遍 · 非M4 · 反复使用验证集存在选择偏差'

class SVG:
    def __init__(self, width, height, title, subtitle):
        self.width, self.height = width, height
        self.image = Image.new("RGB", (width*2, height*2), "#f7f9fc")
        self.draw = ImageDraw.Draw(self.image)
        self.parts = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}" role="img">',
                      f'<title>{html.escape(title)}</title>', '<rect width="100%" height="100%" fill="#f7f9fc"/>',
                      '<g font-family="Noto Sans CJK SC, Microsoft YaHei, sans-serif" fill="#132338">']
        self.text(32, 36, title, 23, weight='bold')
        self.text(32, 66, subtitle, 13)
    def text(self, x, y, text, size=15, anchor='start', weight='normal', fill=None):
        font = ImageFont.truetype('/usr/share/fonts/opentype/noto/NotoSansCJK-' + ('Bold' if weight == 'bold' else 'Regular') + '.ttc', size*2)
        self.draw.text((x*2,y*2), str(text), font=font, fill=fill or '#132338', anchor={'start':'ls','middle':'ms','end':'rs'}[anchor])
        self.parts.append(f'<text x="{x}" y="{y}" font-size="{size}" text-anchor="{anchor}" font-weight="{weight}"'+ (f' fill="{fill}"' if fill else '') + f'>{html.escape(str(text))}</text>')
    def rect(self, x, y, w, h, fill, stroke='none'):
        self.draw.rounded_rectangle((x*2,y*2,(x+w)*2,(y+h)*2), radius=10, fill=fill, outline=None if stroke=='none' else stroke)
        self.parts.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="5" fill="{fill}" stroke="{stroke}"/>')
    def line(self, x1, y1, x2, y2, color='#cad4df'):
        self.draw.line((x1*2,y1*2,x2*2,y2*2), fill=color, width=2)
        self.parts.append(f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{color}"/>')
    def circle(self,x,y):
        self.draw.ellipse(((x-6)*2,(y-6)*2,(x+6)*2,(y+6)*2), fill='#217c9e',outline='white',width=2)
        self.parts.append(f'<circle cx="{x}" cy="{y}" r="6" fill="#217c9e" stroke="white"/>')
    def save(self, path):
        self.text(32, self.height-18, FOOT, 12)
        path.write_text('\n'.join(self.parts + ['</g></svg>']))
        self.image.save(path.with_suffix('.png'))

def validate(rows):
    """保持完整分母，失败不伪装为零误差。"""
    seen=set()
    for r in rows:
        if r['scheme'] in seen:
            raise ValueError('重复方案')
        seen.add(r['scheme'])
        if r['N'] != 2215:
            raise ValueError('字符分母必须保留2215')
        if any(not isinstance(r[k], int) or isinstance(r[k], bool) or r[k] < 0 for k in ['S','D','I']):
            raise ValueError('错误计数必须非负整数')
        if not math.isclose(r['CER'],sum(r[k] for k in ['S','D','I'])/r['N'],abs_tol=1e-12):
            raise ValueError('CER与编辑数不符')
        if r['status']=='completed' and r['completed_images'] != 10:
            raise ValueError('完成状态与图数不符')
        if r.get('mean_seconds') is not None and (not math.isfinite(r['mean_seconds']) or r['mean_seconds'] <= 0):
            raise ValueError('时延无效')


def bars(rows,path,field,title,unit):
    """零起点统一横轴，不把缺失值当作零。"""
    values=[r[field] for r in rows if r['status']=='completed' and r.get(field) is not None]
    factor=100 if field=='CER' else 1
    scale=max(values,default=1)*factor*1.15 or 1
    plot=SVG(1050,190+len(rows)*82,title,'同一固定验证集；模型和预处理不同，不代表对新漫画或用户设备的保证。')
    for i in range(6):
        x=300+i*124
        plot.line(x,105,x,115+len(rows)*82)
        plot.text(x,130+len(rows)*82,f'{scale*i/5:.1f}',12,anchor='middle')
    for i,r in enumerate(rows):
        y=115+i*82
        plot.text(32,y+24,r['label'],15,weight='bold')
        if r['status']=='completed' and r.get(field) is not None:
            value=r[field]*factor
            plot.rect(300,y,620*value/scale,35,'#217c9e' if i else '#74869b')
            plot.text(308+620*value/scale,y+25,f'{value:.2f}{unit}',14)
        else:
            plot.text(310,y+24,r['status']+'，不当作零',14)
        plot.text(32,y+48,r.get('note',''),11)
    plot.save(path)


def errors(rows,path):
    plot=SVG(1050,190+len(rows)*82,'错字、删除、插入分解','删除不是纯检测漏检；同样的CER可能有不同错误组成。')
    maximum=max(sum(r[k] for k in ['S','D','I']) for r in rows)*1.1 or 1
    colors={'S':'#246c9c','D':'#d08b31','I':'#8a65a1'}
    for i,r in enumerate(rows):
        y=112+i*82;plot.text(32,y+24,r['label'],15,weight='bold');x=300
        for k in ['S','D','I']:
            w=r[k]/maximum*620
            if w: plot.rect(x,y,w,35,colors[k])
            x+=w
        plot.text(300,y+55,f"S={r['S']}　D={r['D']}　I={r['I']}　N={r['N']}",13)
    plot.text(300,83,'蓝：替换S　橙：删除D　紫：插入I',13)
    plot.save(path)

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args();data=json.loads(args.data.read_text());rows=data['rows'];validate(rows)
    args.output.mkdir(parents=True,exist_ok=True)
    bars(rows,args.output/'quality.svg','CER','字符错误率CER：越低越好','%')
    bars(rows,args.output/'time.svg','mean_seconds','单遍整页OCR耗时：不含下载和初始化','秒')
    errors(rows,args.output/'errors.svg')
