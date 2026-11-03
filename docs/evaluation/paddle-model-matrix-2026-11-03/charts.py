#!/usr/bin/env python3
"""用真实终态汇总与独立复评分生成公开聚合图；不读取原图、预测或全文GT。"""
import argparse
import hashlib
import html
import json
import math
from pathlib import Path
from datetime import datetime, timezone
from PIL import Image, ImageDraw, ImageFont

SIZES = ['tiny', 'small', 'medium']
ROOT = Path(__file__).resolve().parent
FOOT = '同10图 · 67个明确文字目标 / 2215字符（部分GT） · CPU1单遍非warm · 非M4'

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)

def display_label(row):
    """从正式配置生成简明中文图例，编号在结果表映射到完整scheme。"""
    c = row['configuration']
    def model(name):
        name = str(name)
        if name in SIZES:
            return 'v6 ' + name
        for suffix in ['_det','_rec']:
            if name.endswith(suffix):
                name = name[:-len(suffix)]
        return name.replace('v6_', 'v6 ').replace('v5_', 'v5 ').replace('mobile', 'mobile').replace('_', ' ')
    if c['resize_mode'] == 'native_detector_internal':
        resize = f"长边{c.get('resize_long')}适配"
    elif c['resize_mode'] == 'original':
        resize = '原Global2000/min736'
    else:
        resize = f"短边{c['short']}"
    return f"检 {model(c['det'])} / 识 {model(c['rec'])} · {resize}"

def collect(summaries, review_dirs, components_path=None):
    components = json.loads(components_path.read_text()) if components_path else None
    reviews = {}
    for folder in review_dirs:
        for path in sorted(folder.glob('*.review-summary.json')):
            item = json.loads(path.read_text())
            key = item['scheme']
            if key in reviews and reviews[key][0] != item:
                raise ValueError(f'独立评分重复且冲突: {key}')
            reviews[key] = item, path
    rows, sources, seen = [], [], set()
    for path in summaries:
        sources.append({'file': path.name, 'sha256': digest(path)})
        for run in json.loads(path.read_text()):
            key = run['scheme']
            if key in seen:
                raise ValueError(f'运行汇总重复scheme: {key}')
            seen.add(key)
            cfg = run['configuration']
            row = {'scheme': key, 'status': run['status'], 'completed_images': run['completed_images'],
                   'expected_images': run['expected_images'], 'configuration': {k: cfg.get(k) for k in
                   ['det','rec','resize_mode','short','cap','ort_intra','ort_inter','rec_batch','resize_long','stride_rounding','rec_crop_source']},
                   'raw_result_sha256': run['raw_result_sha256'],
                   'mean_seconds': run.get('mean_single_pass_seconds_completed_pages_only'),
                   'peak_rss_bytes': run.get('peak_sampled_coordinator_worker_rss_bytes'),
                   'reviewed': False, 'valid_point': False}
            if key in reviews:
                review, source = reviews[key]
                if review['prediction_sha256'] != row['raw_result_sha256']:
                    raise ValueError(f'预测SHA不匹配: {key}')
                if review['status'] != row['status'] or review['completed_images'] != row['completed_images']:
                    raise ValueError(f'完成状态不一致: {key}')
                if review['N'] != 2215:
                    raise ValueError(f'必须保留全10图GT分母2215: {key}')
                if not math.isclose(review['microCER'], sum(review[k] for k in ['S','D','I']) / review['N'], abs_tol=1e-12):
                    raise ValueError(f'CER与编辑数不一致: {key}')
                row.update({k: review[k] for k in ['microCER','microWER','S','D','I','N','exactRegions']})
                row['reviewed'] = True
                row['review_sha256'] = digest(source)
                sources.append({'file': source.name, 'sha256': digest(source)})
            row['valid_point'] = (row['reviewed'] and row['status'] == 'completed'
                                  and row['completed_images'] == row['expected_images'] == 10
                                  and number(row['mean_seconds']) and row['mean_seconds'] > 0)
            if components is not None:
                keys = [f'v6_{cfg[stage]}_{stage}' if cfg[stage] in SIZES else cfg[stage] for stage in ['det','rec']] + ['legacy_cls']
                for component in keys:
                    if component not in components:
                        raise ValueError(f'未知模型组件，不能猜体积: {key}: {component}')
                row['model_component_keys'] = keys
                row['weight_bytes'] = sum(components[k]['bytes'] for k in keys)
                row['external_dictionary_bytes'] = sum(components[k]['external_dictionary_bytes'] for k in keys)
            row['display_label'] = display_label(row)
            rows.append(row)
    if components_path:
        sources.append({'file': components_path.name, 'sha256': digest(components_path)})
    return {'schema_version': 1, 'generated_at_utc': datetime.now(timezone.utc).isoformat(timespec='seconds'), 'sources': sources, 'rows': rows}

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

