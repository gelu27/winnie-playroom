# 每句從「原本的錄音＋新錄的幾個版本」挑最好的：先比聲調問題數，再比 Whisper 對這句話的信心，太短/沒聲音的直接淘汰
# 用法：choose.py 候選.json(文字 -> [mp3路徑...]，第一個是原本的或 null) 輸出.json
import sys, json, subprocess, numpy as np, torch, opencc
sys.path.insert(0, __import__('os').path.dirname(__file__))
import tone
from transformers import WhisperProcessor, WhisperForConditionalGeneration
torch.set_num_threads(4)
proc = WhisperProcessor.from_pretrained('openai/whisper-small'); model = WhisperForConditionalGeneration.from_pretrained('openai/whisper-small').eval()
t2s = opencc.OpenCC('t2s')
prefix = proc.tokenizer.convert_tokens_to_ids(['<|startoftranscript|>', '<|zh|>', '<|transcribe|>', '<|notimestamps|>'])
def load(p):
    b = subprocess.run(['ffmpeg', '-v', 'quiet', '-i', p, '-f', 's16le', '-ac', '1', '-ar', '16000', '-'], capture_output=True).stdout
    return np.frombuffer(b, np.int16).astype(np.float32) / 32768
def asr(a, text):
    feat = proc(a, sampling_rate=16000, return_tensors='pt').input_features
    with torch.no_grad(): enc = model.model.encoder(feat)
    best = None
    for tx in (text, t2s.convert(text)):
        ids = proc.tokenizer(tx, add_special_tokens=False).input_ids + [proc.tokenizer.eos_token_id]
        dec = torch.tensor([prefix + ids])
        with torch.no_grad(): lg = model(encoder_outputs=enc, decoder_input_ids=dec[:, :-1]).logits[0]
        lp = torch.log_softmax(lg, -1)[len(prefix) - 1:]; v = lp[torch.arange(len(ids)), dec[0, len(prefix):]]
        s = (float(v.mean()), float(v.min()))
        if best is None or s[0] > best[0]: best = s
    return best
cands = json.load(open(sys.argv[1])); res = {}
for text, paths in cands.items():
    tt = tone.tones_for(text); rows = []
    for p in paths:
        if not p: continue
        a = load(p); dur = len(a) / 16000; peak = float(np.abs(a).max()) if len(a) else 0
        nchar = len(tt[0]) if tt else len(text)
        if dur < 0.25 + 0.12 * nchar or peak < 0.1 or dur > 1.2 + 0.45 * nchar: rows.append({'p': p, 'bad': f'len{dur:.2f}/peak{peak:.2f}'}); continue
        iss = None
        if tt:
            segs = tone.analyze(p, len(tt[0]))
            iss = None if segs is None else [f'{tt[0][i]}：{q}' for i, s in enumerate(segs) if (q := tone.judge(tt[1][i], s, i == len(segs) - 1, 2.1))]
        m, mn = asr(a, text)
        rows.append({'p': p, 'dur': round(dur, 2), 'tone': iss, 'asr': round(m, 2), 'asrmin': round(mn, 2)})
    ok = [r for r in rows if 'bad' not in r]
    # 聲調問題數（切不出字的當 1 個問題）→ Whisper 平均分
    ok.sort(key=lambda r: (len(r['tone']) if r['tone'] is not None else 1, -r['asr']))
    res[text] = {'pick': ok[0]['p'] if ok else None, 'rows': rows}
    print(text, '->', (ok[0]['p'].split('/')[-1] if ok else 'NONE'), [(r['p'].split('/')[-1], r.get('tone'), r.get('asr'), r.get('bad')) for r in rows], flush=True)
json.dump(res, open(sys.argv[2], 'w'), ensure_ascii=False, indent=0)
