# Otter Skill CLI Manager (`tools/skill`)

Tiện ích dòng lệnh dành cho người dùng cuối và AI Agent để tra cứu, kích hoạt và tự động cài đặt các AI Skills từ GitHub / `sources.json` vào `.agents/skills/`.

## 1. Sử dụng trực tiếp bằng file thực thi (Không cần cài Bun/Node)

Dành cho người dùng cuối không có Bun trên máy:
```cmd
# Chạy trực tiếp qua file nhị phân độc lập skill.exe (hoặc skill.cmd)
tools\skill\skill.exe list
tools\skill\skill.exe search gsap
tools\skill\skill.exe show video-shotcraft
tools\skill\skill.exe install <tên-skill-hoặc-git-url>
```

> **Mẹo**: Bạn có thể copy `tools/skill/skill.exe` vào thư mục bất kỳ trong PATH hệ thống để gõ `skill <lệnh>` ở mọi nơi.

## 2. Sử dụng qua Bun / TypeScript

Nếu môi trường đã cài đặt Bun:
```bash
# Qua script tiện lợi trong package.json
bun run skill list
bun run skill search video
bun run skill show remotion-video-creator

# Hoặc qua lệnh trực tiếp
bun tools/skill/skill.ts list
```

## 3. Biên dịch lại file thực thi độc lập (Standalone Executable)

Khi sửa đổi mã nguồn `skill.ts`, bạn có thể build lại `skill.exe` bằng lệnh:
```bash
bun run build:skill
```
*Lệnh này đóng gói toàn bộ logic TypeScript thành một file nhị phân độc lập duy nhất `skill.exe`, tự động nhận diện thư mục `.agents/skills/` dù chạy từ bất kỳ thư mục con nào.*