def matrix(rows, field, title, unit, path):
    cells = {}
    for r in rows:
        c = r['configuration']
        if c['resize_mode'] == 'target' and c['short'] == 2048 and c['cap'] == 4096 and c['det'] in SIZES and c['rec'] in SIZES:
            k = c['det'], c['rec']
            if k in cells:
                raise ValueError(f'2048矩阵重复单元格: {k}')
            cells[k] = r
    svg = SVG(790, 520, title, '横轴：检测 det；纵轴：识别 rec。目标短边2048，长边上限4096；灰格不是零。')
    values = [r[field] for r in cells.values() if r['valid_point'] and number(r.get(field))]
    maxv = max(values, default=1) or 1
    for j, size in enumerate(SIZES):
        svg.text(242+j*174, 112, size, anchor='middle', weight='bold')
        svg.text(104, 186+j*98, size, anchor='end', weight='bold')
        for i, det in enumerate(SIZES):
            r = cells.get((det,size))
            good = r and r['valid_point'] and number(r.get(field))
            x,y = 160+i*174, 133+j*98
            value = r[field] if good else None
            t = value/maxv if good else 0
            color = f'rgb({int(224-137*t)},{int(240-91*t)},{int(245-64*t)})' if good else '#e7ebf0'
            svg.rect(x,y,164,86,color)
            label = (f'{value*100:.2f}%' if field == 'microCER' else f'{value/2**30:.2f} GiB' if field == 'peak_rss_bytes' else f'{value:.2f} 秒') if good else ('未汇总' if not r else r['status'] if r['status'] != 'completed' else '待独立评分')
            svg.text(x+82,y+40,label,18,anchor='middle',weight='bold')
            svg.text(x+82,y+65,'10/10' if good else f"{r['completed_images']}/10" if r else '无有效点',12,anchor='middle')
    svg.text(160,455,f'颜色从浅到深：数值从低到高；{unit}。仅本图共用色阶。',13)
    svg.save(path)

def resolution(rows, path):
    lookup = {r['configuration']['short']:r for r in rows if r['configuration']['det'] == r['configuration']['rec'] == 'medium' and r['configuration']['resize_mode'] == 'target'}
    svg = SVG(1000,530,'Medium分辨率：错字漏字与耗时分开看','同medium det + medium rec；横轴为请求短边，长边4096上限约束可能改变实际尺寸。')
    for panel, (field,title) in enumerate([('microCER','CER（%，越低越好）'),('mean_seconds','单遍每图均值（秒，越低越快）')]):
        left = 80+panel*480
        svg.text(left,112,title,17,weight='bold')
        vals = [r[field] * (100 if field=='microCER' else 1) for r in lookup.values() if r['valid_point']]
        top = max(vals,default=1)*1.18
        for n in range(5):
            y = 406-n*62
            svg.line(left,y,left+370,y)
            svg.text(left-10,y+5,f'{top*n/4:.1f}',12,anchor='end')
        for i,short in enumerate([1024,1536,2048,2560]):
            x = left+22+i*94
            r = lookup.get(short)
            svg.text(x+25,436,short,13,anchor='middle')
            if r and r['valid_point']:
                value = r[field]*(100 if field=='microCER' else 1)
                height = 248*value/top
                svg.rect(x,406-height,50,height,'#3e8aab')
                svg.text(x+25,396-height,f'{value:.2f}',13,anchor='middle')
            else:
                svg.text(x+25,390,'未汇总' if not r else '待审' if r['status']=='completed' else r['status'],11,anchor='middle')
    svg.text(80,475,'原Global2000/min736组不属于短边2048，另列候选表。无重复或置信区间，微小差异不等于稳健优势。',13)
    svg.save(path)

