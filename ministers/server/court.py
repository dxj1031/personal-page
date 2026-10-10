"""朝会引擎。规则在代码里：谁对呛、谁游说谁、倒不倒戈、何时死锁，全由这里算完；模型只填台词。"""
import hashlib, json, math, random, re, threading, time, uuid

import llm, store

# id: (中文名, 基础影响力, 易被游说度, 人设, 说话风格, 兜底口头禅 zh, en)
ROSTER = {
    'fox':     ('维斯帕', 1.2, .6, '风险规避。永远先看最坏情况，把不确定性说成必然的灾难。', '阴沉、预言灾祸、爱用『此事必有蹊跷』这类句式。', '三思！三思！再三思！', 'THINK! THINK AGAIN!'),
    'rabbit':  ('跺脚将军', 1.0, .7, '行动偏好。讨厌拖延，认为拖着本身就是最大的成本。', '急、短句、跺脚、喊『现在就办』。', '现在！立刻！马上！', 'NOW! THIS INSTANT!'),
    'horse':   ('奔骥', 1.0, .6, '竞争与荣誉。只在乎赢不赢、丢不丢人，不在乎划不划算。', '高亢、爱比较、把事情说成一场比赛。', '跑起来再想！', 'RUN FIRST, THINK LATER!'),
    'collie':  ('枫律', 1.1, .5, '规则与成本。找条款漏洞、找更省的绕路方案，讨厌浪费。', '条理清楚、爱引用规矩、爱报数字。', '第42条，白纸黑字！', 'CLAUSE 42, IN INK!'),
    'raccoon': ('拾荒', .9, .5, '旧账与承诺。翻历史记录，用过去的言行反驳现在的决定。', '翻账本、报日期、阴阳怪气地提醒『您上次说过』。', '你去年说的话，我都记着。', 'I REMEMBER EVERYTHING.'),
    'snake':   ('西利斯', .8, .8, '神秘主义。用预兆和征象判断吉凶，拒绝给明确结论。', '拖长音、说半句、留下模棱两可的谶语。', '嘶——卦已成。', 'SSS — THE HEXAGRAM IS CAST.'),
    'fish':    ('咕噜', .7, 1.2, '信息流焦虑。刚刷到的东西就是全部证据，情绪随热搜摆动。', '语速快、碎片化、动不动『我刚看到』。', '完了完了全完了！', 'DOOM. DOOM. DOOM.'),
    'sheep':   ('伍尔西', .6, 1.6, '从众。没有独立立场，谁人多就靠向谁，被游说时最容易倒戈。', '犹豫、附和、句尾发虚。', '大家跳我也跳……', 'IF EVERYONE JUMPS, I JUMP…'),
    'moth':    ('结茧', .9, .2, '确认偏误。先有结论再找资料，只引用支持自己的证据。', '优雅、引经据典、把片面材料说得像铁证。', '茧里啥都知道。', 'THE COCOON KNOWS ALL.'),
    'banana':  ('香蕉', .6, 1.0, '脑洞。提出跑题但偶尔一针见血的第三条路。', '跳脱、不合逻辑、突然抛出一个荒诞方案。', '香蕉滑一个！', 'BANANA SLIP!'),
    'octopus': ('章鱼宰相', 1.0, .9, '人情优先。先算得罪谁、欠谁人情，再算事情本身。', '圆滑、和稀泥、八条腿各按住一个人。', '八只手都同意～', 'ALL EIGHT HANDS AGREE~'),
}
# 兜底开局立场：模型不在时也能开堂，且满足至少 3 pro / 3 con
DEFAULT_STANCE = {'fox': 'con', 'rabbit': 'pro', 'horse': 'pro', 'collie': 'con', 'raccoon': 'con', 'snake': 'undecided',
                  'fish': 'pro', 'sheep': 'undecided', 'moth': 'pro', 'banana': 'undecided', 'octopus': 'con'}
