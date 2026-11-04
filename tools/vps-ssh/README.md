# Otter VPS SSH & SFTP Engine (Python Paramiko Bridge)

Công cụ kết nối và điều khiển VPS Linux từ xa qua giao thức SSH và SFTP cho Otter Agent và MCP clients.

## Cài đặt thư viện phụ thuộc

```bash
pip install -r requirements.txt
```

## Chạy thử nghiệm độc lập

```bash
# Kiểm tra kết nối
python vps_ssh.py --json "{\"action\": \"test\", \"host\": \"your-vps-ip\", \"user\": \"root\"}"

# Thực thi lệnh từ xa
python vps_ssh.py --json "{\"action\": \"exec\", \"host\": \"your-vps-ip\", \"user\": \"root\", \"command\": \"uname -a\"}"
```