def scatter(rows,path):
    valid = [r for r in rows if r['valid_point']]
    h = max(610, 210+len(rows)*24)
    svg = SVG(1250,h,'全部已独立复核候选：CER × 单遍耗时','越靠左下，观测错误率和耗时越低；不是准确率=1−CER，也不是性能保证。')
    xmax = max([r['mean_seconds'] for r in valid],default=1)*1.12
    ymax = max([r['microCER']*100 for r in valid],default=1)*1.12
    for n in range(6):
        x,y = 85+n*102,455-n*64
        svg.line(x,135,x,455); svg.line(85,y,595,y)
        svg.text(x,479,f'{xmax*n/5:.1f}',12,anchor='middle')
        svg.text(74,y+5,f'{ymax*n/5:.1f}',12,anchor='end')
    svg.text(85,115,'CER（%）',14); svg.text(340,507,'单遍每图均值（秒）',14,anchor='middle')
    points = [(85+r['mean_seconds']/xmax*510,455-r['microCER']*100/ymax*320) for r in valid]
    label_boxes = []
    def overlaps(a,b):
        return not (a[2] < b[0] or a[0] > b[2] or a[3] < b[1] or a[1] > b[3])
    for i,r in enumerate(rows,1):
        good = r['valid_point']
        svg.text(660,124+i*24,f"{i:02d}  {r['display_label']}  {'' if good else r['status'] + ' / 无有效点'}",12)
        if good:
            x,y = 85+r['mean_seconds']/xmax*510,455-r['microCER']*100/ymax*320
            svg.circle(x,y)
            for dx,dy in ([(9,-9),(9,18),(-23,-9),(-23,18),(9,-25),(9,34),(-23,-25),(-23,34),(26,0),(-39,0)] + [(dx,dy) for dy in [-42,50,-60,68,-78,86] for dx in [9,-23,35,-49,61,-75]]):
                box=(x+dx-2,y+dy-13,x+dx+17,y+dy+3)
                if (85 <= box[0] and box[2] <= 595 and 135 <= box[1] and box[3] <= 455
                    and not any(overlaps(box,b) for b in label_boxes)
                    and not any(overlaps(box,(px-7,py-7,px+7,py+7)) for px,py in points)):
                    break
            else:
                raise ValueError(f'散点标签无法无重叠放置，请调整版式: {i}')
            label_boxes.append(box)
            if abs(dx)>23 or abs(dy)>18:
                svg.line(x,y,x+dx+7,y+dy-5,'#a7b2bd')
            svg.text(x+dx,y+dy,f'{i:02d}',11)
    svg.text(85,548,'partial/blocked/未复核结果不入散点；状态和完整GT分母仍保留在结果表。',12)
    svg.save(path)

