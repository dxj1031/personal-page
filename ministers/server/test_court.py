"""python test_court.py — 模型不可达时，一整场朝会也得跑完。不需要 Ollama。"""
import os, tempfile, time

os.environ['MINISTERS_DB'] = os.path.join(tempfile.mkdtemp(), 't.db')
os.environ['OLLAMA_URL'] = 'http://127.0.0.1:9'  # 没人监听的端口
os.environ['MINISTERS_TIMEOUT'] = '1'
import court, store

store.init()

# 模型给什么怪形状都不该炸
assert court.parse_speak({'clash': ['a', 'b'], 'lobby': 'hi', 'cites': ['x', 1]}) == \
    {'clash': {}, 'lobby': 'hi', 'reply': '', 'cites': [1]}
assert court.parse_speak(None)['clash'] == {}

st = court.open_court('Should I adopt a second cat?', 'The flat is 40 square meters. The old cat is grumpy.', 'en')
assert len(st['turns']) == 11 and st['tally']['pro'] >= 3 and st['tally']['con'] >= 3
court.decree(st['id'], 'banana', '')
for _ in range(200):
    if store.session(st['id'])['status'] == 'recess':
        break
    time.sleep(.05)
assert store.session(st['id'])['status'] == 'recess'
kinds = [t['kind'] for t in store.turns(st['id'])]
assert 'rebuttal' in kinds and 'lobby' in kinds and 'decree' in kinds

end = court.rule(st['id'], 'shelve')
assert end['status'] == 'decided' and end['turns'][-1]['kind'] == 'verdict'
d = store.detail(st['id'])
assert d['traces'] and all(t['fallback'] or t['op'] == 'embed' for t in d['traces'])
assert d['retrievals'] and d['retrievals'][0]['vectorizer'] == 'hashing'
assert store.stats()['sessions'] == 1
print('ok:', len(kinds), 'turns,', len(d['traces']), 'traces, all fell back cleanly')