MAX_ROUNDS, CALM_ROUNDS = 6, 2  # 最多六回合；连续两回合没人倒戈也没人未定 = 死锁退朝
VERDICT_ZH = {'approve': '准奏（准他去做）', 'reject': '驳回（不许做）', 'shelve': '搁置（以后再议）', 'adjourn': '退朝（今天不议了）'}
VERDICT_EN = {'approve': 'APPROVED (the petitioner may do it)', 'reject': 'REJECTED (the petitioner may not)',
              'shelve': 'SHELVED (decide later)', 'adjourn': 'ADJOURNED (court rises, nothing decided)'}
DECREE_TEXT = {'silence': ('💥 朕说：都给朕闭嘴！', '💥 SILENCE IN COURT!'),
               'swap': ('🖌 换将，下一对！', '🖌 NEXT DUELISTS!'),
               'banana': ('🍌 天降香蕉。', '🍌 A BANANA FALLS FROM THE SKY.')}

_running = {}  # sid -> threading.Event（置位 = 停止辩论）


# 英文局要整套英文 prompt：中文指令里夹一句 "write in English"，qwen 照样回中文
PERSONA_EN = {
    'fox': 'Risk-averse. Always sees the worst case and calls every uncertainty a certain disaster. Gloomy, prophetic, loves "something is amiss here".',
    'rabbit': 'Bias for action. Hates delay; thinks waiting is the biggest cost. Frantic, short sentences, stamps, shouts "do it NOW".',
    'horse': 'Competition and pride. Only cares about winning and not losing face. Loud, compares everything, turns it all into a race.',
    'collie': 'Rules and cost. Hunts loopholes and cheaper workarounds, hates waste. Orderly, cites clauses, quotes numbers.',
    'raccoon': "Old ledgers and promises. Digs up past words to attack today's choice. Reads dates from the ledger, sneers \"you said last time...\".",
    'snake': 'Mysticism. Judges by omens, never gives a clear answer. Drawls, trails off, speaks in ambiguous prophecy.',
    'fish': 'Feed anxiety. Whatever it just scrolled past is all the evidence. Fast, fragmented, always "I just saw...".',
    'sheep': 'Herd follower. No view of its own, leans to the majority, flips most easily. Hesitant, agreeable, trails off.',
    'moth': 'Confirmation bias. Decides first, then cites only the evidence that agrees. Elegant, quotes sources, makes one-sided facts sound ironclad.',
    'banana': 'Wild ideas. Proposes off-topic third options that are sometimes spot on. Jumpy, illogical, blurts absurd plans.',
    'octopus': 'Favors and relationships. First counts whom it offends and who owes whom, then the issue. Smooth, fence-sitting, one tentacle on everyone.',
}
P = {
    'zh': dict(
        none='（无）', silenced='无（皇帝喝止，本回合不许对呛）',
        roster=lambda: '\n'.join(f'{k}（{v[0]}）：{v[3]} 说话风格：{v[4]}' for k, v in ROSTER.items()),
        stance_sys='你是一场荒诞朝堂喜剧的编剧。十一位动物大臣要就皇帝的议题各自站队。\n'
            '每位大臣必须严格按自己的偏见发言，绝不能说出别的大臣才会说的话。\n每句开场白 25 字以内，要有角色口癖，不要客套。\n所有台词用中文。',
        stance_user='议题：{topic}\n背景：{context}\n\n大臣名册：\n{roster}\n\n'
            '返回 JSON：{{"ministers":{{"大臣id":{{"stance":"pro|con|undecided","text":"开场白"}}, ...}}}}，'
            '十一位全部要有。至少 3 位 pro、至少 3 位 con。',
        speak_sys='你是荒诞朝堂喜剧的编剧。给定当前立场，写一回合冲突：\n'
            '两位大臣正面对呛各一句（25 字内），然后一位大臣游说另一位（30 字内），被游说者回一句。\n'
            '被游说者是否倒戈，由我给的 flip 结果决定，你只负责写台词，不要改判。\n'
            '每个 text 都必须是那位大臣张口说出来的原话：第一人称，不加人名前缀，不写旁白或动作描述。\n'
            '反例（不许这样写）：「章鱼宰相游说结茧：……」「结茧被说服倒戈了」。\n所有台词用中文。',
        speak_user='议题：{topic}\n背景：{context}\n当前立场：{stances}\n\n刚才朝堂上说过的话（要接得上，不要重复）：\n'
            '{history}{decrees}{library}\n\n大臣名册：\n{roster}\n\n对呛双方：{who}\n游说：{lobby}\n'
            '返回 JSON：{{"clash":[{{"minister":"id","text":"…"}},{{"minister":"id","text":"…"}}],'
            '"lobby":{{"text":"…","reply":"…"}},"cites":[]}}',
        lobby='{a} 游说 {b}，flip={flip}', flip=('倒戈', '不倒戈'),
        decree='\n皇帝刚下旨：{text}（大臣们得有反应）',
        library='\n蝴蝶文库（结茧发言前检索到的事实，编号从 0 开始）：\n{facts}\n'
            '结茧立场是 {stance}，她只引用支持自己立场的条目；在 cites 里列出她真正引用的编号，没有就给 []。',
        verdict_sys='你是荒诞朝堂喜剧的编剧。用两句话写一段圣旨判词，古腔今用，不超过 50 字。\n判词必须宣布朕给的裁决，哪怕票型相反——朕说了算，可以顺带挖苦输掉的一方。所有台词用中文。',
        verdict_user='议题：{topic}\n朕的裁决：{choice}\n朝堂票型：赞成 {pro}、反对 {con}、未定 {undecided}\n返回 JSON：{{"edict":"判词"}}',
        choice=VERDICT_ZH,
    ),
    'en': dict(
        none='(none)', silenced='none (the emperor silenced the court; no clash this round)',
        roster=lambda: '\n'.join(f'{k}: {PERSONA_EN[k]}' for k in ROSTER),
        stance_sys="You write an absurd royal-court comedy. Eleven animal ministers take sides on the emperor's question.\n"
            'Each minister speaks strictly from their own bias and never says what another minister would say.\n'
            'Each opening line is under 20 words, in character, no pleasantries. Write in English.',
        stance_user='Question: {topic}\nBackground: {context}\n\nMinisters:\n{roster}\n\n'
            'Return JSON: {{"ministers":{{"minister_id":{{"stance":"pro|con|undecided","text":"opening line"}}, ...}}}} '
            'for all eleven. At least 3 pro and at least 3 con. Every text in English.',
        speak_sys='You write an absurd royal-court comedy. Given the current stances, write one round of conflict:\n'
            'two ministers clash with one line each (under 18 words), then one minister lobbies another (under 22 words) '
            'and the target replies.\nWhether the target defects is decided by the flip I give you; only write the lines.\n'
            "Every text is the minister's own spoken words: first person, no name prefix, no narration or stage directions.\n"
            'Write in English.',
        speak_user='Question: {topic}\nBackground: {context}\nCurrent stances: {stances}\n\n'
            'Just said in court (follow on, do not repeat):\n{history}{decrees}{library}\n\nMinisters:\n{roster}\n\n'
            'Clash: {who}\nLobbying: {lobby}\n'
            'Return JSON: {{"clash":[{{"minister":"id","text":"…"}},{{"minister":"id","text":"…"}}],'
            '"lobby":{{"text":"…","reply":"…"}},"cites":[]}}. Every text in English.',
        lobby='{a} lobbies {b}, flip={flip}', flip=('defects', 'holds firm'),
        decree='\nThe emperor just decreed: {text} (the ministers must react)',
        library='\nCocoon Library (facts moth retrieved before speaking, numbered from 0):\n{facts}\n'
            "Moth's stance is {stance}; she cites only the entries that support it. "
            'List the numbers she actually cites in "cites", or [].',
        verdict_sys='You write an absurd royal-court comedy. Write a two-sentence royal edict in mock-archaic English, under 35 words.\n'
            'The edict MUST announce exactly the ruling I give, even if the tally disagrees: the emperor overrules the court '
            'and may mock the losing side.',
        verdict_user='Question: {topic}\nMy ruling: {choice}\nCourt tally: pro {pro}, con {con}, undecided {undecided}\n'
            'Return JSON: {{"edict":"…"}} in English.',
        choice=VERDICT_EN,
    ),
}


