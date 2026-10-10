"""SQLite: sessions, turns, traces, facts, retrievals. 每次操作开一个连接，线程安全靠 sqlite 自己。"""
import json, os, sqlite3, threading
from datetime import datetime, timezone
from pathlib import Path

DB = Path(os.environ.get('MINISTERS_DB', Path.home() / '.ministers' / 'court.db'))
_lock = threading.Lock()  # ponytail: 全局写锁，单机一位皇帝够用；多实例再换 Postgres

SCHEMA = """
CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, topic TEXT, context TEXT, lang TEXT,
  status TEXT, verdict TEXT, lean REAL DEFAULT 0, created_at TEXT, ended_at TEXT);
CREATE TABLE IF NOT EXISTS turns (id INTEGER PRIMARY KEY, session_id TEXT, seq INTEGER, minister TEXT,
  kind TEXT, stance TEXT, influence REAL, text TEXT, target TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS traces (id INTEGER PRIMARY KEY, session_id TEXT, turn_id INTEGER, op TEXT,
  minister TEXT, model TEXT, prompt_tokens INTEGER, completion_tokens INTEGER, cost_usd REAL,
  latency_ms INTEGER, ok INTEGER, fallback INTEGER, error TEXT, request TEXT, response TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS facts (id INTEGER PRIMARY KEY, session_id TEXT, text TEXT, source TEXT,
  vectorizer TEXT, vec TEXT);
CREATE TABLE IF NOT EXISTS retrievals (id INTEGER PRIMARY KEY, session_id TEXT, turn_id INTEGER,
  minister TEXT, query TEXT, vectorizer TEXT, corpus INTEGER, hits TEXT, top_score REAL,
  cited INTEGER, latency_ms INTEGER, created_at TEXT);
CREATE INDEX IF NOT EXISTS turns_s ON turns(session_id, seq);
CREATE INDEX IF NOT EXISTS traces_s ON traces(session_id);
"""


def now():
    return datetime.now(timezone.utc).isoformat(timespec='seconds')


def conn():
    c = sqlite3.connect(DB, timeout=10)
    c.row_factory = sqlite3.Row
    return c


def init():
    DB.parent.mkdir(parents=True, exist_ok=True)
    with conn() as c:
        c.execute('PRAGMA journal_mode=WAL')
        c.executescript(SCHEMA)


def q(sql, args=()):
    with conn() as c:
        return [dict(r) for r in c.execute(sql, args)]


def insert(table, **row):
    with _lock, conn() as c:
        cur = c.execute(f'INSERT INTO {table} ({",".join(row)}) VALUES ({",".join("?" * len(row))})',
                        list(row.values()))
        return cur.lastrowid


def update(table, id, **row):
    with _lock, conn() as c:
        c.execute(f'UPDATE {table} SET {",".join(k + "=?" for k in row)} WHERE id=?', [*row.values(), id])


def add_turn(sid, minister, kind, stance, influence, text, target=None):
    with _lock, conn() as c:
        seq = c.execute('SELECT COALESCE(MAX(seq),0)+1 FROM turns WHERE session_id=?', (sid,)).fetchone()[0]
        c.execute('INSERT INTO turns (session_id,seq,minister,kind,stance,influence,text,target,created_at) '
                  'VALUES (?,?,?,?,?,?,?,?,?)', (sid, seq, minister, kind, stance, influence, text, target, now()))
    return seq


def turns(sid, after=0):
    return q('SELECT * FROM turns WHERE session_id=? AND seq>? ORDER BY seq', (sid, after))


def session(sid):
    r = q('SELECT * FROM sessions WHERE id=?', (sid,))
    return r[0] if r else None


def ministers(sid):
    """当前立场 = 每位大臣最后一次发言时的立场。没有状态表，查出来的就是真相。"""
    return q("""SELECT t.minister AS id, t.stance, t.influence FROM turns t
                JOIN (SELECT minister, MAX(seq) s FROM turns WHERE session_id=? AND minister!='emperor'
                      GROUP BY minister) m ON m.minister=t.minister AND m.s=t.seq
                WHERE t.session_id=?""", (sid, sid))


def sessions():
    return q("""SELECT s.*, (SELECT COUNT(*) FROM turns WHERE session_id=s.id) turns,
                (SELECT COUNT(*) FROM traces WHERE session_id=s.id) calls,
                (SELECT COALESCE(SUM(cost_usd),0) FROM traces WHERE session_id=s.id) cost_usd
                FROM sessions s ORDER BY created_at DESC""")


def detail(sid):
    s = session(sid)
    if not s:
        return None
    rs = q('SELECT * FROM retrievals WHERE session_id=? ORDER BY id', (sid,))
    for r in rs:
        r['hits'] = json.loads(r['hits'])
    return {**s, 'turns': turns(sid), 'retrievals': rs,
            'traces': q('SELECT * FROM traces WHERE session_id=? ORDER BY id DESC', (sid,))}


def count_traces(sid, op):
    return q('SELECT COUNT(*) n FROM traces WHERE session_id=? AND op=?', (sid, op))[0]['n']


def stats():
    t = q("""SELECT COUNT(*) calls, COALESCE(SUM(prompt_tokens),0) prompt_tokens,
             COALESCE(SUM(completion_tokens),0) completion_tokens, COALESCE(SUM(cost_usd),0) cost_usd,
             COALESCE(AVG(latency_ms),0) avg_latency_ms, COALESCE(SUM(1-ok),0) errors,
             COALESCE(SUM(fallback),0) fallbacks FROM traces""")[0]
    lat = [r['latency_ms'] for r in q('SELECT latency_ms FROM traces ORDER BY latency_ms')]
    rag = q("""SELECT COUNT(*) searches, COALESCE(SUM(top_score>0),0) with_hits,
               COALESCE(AVG(top_score),0) avg_top_score, COALESCE(AVG(latency_ms),0) avg_latency_ms,
               COALESCE(SUM(json_array_length(hits)),0) retrieved, COALESCE(SUM(cited),0) cited
               FROM retrievals""")[0]
    rag['avg_top_score'] = round(rag['avg_top_score'], 4)
    rag['facts'] = q('SELECT COUNT(*) n FROM facts')[0]['n']
    rag['vectorizers'] = q('SELECT vectorizer, COUNT(*) n FROM facts GROUP BY vectorizer')
    return {**t, 'sessions': q('SELECT COUNT(*) n FROM sessions')[0]['n'],
            'by_op': q("""SELECT op, COUNT(*) calls, AVG(latency_ms) avg_latency_ms,
                          SUM(cost_usd) cost_usd, SUM(1-ok) errors FROM traces GROUP BY op ORDER BY calls DESC"""),
            'p95_latency_ms': lat[int(len(lat) * .95)] if lat else 0, 'rag': rag}
