# 用 Whisper「強迫對齊」打分數：給定正確文字，算模型覺得這段聲音唸的是這句話的平均對數機率
import sys, json, subprocess, numpy as np, torch, opencc
from transformers import WhisperProcessor, WhisperForConditionalGeneration
torch.set_num_threads(4)
name = sys.argv[1]; out = sys.argv[2]; voices = sys.argv[3].split(',')
proc = WhisperProcessor.from_pretrained(name); model = WhisperForConditionalGeneration.from_pretrained(name).eval()
t2s = opencc.OpenCC('t2s')
V = __import__('os').environ.get('VOICE', 'voice/')
man = json.load(open(V + 'manifest.json'))
def load(p):
    b = subprocess.run(['ffmpeg', '-v', 'quiet', '-i', p, '-f', 's16le', '-ac', '1', '-ar', '16000', '-'], capture_output=True).stdout
    return np.frombuffer(b, np.int16).astype(np.float32) / 32768
prefix = proc.tokenizer.convert_tokens_to_ids(['<|startoftranscript|>', '<|zh|>', '<|transcribe|>', '<|notimestamps|>'])
def score(feat_enc, text):
    ids = proc.tokenizer(text, add_special_tokens=False).input_ids + [proc.tokenizer.eos_token_id]
    dec = torch.tensor([prefix + ids])
    with torch.no_grad():
        lg = model(encoder_outputs=feat_enc, decoder_input_ids=dec[:, :-1]).logits[0]
    lp = torch.log_softmax(lg, -1)[len(prefix) - 1:]
    tgt = dec[0, len(prefix):]
    v = lp[torch.arange(len(tgt)), tgt]
    return float(v.mean()), float(v.min())
items = []
for t, f in man['zh'].items(): items.append((t, f, voices))
for t, f in man['zhv'].get('C', {}).items(): items.append((t, f, ['C']))
if len(sys.argv) > 4: keep = set(open(sys.argv[4]).read().split()); items = [x for x in items if x[1] in keep]
res = []
for t, f, vs in items:
    row = {'text': t, 'file': f}
    for v in vs:
        a = load(V + v + '/' + f)
        feat = proc(a, sampling_rate=16000, return_tensors='pt').input_features
        with torch.no_grad(): enc = model.model.encoder(feat)
        s1 = score(enc, t); s2 = score(enc, t2s.convert(t))
        row[v] = max(s1, s2)
    res.append(row)
    if len(res) % 50 == 0: json.dump(res, open(out, 'w'), ensure_ascii=False); print(len(res), flush=True)
json.dump(res, open(out, 'w'), ensure_ascii=False); print('DONE', len(res))