def fallback_line(m, lang):
    return ROSTER[m][5] if lang == 'zh' else ROSTER[m][6]


def state(sid):
    s = store.session(sid)
    ms = store.ministers(sid)
    tally = {'pro': 0, 'con': 0, 'undecided': 0}
    for m in ms:
        tally[m['stance']] += 1
    return {**s, 'ministers': ms, 'tally': tally, 'turns': store.turns(sid)}


# ---------------- 蝴蝶文库（moth 的 RAG） ----------------

def split_facts(text):
    return [x.strip() for x in re.split(r'[。！？!?；;\n]|\.\s', text or '') if len(x.strip()) >= 4]


def hash_vec(text, dim=512):
    """字符 2/3-gram 哈希向量，没有 embedding 模型时的本地退路。"""
    v = [0.0] * dim
    for n in (2, 3):
        for i in range(len(text) - n + 1):
            h = int(hashlib.md5(text[i:i + n].encode()).hexdigest(), 16)
            v[h % dim] += 1 if (h >> 9) & 1 else -1
    return v


def cos(a, b):
    na, nb = math.sqrt(sum(x * x for x in a)), math.sqrt(sum(x * x for x in b))
    return sum(x * y for x, y in zip(a, b)) / (na * nb) if na and nb else 0.0


def build_library(sid, topic, context):
    facts = split_facts(context)
    if not facts:
        return
    vecs, vz = llm.embed(sid, facts), llm.EMBED_MODEL
    if vecs is None:
        vecs, vz = [hash_vec(f) for f in facts], 'hashing'
    for f, v in zip(facts, vecs):
        store.insert('facts', session_id=sid, text=f, source='petition', vectorizer=vz, vec=json.dumps(v))


