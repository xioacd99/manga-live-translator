"""仅从正式评分JSON画图，不载入漫画原图或完整参考文本。"""
import argparse,json,importlib.util
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--repo',type=Path,required=True);p.add_argument('--summary',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args()
rows=json.loads(a.summary.read_text());assert len(rows)==7
labels={'v5_multi_legacy':'v5多语 · 原运行库','v5_multi_bridge':'v5多语 · 新运行库','v5_english':'v5英语专用','v6_tiny':'v6 tiny','v6_small':'v6 small','v6_medium':'v6 medium','v6_small_paddle_params':'v6 small · 检测参数对照'}
order=list(labels); rows=sorted(rows,key=lambda r:order.index(r['scheme']));a.output.mkdir(parents=True,exist_ok=True)
sp=importlib.util.spec_from_file_location('chart',a.repo/'scripts/evaluation/multilingual/chart.py');c=importlib.util.module_from_spec(sp);sp.loader.exec_module(c)
for key,title,unit,scale in [('CER','英文漫画字符错误率：越低越好','%',100),('mean_warm_seconds','本轮云CPU暖调用：越低越快','秒',1),('model_bytes','活跃权重总大小：含方向分类器','MB',1e-6)]:
 spec={'rows':[{'label':labels[r['scheme']],'value':r[key]*scale} for r in rows],'title':title,'unit':unit,'subtitle':'同10张历史英文漫画 · 同冻结GT · 7方案本轮重跑\n部分标注子集；云CPU不是浏览器或Mac M4'+('；MB=1,000,000字节' if key=='model_bytes' else '')}
 (a.output/(key+'.json')).write_text(json.dumps(spec,ensure_ascii=False,indent=2));c.bars(spec['rows'],title,unit,spec['subtitle'],a.output/(key+'.png'))
import matplotlib.pyplot as plt,numpy as np
values=[]
for r in rows:
 m=json.loads((a.summary.parent/(r['scheme']+'.metrics.json')).read_text());values.append([im['CER']*100 for im in m['images']])
fig,ax=plt.subplots(figsize=(12,5),dpi=160);image=ax.imshow(values,cmap='YlOrRd',vmin=0,vmax=max(100,max(max(r) for r in values)),aspect='auto')
for y,row in enumerate(values):
 for x,v in enumerate(row):ax.text(x,y,f'{v:.1f}',ha='center',va='center',fontsize=9,color='black')
ax.set_xticks(range(10),[f'EN{i:02}' for i in range(1,11)]);ax.set_yticks(range(7),[labels[r['scheme']] for r in rows],fontproperties=c.FONT)
ax.set_title('逐图CER（%）：保留所有固定样本，不只展示平均值',fontproperties=c.FONT,pad=18);fig.colorbar(image,ax=ax,label='CER (%)');fig.tight_layout();fig.savefig(a.output/'per-image-CER.png',bbox_inches='tight');plt.close(fig)
(a.output/'per-image-CER.json').write_text(json.dumps({'schemes':[r['scheme'] for r in rows],'ids':[f'EN{i:02}' for i in range(1,11)],'CER_percent':values},indent=2))
