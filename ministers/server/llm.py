"""所有模型调用的唯一入口。绕过这里的调用在 console 上就是隐形的。"""
import json, os, time, urllib.request

import store

OLLAMA = os.environ.get('OLLAMA_URL', 'http://127.0.0.1:11434')
MODEL = os.environ.get('MINISTERS_MODEL', 'qwen2.5:14b')
EMBED_MODEL = os.environ.get('MINISTERS_EMBED', 'bge-m3')
TIMEOUT = float(os.environ.get('MINISTERS_TIMEOUT', 60))


def _post(path, body):
    req = urllib.request.Request(OLLAMA + path, json.dumps(body).encode(), {'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
        return json.loads(r.read())


def _trace(sid, op, minister, model, t0, request, response='', ok=1, fallback=0, error=None, pt=0, ct=0):
    store.insert('traces', session_id=sid, op=op, minister=minister, model=model, prompt_tokens=pt,
                 completion_tokens=ct, cost_usd=0.0, latency_ms=int((time.time() - t0) * 1000), ok=ok,
                 fallback=fallback, error=error, request=request, response=response, created_at=store.now())


def complete_json(sid, op, messages, minister=None):
    """返回解析好的 dict；模型挂了或 JSON 坏了返回 None，调用方负责兜底。失败也记一行。"""
    t0, req = time.time(), json.dumps(messages, ensure_ascii=False)
    try:
        r = _post('/api/chat', {'model': MODEL, 'messages': messages, 'format': 'json', 'stream': False,
                                'options': {'temperature': 0.9}})
    except Exception as e:
        _trace(sid, op, minister, MODEL, t0, req, ok=0, fallback=1, error=repr(e)[:500])
        return None
    out = r.get('message', {}).get('content', '')
    pt, ct = r.get('prompt_eval_count', 0), r.get('eval_count', 0)
    try:
        data = json.loads(out)
    except ValueError as e:
        _trace(sid, op + '_parse', minister, MODEL, t0, req, out, ok=0, fallback=1, error=str(e), pt=pt, ct=ct)
        return None
    _trace(sid, op, minister, MODEL, t0, req, out, pt=pt, ct=ct)
    return data


def embed(sid, texts):
    """bge-m3 向量；失败返回 None，调用方退到哈希向量。"""
    t0 = time.time()
    try:
        r = _post('/api/embed', {'model': EMBED_MODEL, 'input': texts})
        _trace(sid, 'embed', None, EMBED_MODEL, t0, json.dumps(texts, ensure_ascii=False),
               f'{len(r["embeddings"])} vectors', pt=r.get('prompt_eval_count', 0))
        return r['embeddings']
    except Exception as e:
        _trace(sid, 'embed', None, EMBED_MODEL, t0, json.dumps(texts, ensure_ascii=False), ok=0, error=repr(e)[:500])
        return None
