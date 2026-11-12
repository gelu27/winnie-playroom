# 發音檢查

BreezyVoice 每次合成都有隨機性，偶爾會把字唸錯、聲調走錯（例如「草莓」的「莓」該上揚卻往下掉）。
這裡的工具在雲端沒有喇叭的情況下，用機器「聽」錄音：

| 腳本 | 檢查什麼 | 抓得到 | 抓不到 |
|---|---|---|---|
| `score.py` | Whisper 強迫對齊：給定正確文字，算模型覺得這段聲音是這句話的信心 | 唸錯字、漏字、含糊、沒聲音 | 聲調（Whisper 對聲調不敏感）、單字詞容易誤判 |
| `tone.py` | Praat 抓音高，把短詞切成一個字一個字，看走向合不合該有的聲調（含三聲連讀） | 二聲往下掉、四聲往上揚、三聲唸成高降 | 長句切字不準；四個聲音都被標的通常是工具誤判 |
| `choose.py` | 同一句錄好幾個版本，先比聲調問題數、再比 Whisper 分數，挑最好的 | | |

```bash
pip install transformers torch opencc praat-parselmouth
# 全部 C 聲音打分數
VOICE=voice/ python score.py openai/whisper-small score_C.json C
# 聲調（g2p.json：每句的注音，由 g2pw 產生）
G2P=g2p.json python tone.py tone_C.json 句子與路徑.tsv 2.1
```

這些只是篩選，最後還是要大人用耳朵聽；聽到唸錯的詞請記下來，下次重錄。