def retrieve(sid, query, k=3, floor=0.2):
    t0 = time.time()
    facts = store.q('SELECT id, text, source, vectorizer, vec FROM facts WHERE session_id=?', (sid,))
    vz = facts[0]['vectorizer'] if facts else None
    qv = None
    if facts and vz != 'hashing':
        e = llm.embed(sid, [query])
        qv = e[0] if e else None
    if facts and qv is None:  # 库是哈希向量，或者查询时 embedding 掉线：整库按哈希重算，保证同一把尺子
        qv, vz = hash_vec(query), 'hashing'
        for f in facts:
            f['vec'] = json.dumps(hash_vec(f['text']))
    hits = sorted(({'fact_id': f['id'], 'score': round(cos(qv, json.loads(f['vec'])), 4), 'text': f['text'],
                    'source': f['source']} for f in facts), key=lambda h: -h['score'])
    hits = [h for h in hits if h['score'] >= floor][:k]
    rid = store.insert('retrievals', session_id=sid, minister='moth', query=query, vectorizer=vz, corpus=len(facts),
                       hits=json.dumps(hits, ensure_ascii=False), top_score=hits[0]['score'] if hits else 0,
                       cited=0, latency_ms=int((time.time() - t0) * 1000), created_at=store.now())
    return rid, hits


# ---------------- 开堂 ----------------

def open_court(topic, context, lang):
    sid = uuid.uuid4().hex[:12]
    store.insert('sessions', id=sid, topic=topic, context=context, lang=lang, status='debating', lean=0.0,
                 created_at=store.now())
    build_library(sid, topic, context)
    L = P[lang]
    data = llm.complete_json(sid, 'stance', [
        {'role': 'system', 'content': L['stance_sys']},
        {'role': 'user', 'content': L['stance_user'].format(topic=topic, context=context or L['none'], roster=L['roster']())}])
    got = (data or {}).get('ministers') if isinstance(data, dict) else None
    got = got if isinstance(got, dict) else {}
    stances = {m: got[m].get('stance') if isinstance(got.get(m), dict) else None for m in ROSTER}
    ok = all(s in ('pro', 'con', 'undecided') for s in stances.values())
    if not ok or sum(s == 'pro' for s in stances.values()) < 3 or sum(s == 'con' for s in stances.values()) < 3:
        stances = dict(DEFAULT_STANCE)  # 规则不满足就整盘换兜底，别让模型决定玩法
    for m, (_, inf, *_) in ROSTER.items():
        g = got.get(m) if isinstance(got.get(m), dict) else {}
        store.add_turn(sid, m, 'opening', stances[m], inf, text(g.get('text')) or fallback_line(m, lang))
    stop = threading.Event()
    _running[sid] = stop
    threading.Thread(target=debate, args=(sid, stop), daemon=True).start()
    return state(sid)


