# 聲調檢查：用 Praat 抓音高，把短詞切成一個字一個字，看每個字的音高走向跟該有的聲調合不合
# 用法：tone.py 輸出.json 檔案清單(文字\t路徑) 或 'all'
import sys, json, numpy as np, parselmouth, re
G = json.load(open(__import__('os').environ.get('G2P', 'g2p.json')))
PUN = re.compile(r'[，。？！、,.?!～~：:「」\s]')

def tones_for(text):
    r = G.get(text)
    if not r: return None
    t = [(c, int(b[-1]) if b and b[-1].isdigit() else 5) for c, b in r if b]
    # 三聲連讀：前一個三聲變二聲
    out = [x[1] for x in t]
    for i in range(len(out) - 1):
        if out[i] == 3 and out[i + 1] == 3: out[i] = 2
    return [x[0] for x in t], out

def analyze(path, n):
    snd = parselmouth.Sound(path)
    pit = snd.to_pitch_ac(time_step=0.01, pitch_floor=150, pitch_ceiling=550)
    f0 = pit.selected_array['frequency'].copy(); ts = pit.xs()
    # 修正八度錯誤：比整段中位低/高一個八度左右的點拉回來
    if (f0 > 0).sum() > 5:
        med = np.median(f0[f0 > 0])
        f0[(f0 > 0) & (f0 < med / 1.6)] *= 2; f0[f0 > med * 1.7] /= 2
    inten = snd.to_intensity(time_step=0.01); it = np.interp(ts, inten.xs(), inten.values[0])
    v = f0 > 0
    runs = []; i = 0
    while i < len(v):
        if v[i]:
            j = i
            while j < len(v) and v[j]: j += 1
            runs.append([i, j]); i = j
        else: i += 1
    runs = [r for r in runs if r[1] - r[0] >= 4]  # 去掉 40ms 以下的雜訊
    # 合併很近的段（<40ms 空隙）直到數量 <= n
    while len(runs) > n:
        gaps = [runs[k + 1][0] - runs[k][1] for k in range(len(runs) - 1)]
        k = int(np.argmin(gaps)); runs[k] = [runs[k][0], runs[k + 1][1]]; del runs[k + 1]
    # 段數不夠：在最長那段的音量谷切開
    guard = 0
    while 0 < len(runs) < n and guard < 10:
        guard += 1
        k = max(range(len(runs)), key=lambda q: runs[q][1] - runs[q][0]); a, b = runs[k]
        if b - a < 10: break
        lo, hi = a + (b - a) // 5, b - (b - a) // 5
        cut = lo + int(np.argmin(it[lo:hi]))
        runs[k:k + 1] = [[a, cut], [cut, b]]
    if len(runs) != n: return None
    segs = []
    for a, b in runs:
        x = f0[a:b]; x = x[x > 0]
        if len(x) < 3: segs.append(None); continue
        st = 12 * np.log2(x / 220.0)
        m = len(st); q = max(1, m // 4)
        core = st[m // 10: m - m // 10] if m > 10 else st
        segs.append({'s': float(np.median(st[:q])), 'e': float(np.median(st[-q:])), 'mn': float(core.min()), 'mean': float(core.mean()), 'dur': (b - a) * 0.01})
    return segs

def judge(tone, s, last, ref):
    """回傳問題描述或 None。ref：這個聲音平常說話的音高中位（半音）"""
    if s is None or tone == 5: return None
    d = s['e'] - s['s']
    if tone == 4 and d > 1.5: return '四聲唸成上揚'
    if tone == 2 and d < -2.5: return '二聲唸成下降'
    if tone == 1 and d < -5 and not last: return '一聲掉太多'
    if tone == 1 and d > 4: return '一聲唸成上揚'
    if tone == 3 and s['mn'] > ref + 2.5 and d < -2.5: return '三聲唸成高降（像四聲）'
    return None

if __name__ == '__main__':
    out = sys.argv[1]; items = [l.rstrip('\n').split('\t') for l in open(sys.argv[2])]
    ref = float(sys.argv[3]) if len(sys.argv) > 3 else 0.0
    res = []
    for text, path in items:
        tt = tones_for(text)
        if not tt: continue
        chars, tones = tt
        segs = analyze(path, len(chars))
        row = {'text': text, 'path': path, 'tones': tones}
        if segs is None: row['seg'] = 'fail'
        else:
            row['segs'] = [None if s is None else {k: round(v, 2) for k, v in s.items()} for s in segs]
            row['issues'] = [f'{chars[i]}：{p}' for i, s in enumerate(segs) if (p := judge(tones[i], s, i == len(segs) - 1, ref))]
        res.append(row)
    json.dump(res, open(out, 'w'), ensure_ascii=False, indent=0)
    bad = [r for r in res if r.get('issues')]
    print(len(res), 'checked;', len(bad), 'flagged;', sum(1 for r in res if r.get('seg') == 'fail'), 'seg fail')
