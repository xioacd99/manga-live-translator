"""本地整页 Spotting 复现入口，仅参数化文件位置，保持冻结推理参数。
公开版本不是原实验脚本的逐字副本；差异与原始哈希见 provenance.json。
本脚本只访问回环推理服务，不下载素材，不读取标注，不上传图片。
"""
from pathlib import Path
import argparse, json, subprocess, time, fcntl, psutil, base64, urllib.request, threading, socket, hashlib, platform, datetime
from PIL import Image
from parse_spotting import parse_spotting
cli = argparse.ArgumentParser(description='固定参数的十图本地 Spotting 单遍复现；不自动下载')
cli.add_argument('--manifest', type=Path, required=True, help='十图来源清单；相对图片路径按清单所在目录解析')
cli.add_argument('--models', type=Path, required=True, help='已核验的原始模型与修正后 mmproj 所在目录')
cli.add_argument('--runtime', type=Path, required=True, help='包含 llama-server 的官方运行时目录')
cli.add_argument('--output', type=Path, required=True, help='新的本地输出目录；已有协议文件时拒绝覆盖')
cli.add_argument('--lock', type=Path, required=True, help='与其他重计算任务共同使用的互斥锁文件')
args = cli.parse_args()
root = args.output.resolve()
runtime = args.runtime.resolve()
models = args.models.resolve()
sources_path = args.manifest.resolve()
lock = str(args.lock.resolve())
root.mkdir(parents=True, exist_ok=True)
for directory in ['inputs', 'raw', 'logs', 'metadata']:
    (root / directory).mkdir(exist_ok=True)
Path(lock).parent.mkdir(parents=True, exist_ok=True)
port = 18087
base = f'http://127.0.0.1:{port}'

def sha(path):
    with Path(path).open('rb') as f:
        return hashlib.file_digest(f, 'sha256').hexdigest()

def write(path, obj):
    p = root / path
    tmp = p.with_suffix(p.suffix + '.tmp')
    tmp.write_text(json.dumps(obj, indent=2, ensure_ascii=False))
    tmp.replace(p)