# ---------------- 辩论 ----------------

def pick_round(ms, used, swap):
    """对呛：两边各出影响力最高、最近没上过台的；游说：强势一方说服未定者或对面最弱者。"""
    by = {st: sorted([m for m in ms if m['stance'] == st], key=lambda m: -m['influence']) for st in ('pro', 'con')}
    def lead(st):
        fresh = [m for m in by[st] if m['id'] not in used] or by[st]
        return fresh[min(swap, len(fresh) - 1)] if fresh else None
    a, b = lead('pro'), lead('con')
    power = {st: sum(m['influence'] for m in by[st]) for st in by}
    strong = 'pro' if power['pro'] >= power['con'] else 'con'
    weak = 'con' if strong == 'pro' else 'pro'
    targets = [m for m in ms if m['stance'] == 'undecided'] or sorted(by[weak], key=lambda m: m['influence'])[:2]
    if not by[strong] or not targets:
        return a, b, None, None
    lobbyer = random.choice(by[strong][:3])
    return a, b, lobbyer, random.choice(targets)


def flips(lobbyer, target):
    """倒戈概率 = 游说者影响力占比 × 被游说者易感度。抽签在代码里，不交给模型。"""
    p = lobbyer['influence'] / (lobbyer['influence'] + target['influence']) * ROSTER[target['id']][2]
    return random.random() < min(p, .9)


def debate(sid, stop):
    s = store.session(sid)
    lang, calm, used, last_decree = s['lang'], 0, set(), 0
    try:
        for rnd in range(MAX_ROUNDS):
            if stop.is_set():
                return
            ms = {m['id']: m for m in store.ministers(sid)}
            decrees = [t for t in store.turns(sid, last_decree) if t['kind'] == 'decree']
            if decrees:
                last_decree = decrees[-1]['seq']
            kinds = {d['target'] for d in decrees}  # decree 的 target 字段存的是圣旨类型
            if 'banana' in kinds:  # 天降香蕉：香蕉当场换边
                b = ms['banana']
                b['stance'] = random.choice([x for x in ('pro', 'con', 'undecided') if x != b['stance']])
                store.add_turn(sid, 'banana', 'rebuttal', b['stance'], b['influence'], fallback_line('banana', lang))
            a, b, lobbyer, target = pick_round(list(ms.values()), used, 1 if 'swap' in kinds else 0)
            if 'silence' in kinds:
                a = b = None  # 皇帝喝止：本回合没有对呛，只有私下游说
            if a: used.add(a['id'])
            if b: used.add(b['id'])
            if len(used) >= len(ms) - 1:
                used.clear()
            flip = bool(lobbyer and flips(lobbyer, target))
            hits = []
            if 'moth' in ((a or {}).get('id'), (b or {}).get('id'), (lobbyer or {}).get('id')):
                rid, hits = retrieve(sid, s['topic'] + ' ' + (s['context'] or ''))
            line = speak(sid, s, ms, a, b, lobbyer, target, flip, decrees, hits)
            if stop.is_set():
                return
            for m in (a, b):
                if m:
                    store.add_turn(sid, m['id'], 'rebuttal', m['stance'], m['influence'],
                                   line['clash'].get(m['id']) or fallback_line(m['id'], lang))
            if lobbyer:
                store.add_turn(sid, lobbyer['id'], 'lobby', lobbyer['stance'], lobbyer['influence'],
                               line['lobby'] or fallback_line(lobbyer['id'], lang), target['id'])
                if flip:  # 倒戈者丢两成影响力：墙头草说话没那么响
                    target['stance'], target['influence'] = lobbyer['stance'], round(target['influence'] * .8, 2)
                store.add_turn(sid, target['id'], 'lobby', target['stance'], target['influence'],
                               line['reply'] or fallback_line(target['id'], lang), lobbyer['id'])
            if hits:
                store.update('retrievals', rid, cited=len({i for i in line['cites'] if 0 <= i < len(hits)}))
            undecided = any(m['stance'] == 'undecided' for m in store.ministers(sid))
            calm = 0 if (flip or undecided) else calm + 1
            if calm >= CALM_ROUNDS:
                break
    finally:
        _running.pop(sid, None)
        if store.session(sid)['status'] == 'debating':
            store.update('sessions', sid, status='recess')


