"""載入 BreezyVoice 一次，依序合成多句。用法：breezy_run.py 參考音檔 "參考逐字稿" 輸出資料夾 句子檔(每行: 檔名<TAB>文字)"""
import sys, os, time, torch
sys.path.insert(0, os.getcwd())
from single_inference import CustomCosyVoice, single_inference
from g2pw import G2PWConverter
torch.set_num_threads(os.cpu_count())
ref, ref_text, out_dir, lines_file = sys.argv[1:5]
os.makedirs(out_dir, exist_ok=True)
cv = CustomCosyVoice("MediaTek-Research/BreezyVoice-300M"); conv = G2PWConverter()
for line in open(lines_file, encoding="utf-8"):
    if not line.strip(): continue
    name, text = line.rstrip("\n").split("\t", 1)
    out = os.path.join(out_dir, name + ".wav")
    if os.path.exists(out): continue
    t = time.time(); single_inference(ref, text, out, cv, conv, ref_text)
    print(f"DONE {name} {time.time()-t:.0f}s", flush=True)
