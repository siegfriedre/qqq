import json
import os
import urllib.request
import time

SYMBOLS = ['QQQ', 'TQQQ', 'SMH', 'VGT']
RANGES = ['5d', '1mo', '3mo', '6mo', '1y', '5y']
DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data')
API_BASE = 'https://query1.finance.yahoo.com/v8/finance/chart/'

os.makedirs(DATA_DIR, exist_ok=True)

for symbol in SYMBOLS:
    for range_val in RANGES:
        filename = f'{symbol}_{range_val}.json'
        filepath = os.path.join(DATA_DIR, filename)
        url = f'{API_BASE}{symbol}?range={range_val}&interval=1d'

        try:
            req = urllib.request.Request(url)
            req.add_header('User-Agent', 'Mozilla/5.0')
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = json.loads(resp.read().decode())
                if data.get('chart', {}).get('error'):
                    raise Exception(f'API error: {data["chart"]["error"]}')
                with open(filepath, 'w', encoding='utf-8') as f:
                    json.dump(data, f, ensure_ascii=False)
                print(f'OK: {filename}')
        except Exception as e:
            print(f'FAIL: {filename} - {e}')

        time.sleep(0.5)

print('Done')
