"""仅用公开数值生成图表，不读取漫画原图、GT或完整识别文字。"""
import argparse,json,importlib.util
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--repo',type=Path,required=True);p.add_argument('--report',type=Path,required=True);a=p.parse_args()
sp=importlib.util.spec_from_file_location('chart',a.repo/'scripts/evaluation/multilingual/chart.py');c=importlib.util.module_from_spec(sp);sp.loader.exec_module(c)
import matplotlib.pyplot as plt
r=a.report;data=r/'data';assets=r/'assets';assets.mkdir(exist_ok=True)
res=json.loads((data/'resolution-summary.json').read_text());vl=json.loads((data/'vl.metrics.json').read_text());hy=json.loads((data/'hybrid.metrics.json').read_text())
prior={d['scheme']:d for d in json.loads((data/'previous-model-summary.json').read_text())}
rows=[{'label':'原small参数组','value':prior['v6_small_paddle_params']['CER']*100},{'label':'原medium','value':prior['v6_medium']['CER']*100}]+[{'label':f"small 短边{d['target_short']}",'value':d['CER']*100} for d in res]+[{'label':'VL整页（含2页失败）','value':vl['microCER']*100},{'label':'VL失败回退（离线探索）','value':hy['microCER']*100}]
spec={'rows':rows,'title':'字符错误率：保留失败页，越低越好','unit':'%','subtitle':'同10图、2215参考字符；部分标注历史英文漫画\n最后一项是故障驱动的离线组合，不是已集成系统'}
(assets/'quality.json').write_text(json.dumps(spec,ensure_ascii=False,indent=2));c.bars(rows,spec['title'],'%',spec['subtitle'],assets/'quality.png')
fig,ax=plt.subplots(figsize=(9,5),dpi=160);xs=[d['warm_mean_seconds'] for d in res];ys=[d['CER']*100 for d in res];ax.plot(xs,ys,'o-',color='#2563eb',linewidth=2)
for x,y,d in zip(xs,ys,res):ax.annotate(str(d['target_short']), (x,y),xytext=(7,8),textcoords='offset points')
ax.set_xlim(left=0,right=max(xs)*1.2);ax.set_ylim(0,max(ys)*1.3);ax.set_xlabel('后两遍暖调用均值（秒/图）',fontproperties=c.FONT);ax.set_ylabel('CER（%）',fontproperties=c.FONT);ax.set_title('仅改分辨率：同模型、同CPU1；左下更好\n统一长边上限4096，目标短边未必全部达到',fontproperties=c.FONT);ax.grid(alpha=.2);fig.tight_layout();fig.savefig(assets/'resolution-tradeoff.png');plt.close(fig)
(assets/'resolution-tradeoff.json').write_text(json.dumps([{'target':d['target_short'],'warm_seconds':d['warm_mean_seconds'],'CER_percent':d['CER']*100} for d in res],indent=2))
valid=json.loads((data/'vl.success-subset.metrics.json').read_text());base=json.loads((data/'fixed_small_params.success-subset.metrics.json').read_text())
fig,axes=plt.subplots(1,2,figsize=(11,4.3),dpi=160);ax=axes[0];vals=[8,2];bars=ax.bar(['stop','length'],vals,color=['#15803d','#dc2626']);ax.set_ylim(0,10);ax.set_title('10页：8页交付，2页循环后截断',fontproperties=c.FONT);ax.set_ylabel('页数',fontproperties=c.FONT)
for b,v in zip(bars,vals):ax.text(b.get_x()+b.get_width()/2,v+.15,str(v),ha='center')
ax=axes[1];vals=[base['microCER']*100,valid['microCER']*100];bars=ax.bar(['small params','VL1.6'],vals,color=['#64748b','#2563eb']);ax.set_ylim(0,max(vals)*1.25);ax.set_ylabel('CER（%）',fontproperties=c.FONT);ax.set_title('仅同8个成功页：有质量信号\n事后成功子集，不代表全10页',fontproperties=c.FONT)
for b,v in zip(bars,vals):ax.text(b.get_x()+b.get_width()/2,v+.3,f'{v:.2f}%',ha='center')
fig.tight_layout();fig.savefig(assets/'vl-outcomes.png');plt.close(fig)
(assets/'vl-outcomes.json').write_text(json.dumps({'normal_stop_pages':8,'failed_pages':2,'same_success_subset_reference_characters':valid['N'],'baseline_CER':base['microCER'],'VL_CER':valid['microCER']},indent=2))
metrics=[json.loads((data/f"resolution-{d['target_short']}.metrics.json").read_text()) for d in res]+[vl,hy];labels=[f"短边{d['target_short']}" for d in res]+['VL整页','离线失败回退'];values=[[im['CER']*100 for im in d['images']] for d in metrics]
fig,ax=plt.subplots(figsize=(12,5),dpi=160);im=ax.imshow(values,cmap='YlOrRd',vmin=0,vmax=max(100,max(max(v) for v in values)),aspect='auto')
for y,row in enumerate(values):
 for x,v in enumerate(row):ax.text(x,y,f'{v:.1f}',ha='center',va='center',fontsize=9)
ax.set_xticks(range(10),[f'EN{i:02}' for i in range(1,11)]);ax.set_yticks(range(len(labels)),labels,fontproperties=c.FONT);ax.set_title('逐图CER：完整展示改善、退步和服务失败',fontproperties=c.FONT,pad=15);fig.colorbar(im,ax=ax,label='CER (%)');fig.tight_layout();fig.savefig(assets/'per-image.png');plt.close(fig)
(assets/'per-image.json').write_text(json.dumps({'rows':labels,'CER_percent':values},ensure_ascii=False,indent=2))
