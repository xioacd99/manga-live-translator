#!/usr/bin/env python3
"""仅用聚合数据绘制Paddle图表，不读取图像、完整转写或执行推理。"""
import argparse
import json
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.font_manager import FontProperties

ROOT = Path(__file__).resolve().parent
p = argparse.ArgumentParser()
p.add_argument('--summary', type=Path, default=ROOT / 'data/paddle-summary.json')
p.add_argument('--output', type=Path, default=ROOT / 'assets')
p.add_argument('--font', default='/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc')
a = p.parse_args()
rows = json.loads(a.summary.read_text())
assert [r['group'] for r in rows] == list('ABCD')
a.output.mkdir(parents=True, exist_ok=True)
font = FontProperties(fname=a.font)
plt.rcParams.update({'font.family': font.get_name(), 'axes.spines.top': False,
                     'axes.spines.right': False, 'figure.facecolor': '#f7f9fc',
                     'axes.facecolor': '#f7f9fc', 'font.size': 11})
# 显式注册字体，不依赖fontconfig缓存。
from matplotlib import font_manager
font_manager.fontManager.addfont(a.font)
colors = ['#64748b', '#4983bd', '#178777', '#a06bb2']
labels = [f"{r['group']}\n{r['workers']}进程\nORT {r['ort_intra']}线程\nbatch={r['rec_batch']}" for r in rows]
footer = 'Linux 云 CPU · 固定 10 页 · 每组 3 轮 · 暖均值取后 2 轮；非 Apple M4 / 浏览器实测'

def base(title, panels=1):
    fig, axs = plt.subplots(1, panels, figsize=(13, 5.8), squeeze=False)
    fig.suptitle(title, fontsize=19, fontweight='bold', y=.96)
    fig.text(.5,.025,footer,ha='center',fontsize=10,color='#475569')
    fig.subplots_adjust(left=.08,right=.97,top=.79,bottom=.20,wspace=.25)
    return fig, axs[0]

def bars(ax, vals, unit, digits=3, ranges=None):
    ax.bar(range(4),vals,color=colors,width=.6)
    ax.set_xticks(range(4),labels)
    ceiling = max(hi for lo,hi in ranges) if ranges else max(vals)
    ax.set_ylim(0,ceiling*1.23)
    ax.set_ylabel(unit)
    ax.set_axisbelow(True)
    ax.grid(axis='y',alpha=.18)
    for i,v in enumerate(vals):
        ax.text(i,(ranges[i][1] if ranges else v)+ceiling*.035,f'{v:.{digits}f}',ha='center',fontsize=12)
    if ranges:
        ax.errorbar(range(4),vals,yerr=[[v-lo for v,(lo,hi) in zip(vals,ranges)],
                                      [hi-v for v,(lo,hi) in zip(vals,ranges)]],
                    fmt='none',ecolor='#172033',capsize=5)

fig, axes=base('整批更快，不代表首个结果更快',2)
for ax,key,title,field in zip(axes,['warm_mean_batch_seconds','warm_mean_first_result_seconds'],
        ['10 页整批完成时间（暖均值）','首个结果到达时间（暖均值）'],
        ['makespan_seconds','first_result_received_seconds']):
    vals=[r[key] for r in rows]
    ranges=[(min(x[field] for x in r['rounds'][1:]),max(x[field] for x in r['rounds'][1:])) for r in rows]
    bars(ax,vals,'秒，越低越好',ranges=ranges)
    ax.set_title(title+'\n细线为两暖轮实际范围，非置信区间',fontsize=12)
fig.savefig(a.output/'paddle-latency.png',dpi=160)
plt.close(fig)
fig, axes=base('双进程提高整批吞吐，也占用更多内存')
bars(axes[0],[r['peak_sampled_tree_rss_bytes']/1e9 for r in rows],'采样进程树峰值 RSS（GB，十进制）')
axes[0].set_title('三轮内同步采样求和的最大值；100 ms 采样可能漏峰，共享页可能重复计数',fontsize=11)
fig.savefig(a.output/'paddle-memory.png',dpi=160)
plt.close(fig)
fig, axes=base('质量差异很小，但 rec_batch 不是纯性能开关')
bars(axes[0],[r['CER_by_round'][0]*100 for r in rows],'CER（%，越低越好）',digits=5)
axes[0].set_title('纵轴从 0 起；A：404 次编辑，B/C/D：403 次编辑；每轮分母均为 2215 字符',fontsize=11)
fig.savefig(a.output/'paddle-quality.png',dpi=160)
plt.close(fig)
# 保存作图的准确数值与口径，不包含OCR正文。
chart_data={'source':'../data/paddle-summary.json','memory_unit':'decimal GB',
 'latency':'mean of rounds 1 and 2; range is min/max, not confidence interval',
 'rows':[{k:r[k] for k in ['group','workers','ort_intra','rec_batch','warm_mean_batch_seconds',
 'warm_mean_first_result_seconds','warm_aggregate_images_per_second','peak_sampled_tree_rss_bytes',
 'CER_by_round','WER_by_round','S_by_round','D_by_round','I_by_round','N_per_round']} for r in rows]}
(a.output/'paddle-chart-data.json').write_text(json.dumps(chart_data,ensure_ascii=False,indent=2)+'\n')
