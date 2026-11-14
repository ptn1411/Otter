import urllib.request
import json

AUTH_HEADER = {
    'Authorization': 'Bearer 2d15ddd85b79bebabe1ed2a6ba553480a9c320b7f8636b5de75e72d864225df6',
    'Content-Type': 'application/json'
}

profile_id = '64b20c37-715c-4f4c-897c-fbbac828e8bf'
ext_path = r'C:\Users\NAM\Code\rust\chatmcp\extension\dist'

# 1. Dừng profile cũ
print('[*] Stopping profile if running...')
req_stop = urllib.request.Request(
    'http://127.0.0.1:9495/mcp',
    data=json.dumps({
        'jsonrpc': '2.0',
        'id': 20,
        'method': 'tools/call',
        'params': {'name': 'stop_profile', 'arguments': {'id': profile_id}}
    }).encode(),
    headers=AUTH_HEADER
)
try:
    with urllib.request.urlopen(req_stop) as resp:
        print('Stop response:', resp.read().decode())
except Exception as e:
    print('Stop error:', e)

# 2. Khởi động lại với extension
print('[*] Starting profile with extension loaded...')
addition_args = f'--load-extension="{ext_path}" --disable-extensions-except="{ext_path}"'
req_start = urllib.request.Request(
    'http://127.0.0.1:9495/mcp',
    data=json.dumps({
        'jsonrpc': '2.0',
        'id': 21,
        'method': 'tools/call',
        'params': {
            'name': 'start_profile',
            'arguments': {
                'id': profile_id,
                'addition_args': addition_args
            }
        }
    }).encode(),
    headers=AUTH_HEADER
)

try:
    with urllib.request.urlopen(req_start) as resp:
        res = json.loads(resp.read().decode())
        print('[+] Profile launched successfully!')
        print(json.dumps(res, indent=2, ensure_ascii=False))
except Exception as e:
    print('[-] Start error:', e)
