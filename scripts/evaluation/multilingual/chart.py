"""只绘制已核验数值；无样本图片或 OCR 全文。"""
import json, argparse
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.font_manager import FontProperties
FONT = FontProperties(fname='/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc')
COLORS=['#146c94','#76a5b4','#d4a64f','#bd7061','#8d80b8','#7d8c59']
def bars(rows,title,unit,subtitle,out):
    fig,ax=plt.subplots(figsize=(10, max(3.6,len(rows)*.56+1.5)),dpi=160)
    fig.patch.set_facecolor('#f7f9fb');ax.set_facecolor('#f7f9fb')
    values=[r['value'] for r in rows]; labels=[r['label'] for r in rows]
    maximum=max([v for v in values if v is not None] or [1]);width=max(maximum,1)*1.25
    for i,(v,label) in enumerate(zip(values,labels)):
        if v is None:ax.text(0,i,'未评估',fontproperties=FONT,color='#667085',va='center')
        else:
            ax.barh(i,v,color=COLORS[i%len(COLORS)],height=.56)
            ax.text(v+width*.018,i,f'{v:.2f}{unit}',fontproperties=FONT,va='center',fontsize=11)
    ax.set_yticks(range(len(rows)),labels,fontproperties=FONT,fontsize=11)
    ax.invert_yaxis();ax.set_xlim(0,width);ax.tick_params(axis='both',length=0)
    ax.grid(axis='x',color='#dbe1e7',linewidth=.7);ax.set_axisbelow(True)
    for s in ax.spines.values():s.set_visible(False)
    fig.suptitle(title,fontproperties=FONT,fontsize=17,x=.05,ha='left',y=.98)
    fig.text(.05,.015,subtitle,fontproperties=FONT,fontsize=9,color='#475467')
    fig.tight_layout(rect=[0,.08,1,.93]);Path(out).parent.mkdir(parents=True,exist_ok=True)
    fig.savefig(out,bbox_inches='tight');plt.close(fig)
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('spec');p.add_argument('output');a=p.parse_args();d=json.loads(Path(a.spec).read_text());bars(d['rows'],d['title'],d['unit'],d['subtitle'],a.output)