def speak(sid, s, ms, a, b, lobbyer, target, flip, decrees, hits):
    """一回合恰好一次模型调用：两句对呛 + 一次游说与回应。"""
    L = P[s['lang']]
    recent = [t for t in store.turns(sid) if t['kind'] != 'opening'][-6:] or store.turns(sid)[-6:]
    lib = L['library'].format(facts='\n'.join(f'[{i}] {h["text"]}' for i, h in enumerate(hits)),
                              stance=ms['moth']['stance']) if hits else ''
    data = llm.complete_json(sid, 'speak', [
        {'role': 'system', 'content': L['speak_sys']},
        {'role': 'user', 'content': L['speak_user'].format(
            topic=s['topic'], context=s['context'] or L['none'],
            stances=json.dumps({k: m['stance'] for k, m in ms.items()}),
            history='\n'.join(f'{t["minister"]}: {t["text"]}' for t in recent),
            decrees=''.join(L['decree'].format(text=d['text']) for d in decrees), library=lib, roster=L['roster'](),
            who=f'{a["id"]} vs {b["id"]}' if a and b else L['silenced'],
            lobby=L['lobby'].format(a=lobbyer['id'], b=target['id'], flip=L['flip'][0 if flip else 1])
                  if lobbyer else L['none'])}])
    return parse_speak(data)


def text(x, n=120):
    return str(x).strip()[:n] if isinstance(x, (str, int, float)) and str(x).strip() else ''


def parse_speak(data):
    """模型的 JSON 形状不可信：clash 可能是字符串列表、lobby 可能是一句话。拿得到的用，拿不到的空着走兜底。"""
    data = data if isinstance(data, dict) else {}
    clash = {}
    for c in data.get('clash') if isinstance(data.get('clash'), list) else []:
        if isinstance(c, dict) and c.get('minister') in ROSTER:
            clash[c['minister']] = text(c.get('text'))
    lb = data.get('lobby')
    lb = lb if isinstance(lb, dict) else {'text': lb}
    cites = data.get('cites') if isinstance(data.get('cites'), list) else []
    return {'clash': clash, 'lobby': text(lb.get('text')), 'reply': text(lb.get('reply')),
            'cites': [i for i in cites if isinstance(i, int)]}


# ---------------- 皇帝 ----------------

def decree(sid, kind, words):
    s = store.session(sid)
    zh, en = DECREE_TEXT.get(kind, ('📜 朕有旨。', '📜 BY ROYAL DECREE.'))
    store.add_turn(sid, 'emperor', 'decree', 'undecided', 0.0, (words or (zh if s['lang'] == 'zh' else en))[:120], kind)


def rule(sid, choice):
    if choice not in VERDICT_ZH:
        raise ValueError('choice must be one of ' + ', '.join(VERDICT_ZH))
    stop = _running.get(sid)
    if stop:
        stop.set()
    s, st = store.session(sid), state(sid)
    if s['status'] == 'decided':
        return st
    t = st['tally']
    zh = s['lang'] == 'zh'
    L = P[s['lang']]
    data = llm.complete_json(sid, 'verdict', [
        {'role': 'system', 'content': L['verdict_sys']},
        {'role': 'user', 'content': L['verdict_user'].format(topic=s['topic'], choice=L['choice'][choice], **t)}])
    edict = text((data or {}).get('edict') if isinstance(data, dict) else None, 1000)
    # 超长就在句末收住，别断在半个词上
    edict = re.sub(r'(?s)^(.{0,240}[.!?。！？]).*$', r'\1', edict)[:240] or (f'朕意已决：{VERDICT_ZH[choice][:2]}。' if zh else f'So it is {VERDICT_EN[choice].split()[0].lower()}.')
    store.add_turn(sid, 'emperor', 'verdict', 'undecided', 0.0, edict)
    store.update('sessions', sid, status='decided', verdict=choice, ended_at=store.now())
    return state(sid)
