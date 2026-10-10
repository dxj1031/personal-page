"""The Ministers 后端。

    python app.py               # 起服务 :8010，同时挂 ministers/ 静态页
    python app.py --export      # 把库导出成 ../snapshot.json，给 GitHub Pages 上的 console 用
"""
import asyncio, json, os, sys, time
from collections import defaultdict, deque
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

import court, store

HERE = Path(__file__).parent
store.init()
app = FastAPI(title='The Ministers')
# 页面在 GitHub Pages、后端在别处时要跨域；只放行自己的域名
app.add_middleware(CORSMiddleware, allow_methods=['GET', 'POST'], allow_headers=['Content-Type'],
                   allow_origins=os.environ.get('MINISTERS_ORIGINS', 'https://dxj1031.github.io').split(','))


class Petition(BaseModel):
    topic: str = Field(min_length=1, max_length=200)
    context: str = Field('', max_length=1000)
    lang: str = Field('en', pattern='^(zh|en)$')


class Ruling(BaseModel):
    choice: str


class Decree(BaseModel):
    kind: str = Field(max_length=20)
    text: str = Field('', max_length=120)


def must(sid):
    if not store.session(sid):
        raise HTTPException(404, 'no such court')


@app.get('/api/health')
def health():
    return {'ok': True, 'db': 'sqlite'}  # 不把本机路径（含用户名）暴露到公网


# 后端跑在自己电脑上、经隧道公开：限住并发和单个访客的频率，别让人把显卡刷爆
MAX_LIVE, PER_HOUR = 2, 5
_seen = defaultdict(deque)


@app.post('/api/court')
def open_court(p: Petition, req: Request):  # 同步路由跑在线程池里，开场那次十几秒的模型调用不堵事件循环
    ip = req.headers.get('cf-connecting-ip') or req.client.host
    hits, now = _seen[ip], time.time()
    while hits and now - hits[0] > 3600:
        hits.popleft()
    if len(hits) >= PER_HOUR:
        raise HTTPException(429, 'Too many courts this hour. Try again later.')
    if len(court._running) >= MAX_LIVE:
        raise HTTPException(429, 'The court is full right now. Try again in a minute.')
    hits.append(now)
    return court.open_court(p.topic.strip(), p.context.strip(), p.lang)


@app.get('/api/court/{sid}')
def get_court(sid: str):
    must(sid)
    return court.state(sid)


@app.get('/api/court/{sid}/stream')
async def stream(sid: str, after: int = 0):
    must(sid)

    async def events():
        seq = after
        while True:
            new = store.turns(sid, seq)
            for t in new:
                seq = t['seq']
                yield f'event: turn\ndata: {json.dumps(t, ensure_ascii=False)}\n\n'
            if new:
                yield f'event: state\ndata: {json.dumps(court.state(sid), ensure_ascii=False)}\n\n'
            if store.session(sid)['status'] != 'debating' and not store.turns(sid, seq):
                yield 'event: done\ndata: {}\n\n'
                return
            await asyncio.sleep(.5)  # ponytail: 轮询库，单机够快；要多实例再换 pub/sub

    return StreamingResponse(events(), media_type='text/event-stream', headers={'Cache-Control': 'no-cache'})


@app.post('/api/court/{sid}/decree')
def decree(sid: str, d: Decree):
    must(sid)
    court.decree(sid, d.kind, d.text)
    return court.state(sid)


@app.post('/api/court/{sid}/verdict')
def verdict(sid: str, r: Ruling):
    must(sid)
    try:
        return court.rule(sid, r.choice)
    except ValueError as e:
        raise HTTPException(422, str(e))


@app.get('/api/stats')
def stats():
    return store.stats()


@app.get('/api/sessions')
def sessions():
    return store.sessions()


@app.get('/api/sessions/{sid}')
def session_detail(sid: str):
    must(sid)
    return store.detail(sid)


def export():
    ss = store.sessions()
    snap = {'exported_at': store.now(), 'health': {'ok': True, 'db': 'snapshot'}, 'stats': store.stats(),
            'sessions': ss, 'detail': {s['id']: store.detail(s['id']) for s in ss}}
    (HERE.parent / 'snapshot.json').write_text(json.dumps(snap, ensure_ascii=False, indent=1), encoding='utf-8')
    print(f'{len(ss)} sessions -> {HERE.parent / "snapshot.json"}')


app.mount('/', StaticFiles(directory=HERE.parent, html=True), name='static')  # 必须最后挂，否则吞掉 /api

if __name__ == '__main__':
    if '--export' in sys.argv:
        export()
    else:
        import uvicorn
        uvicorn.run(app, host=os.environ.get('HOST', '127.0.0.1'), port=int(os.environ.get('PORT', 8010)))