sources = json.loads(sources_path.read_text())
assert len(sources) == 10 and [x['id'] for x in sources] == [f'EN{i:02}' for i in range(1, 11)]
protocol = {'frozen_at_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'scheme': 'paddleocr_vl_1_6_bf16_spotting_fullpage_cpu4_onepass', 'sources_file': str(sources_path), 'sources_sha256': sha(sources_path), 'order': [x['id'] for x in sources], 'runtime_commit': '8642541b255bfb5dc39cd351a178be09013a55d6', 'runtime_release': 'v0.8.0 / b11960', 'model_revision': '511b09642bb324401f15f97cc23bc67e8f0a291d', 'model_sha256': 'f3ae46ec885050acf4b3d31944431e1fd90d50664fb09126af4a3c050ba14ee8', 'original_mmproj_sha256': '204d757d7610d9b3faab10d506d69e5b244e32bf765e2bab2d0167e65e0a058a', 'spotting_mmproj_sha256': '8e011479092c5e82c8c1c2d85d52b9ac48df12183c5c7bc3190190732259db09', 'vision_min_pixels': 112896, 'vision_max_pixels': 1605632, 'cpu_inference_threads': 4, 'cpu_batch_threads': 4, 'comparison_caveat': 'Old baseline CPU1 versus this CPU4; no directly equal-thread latency claim', 'context_tokens': 8192, 'max_output_tokens': 4096, 'temperature': 0, 'top_k': 1, 'repeat_penalty': 1.0, 'seed': 0, 'prompt': 'Spotting:', 'special_tokens': True, 'gpu_layers': 0, 'mmproj_offload': False, 'batch_size': 256, 'ubatch_size': 256, 'parallel': 1, 'model_warmup': False, 'cache_prompt': False, 'image_preprocessing': 'Open source image with Pillow RGB; if width<1500 AND height<1500, enlarge each dimension exactly 2x Lanczos; otherwise preserve dimensions; encode PNG. llama.cpp applies model dynamic min/max pixels. No crops, tiling, rotation, contrast filters or image-specific tuning.', 'coordinate_mapping': '8 LOC tokens in 0..1000 => four x,y pairs; scale x by original width/1000 and y by original height/1000', 'parser_sha256': sha(Path(__file__).with_name('parse_spotting.py')), 'runner_sha256': sha(__file__), 'gt_policy': 'No GT files read. Prior prediction file inspected only for schema keys/types, not values. No quality scoring here.', 'timing_policy': 'One ordered pass, each distinct image once. Report server startup separately. EN01 first request after load; EN02..EN10 reuse loaded model but are NOT repeated-page warm trials. Explicitly no three-run warm mean.', 'failure_policy': 'One request per image, no retries/parameter changes. Preserve full raw response. Non-stop finish or parse failure yields empty valid predictions and explicit error. No inferred/repaired text or coordinates. Continue other images unless runtime fails.', 'per_request_timeout_seconds': 900, 'endpoint': base + '/v1/chat/completions', 'network_policy': 'Only loopback client with proxies disabled, inline local PNG data; no model downloads or external inference in runner', 'lock': lock, 'output_location': str(root)}
assert not (root / 'protocol.json').exists(), 'Protocol already frozen; do not silently rerun/overwrite'
write('protocol.json', protocol)
write('metadata/sources-manifest.json', sources)
inputs = []
for s in sources:
    f = Path(s['file'])
    f = f if f.is_absolute() else sources_path.parent / f
    assert sha(f) == s['sha256'], s['id'] + ' source hash mismatch'
    with Image.open(f) as im:
        im = im.convert('RGB')
        assert im.size == (s['width'], s['height'])
        if im.width < 1500 and im.height < 1500:
            im = im.resize((im.width * 2, im.height * 2), Image.Resampling.LANCZOS)
        dest = root / 'inputs' / (s['id'] + '.png')
        im.save(dest)
        inputs.append({'id': s['id'], 'path': str(dest), 'width': im.width, 'height': im.height, 'sha256': sha(dest), 'bytes': dest.stat().st_size})
write('metadata/preprocessed-inputs.json', inputs)
for path, expected in [('PaddleOCR-VL-1.6-GGUF.gguf', protocol['model_sha256']), ('PaddleOCR-VL-1.6-GGUF-mmproj-spotting.gguf', protocol['spotting_mmproj_sha256'])]:
    assert sha(models / path) == expected
cmd = [str(runtime / 'llama-server'), '-m', str(models / 'PaddleOCR-VL-1.6-GGUF.gguf'), '--mmproj', str(models / 'PaddleOCR-VL-1.6-GGUF-mmproj-spotting.gguf'), '--host', '127.0.0.1', '--port', str(port), '--no-webui', '--cors-origins', 'localhost', '--special', '--no-warmup', '--ctx-size', '8192', '--n-predict', '4096', '--temp', '0', '--seed', '0', '--repeat-penalty', '1.0', '--top-k', '1', '--n-gpu-layers', '0', '--no-mmproj-offload', '--threads', '4', '--threads-batch', '4', '--batch-size', '256', '--ubatch-size', '256', '--parallel', '1', '--cache-ram', '0']
write('metadata/server-command.json', cmd)
client = urllib.request.build_opener(urllib.request.ProxyHandler({}))
with socket.socket() as s:
    s.bind(('127.0.0.1', port))
predictions = {'scheme': protocol['scheme'], 'images': [], 'model_selection': protocol, 'environment': {'platform': platform.platform(), 'python': platform.python_version(), 'logical_cpus': psutil.cpu_count(), 'memory_total_bytes': psutil.virtual_memory().total}, 'manifest_sha256': protocol['sources_sha256'], 'timing_scope': protocol['timing_policy']}
metrics = {'peak_rss_bytes_sampled': 0, 'per_image': [], 'startup_seconds': None, 'server_stopped': False}
current = {'id': None, 'peak_rss': 0}
stopped = threading.Event()
p = None
print('PROTOCOL FROZEN', sha(root / 'protocol.json'), 'RUNNER', protocol['runner_sha256'], flush=True)
print('WAITING shared inference lock', flush=True)
with open(lock, 'a') as lf:
    fcntl.flock(lf, fcntl.LOCK_EX)
    print('LOCK ACQUIRED; starting server', flush=True)
    start = time.monotonic()
    try:
        log = (root / 'logs/server.log').open('wb')
        p = subprocess.Popen(cmd, stdout=log, stderr=log, cwd=root)
        proc = psutil.Process(p.pid)

