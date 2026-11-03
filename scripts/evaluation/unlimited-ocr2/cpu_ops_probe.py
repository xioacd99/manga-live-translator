"""仅测试官方 MLX CPU 基础算子，所有测量等待计算完成。"""
import os,time,json
os.sched_setaffinity(0, sorted(os.sched_getaffinity(0))[:4])
import mlx.core as mx
mx.set_default_device(mx.cpu)
import mlx_vlm
print(json.dumps({'device':str(mx.default_device()),'mlx_vlm':mlx_vlm.__version__,'affinity':sorted(os.sched_getaffinity(0)),'omp':os.getenv('OMP_NUM_THREADS'),'blas':os.getenv('OPENBLAS_NUM_THREADS'),'num_threads_api':[n for n in dir(mx) if 'thread' in n]}),flush=True)
def check(name,fn):
 t=time.perf_counter();y=fn();mx.eval(y);mx.synchronize();print(json.dumps({'op':name,'shape':list(y.shape),'dtype':str(y.dtype),'seconds':time.perf_counter()-t,'sample':float(y.reshape(-1)[0])}),flush=True)
check('bf16_conv2d',lambda:mx.conv2d(mx.ones((1,4,4,3),dtype=mx.bfloat16),mx.ones((2,2,2,3),dtype=mx.bfloat16)))
q=mx.ones((1,2,8,8),dtype=mx.bfloat16)
check('bf16_sdpa',lambda:mx.fast.scaled_dot_product_attention(q,q,q,scale=0.125))
f=mx.compile(lambda a:a*2)
check('cpu_compile',lambda:f(mx.array([1.,2.])))
w=mx.ones((64,64),dtype=mx.bfloat16);qw,s,b=mx.quantize(w,group_size=64,bits=4)
check('bf16_4bit_matmul',lambda:mx.quantized_matmul(mx.ones((1,64),dtype=mx.bfloat16),qw,s,b,transpose=True,group_size=64,bits=4))