def report(data, path):
    rows=data['rows']; complete=sum(r['valid_point'] for r in rows)
    final = data.get('experiment_complete', False)
    title = '# Paddle模型矩阵：最终实验结果' if final else '# Paddle模型矩阵：阶段性结果'
    status = '预定19组实验均已终态并通过独立评分配对；这不是软件发布声明。' if final else '这不是整个扩展评测任务的完成声明。'
    coverage = f'本轮19组全部完成10/10图且通过独立评分配对，共190次图像处理。' if final else f'此快照包含{len(rows)}个已有运行汇总，其中{complete}个完成10/10图且通过独立评分配对。未汇总不等于未运行；请结合主报告状态判断。'
    out=[title, '', f"生成时间：{data['generated_at_utc']}。{status}", '', coverage, '',
         '## 阅读范围', '', '- v6只有tiny、small、medium；v5 server为另一代，不能称为v6 large。',
         '- 同10张英文漫画，67个明确文字目标、2215个规范化字符；部分页面只标注明确目标，不是整页全文GT，也不是现代漫画总体结论。',
         '- CPU单线程设置，单遍而非warm基准；非Mac M4、非浏览器WASM实测。时间含图像解码/OCR/输出观察，不含初始化和锁等待。',
         '- RSS为约100ms同步采样的协调器+worker之和，可能重计共享页、漏短峰；不是模型文件大小或精确峰值。',
         '- CER保留标点与大小写。小数差异不提供统计显著性证据；失败页必须保留全GT分母。', '',
         '## v6检测×识别完整矩阵', '', '横轴det，纵轴rec；short2048/cap4096。所有空缺和失败均显式标记，不使用零填充。', '',
         '![CER热力图](assets/v6-cer.png)', '', '![耗时热力图](assets/v6-time.png)', '', '![RSS热力图](assets/v6-rss.png)', '',
         '## Medium分辨率', '', '![分辨率分面图](assets/medium-resolution.png)', '',
         '## 全部已汇总候选', '', '![候选CER与耗时](assets/candidates.png)', '',
         '|图例编号／候选|状态|完成图|CER（全2215字符）|WER|S/D/I|单遍均值秒¹|同步RSS GiB|权重合计MB²|外置字典字节|', '|---|---|---:|---:|---:|---:|---:|---:|---:|---:|']
    for i,r in enumerate(rows,1):
        quality = f"{r['microCER']*100:.2f}%" if r['reviewed'] else '待独立评分'
        wer = f"{r['microWER']*100:.2f}%" if r['reviewed'] else '待独立评分'
        edits = f"{r['S']}/{r['D']}/{r['I']}" if r['reviewed'] else '—'
        time = f"{r['mean_seconds']:.3f}" if number(r['mean_seconds']) else '—'
        rss = f"{r['peak_rss_bytes']/2**30:.3f}" if number(r['peak_rss_bytes']) else '—'
        weight = f"{r['weight_bytes']/1_000_000:.3f}" if 'weight_bytes' in r else '未提供'
        dictionary = r.get('external_dictionary_bytes', '未提供')
        out.append(f"|{i:02d} · {r['scheme']}|{r['status']}|{r['completed_images']}/{r['expected_images']}|{quality}|{wer}|{edits}|{time}|{rss}|{weight}|{dictionary}|")
    out += ['', 'native960是长边960适配：采用官方检测缩放参数（内部长边960/ceil128）、原图识别裁剪与共同Rapid/classifier桥接，并非完整官方PaddleX端到端，不属于共同short2048/cap4096组；全部候选图展示不同配置的观测取舍，不能将跨配置差异只归因于模型。', '', '¹ partial的时间如有，只针对成功返回页面，不可与完整10图时间作为同质量结果比较。partial/blocked不进入散点或热力图有效数值。', '',
            '² 权重合计为本次实际det＋rec＋固定legacy_cls文件字节之和，十进制MB=1,000,000字节；外置字典另列，已嵌入字典不重复计算。不含runtime、其他配置或缓存。数据来自[实际模型组件清单](data/model-components.json)，不能与MODELS.md的官方参考导出大小混用，也不是RSS。', '', '## 来源与复现', '', '图表由[charts.py](charts.py)从运行聚合与独立复核聚合自动生成。[公开白名单数据](assets/chart-data.json)保留输入文件哈希及聚合指标，不含原图、全文GT或全文预测。', '',
            '运行示例（私有目录路径按实际环境替换）：', '',
            '```sh', ('python3 charts.py --run-summary PRIVATE_V6/summary-no-gt.json --run-summary PRIVATE_EXPANDED/server-summary-no-gt.json --run-summary PRIVATE_EXPANDED/language-summary-no-gt.json --review-dir PRIVATE_V6/independent-review --review-dir PRIVATE_EXPANDED/independent-review --complete' if final else 'python3 charts.py --run-summary PRIVATE/summary-no-gt.json --review-dir PRIVATE/independent-review'), '```', '',
            '生成PNG需要Python、Pillow及脚本指定路径的Noto Sans CJK字体；SVG同时保留。--model-components默认读取本目录data/model-components.json。', '', '可重复传入两种参数以加入后续阶段。脚本拒绝SHA不匹配、状态冲突、重复scheme及非2215字符分母；仅completed且10/10且复核完成的候选进入有效点。', '']
    path.write_text('\n'.join(out))

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run-summary',type=Path,action='append',required=True)
    parser.add_argument('--review-dir',type=Path,action='append',required=True)
    parser.add_argument('--output',type=Path,default=ROOT)
    parser.add_argument('--complete',action='store_true',help='声明预定19组完整实验，严格要求19/19全部复核有效')
    parser.add_argument('--model-components',type=Path,default=ROOT/'data'/'model-components.json')
    args=parser.parse_args()
    data=collect(args.run_summary,args.review_dir,args.model_components)
    if args.complete and (len(data['rows']) != 19 or not all(r['valid_point'] for r in data['rows'])):
        parser.error('--complete要求预定19组全部完成10/10图且通过独立复核')
    data['experiment_complete'] = args.complete
    assets=args.output/'assets'; assets.mkdir(parents=True,exist_ok=True)
    (assets/'chart-data.json').write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
    for field,name,title,unit in [('microCER','cer','v6矩阵：字符错误率CER','越低越好'),('mean_seconds','time','v6矩阵：单遍每图平均耗时','越低越快'),('peak_rss_bytes','rss','v6矩阵：同步采样RSS','GiB，越低占用越少')]:
        matrix(data['rows'],field,title,unit,assets/f'v6-{name}.svg')
    resolution(data['rows'],assets/'medium-resolution.svg')
    scatter(data['rows'],assets/'candidates.svg')
    report(data,args.output/'RESULTS.md')
    print(f"Generated {len(data['rows'])} aggregate rows, {sum(r['valid_point'] for r in data['rows'])} valid points")

if __name__=='__main__':
    main()