        def sample():
            while not stopped.is_set():
                try:
                    rss = proc.memory_info().rss
                    metrics['peak_rss_bytes_sampled'] = max(metrics['peak_rss_bytes_sampled'], rss)
                    current['peak_rss'] = max(current['peak_rss'], rss)
                except psutil.NoSuchProcess:
                    break
                stopped.wait(0.05)
        sampler = threading.Thread(target=sample, daemon=True)
        sampler.start()
        while True:
            if p.poll() is not None:
                raise RuntimeError('Server exited before ready ' + str(p.returncode))
            try:
                with client.open(base + '/health', timeout=1) as r:
                    health = json.load(r)
                if health['status'] == 'ok':
                    break
            except (urllib.error.URLError, TimeoutError, ConnectionError):
                pass
            if time.monotonic() - start > 120:
                raise RuntimeError('Server startup timeout')
            time.sleep(0.1)
        metrics['startup_seconds'] = time.monotonic() - start
        print('SERVER READY', metrics['startup_seconds'], 'seconds', flush=True)
        with client.open(base + '/v1/models', timeout=10) as r:
            write('metadata/server-models.json', json.load(r))
        for index, (s, inp) in enumerate(zip(sources, inputs)):
            if p.poll() is not None:
                raise RuntimeError('Server unexpectedly terminated')
            sid = s['id']
            current.update({'id': sid, 'peak_rss': 0})
            stage_start = time.monotonic()
            print('START', sid, 'input', inp['width'], inp['height'], flush=True)
            image = Path(inp['path']).read_bytes()
            payload = {'messages': [{'role': 'user', 'content': [{'type': 'image_url', 'image_url': {'url': 'data:image/png;base64,' + base64.b64encode(image).decode()}}, {'type': 'text', 'text': 'Spotting:'}]}], 'max_tokens': 4096, 'temperature': 0, 'top_k': 1, 'seed': 0, 'repeat_penalty': 1.0, 'stream': False, 'cache_prompt': False}
            req = urllib.request.Request(base + '/v1/chat/completions', data=json.dumps(payload).encode(), headers={'Content-Type': 'application/json'})
            regions = []
            err = None
            result = None
            content = None
            request_started = time.monotonic()
            finish = None
            try:
                with client.open(req, timeout=900) as r:
                    raw = r.read()
                (root / 'raw' / (sid + '-response.json')).write_bytes(raw)
                result = json.loads(raw)
                content = result['choices'][0]['message']['content']
                finish = result['choices'][0].get('finish_reason')
                (root / 'raw' / (sid + '-content.txt')).write_text(content)
                if finish != 'stop':
                    raise ValueError('Incomplete generation: finish_reason=' + str(finish))
                parsed = parse_spotting(content, s['width'], s['height'])
                for r in parsed:
                    x1, y1, x2, y2 = r['bbox']
                    regions.append({'bbox': {'x': x1, 'y': y1, 'width': x2 - x1, 'height': y2 - y1}, 'quad': r['polygon'], 'text': r['text'], 'confidence': None, 'normalizedCoordinates': r['normalized_coordinates']})
            except Exception as exc:
                err = type(exc).__name__ + ': ' + str(exc)
                print('IMAGE ERROR', sid, err, flush=True)
            request_seconds = time.monotonic() - request_started
            per = {'id': sid, 'sequence': index + 1, 'request_wall_seconds': request_seconds, 'input_preparation_plus_request_wall_seconds': time.monotonic() - stage_start, 'peak_server_rss_bytes_sampled': current['peak_rss'], 'finish_reason': finish, 'truncated': finish == 'length', 'usage': result.get('usage') if result else None, 'api_timings': result.get('timings') if result else None, 'region_count': len(regions), 'error': err, 'repeated_warm_runs': 0}
            image_result = {'id': sid, 'sha256': s['sha256'], 'width': s['width'], 'height': s['height'], 'regions': regions, 'detectorRegions': [], 'rawBeforeFiltering': [], 'diagnostics': {'spotting_region_count': len(regions), 'has_independent_detector': False, 'has_confidence_scores': False, 'finish_reason': finish, 'truncated': finish == 'length', 'raw_response_file': str(root / 'raw' / (sid + '-response.json')), 'raw_content_file': str(root / 'raw' / (sid + '-content.txt')), 'input': inp}, 'runs': [{'run': 1, 'wall_seconds': request_seconds, 'regions': regions, 'finish_reason': finish}], 'timing': {'first_pass_seconds': request_seconds, 'warm_seconds': [], 'warm_mean_seconds': None}, 'error': err}
            predictions['images'].append(image_result)
            metrics['per_image'].append(per)
            write('predictions.json', predictions)
            write('metrics.json', metrics)
            print('DONE', sid, json.dumps(per), flush=True)
        metrics['completed_images'] = len(predictions['images'])
        metrics['successful_images'] = sum((x['error'] is None for x in predictions['images']))
    finally:
        if p is not None and p.poll() is None:
            p.terminate()
            try:
                p.wait(timeout=10)
            except subprocess.TimeoutExpired:
                p.kill()
                p.wait(timeout=5)
        stopped.set()
        metrics['total_lock_held_wall_seconds'] = time.monotonic() - start
        metrics['server_stopped'] = p is not None and p.poll() is not None
        write('metrics.json', metrics)
        write('predictions.json', predictions)
        print('FINAL', json.dumps(metrics), flush=True)
