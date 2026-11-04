import * as fs from 'node:fs';
import * as path from 'node:path';
import nodemailer from 'nodemailer';

export interface EmailOptions {
  to: string;
  subject: string;
  licenseKey: string;
  packageType: string;
  durationDays: number;
  expiresAt?: string | null;
  customerName?: string;
}

export interface MailerResult {
  success: boolean;
  messageId?: string;
  deliveryMode: 'smtp' | 'local_log' | 'webhook';
  savedPath?: string;
  error?: string;
}

/**
 * Tạo nội dung HTML cho email cấp bản quyền Otter
 */
export function generateLicenseEmailHtml(options: EmailOptions): string {
  const expiryText = options.expiresAt 
    ? new Date(options.expiresAt).toLocaleDateString('vi-VN', { year: 'numeric', month: 'long', day: 'numeric' })
    : 'Vĩnh viễn (Trọn đời)';

  const packageTitle = options.packageType.toUpperCase();
  const durationLabel = options.durationDays > 0 ? `${options.durationDays} ngày` : 'Trọn đời';

  return `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: 'Segoe UI', Arial, sans-serif; background-color: #0b1120; color: #f1f5f9; margin: 0; padding: 24px; }
    .card { max-width: 600px; margin: 0 auto; background: #1e293b; border-radius: 16px; padding: 32px; border: 1px solid #334155; }
    .header { text-align: center; border-bottom: 1px solid #334155; padding-bottom: 20px; }
    .badge { display: inline-block; background: #10b981; color: #022c22; font-weight: 700; padding: 4px 12px; border-radius: 9999px; font-size: 13px; }
    .key-box { background: #0f172a; border: 1px dashed #38bdf8; border-radius: 10px; padding: 18px; margin: 24px 0; word-break: break-all; font-family: monospace; font-size: 14px; color: #38bdf8; }
    .info-row { display: flex; justify-content: space-between; margin: 10px 0; padding: 8px 0; border-bottom: 1px solid #334155; font-size: 14px; }
    .footer { text-align: center; font-size: 12px; color: #94a3b8; margin-top: 24px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <div style="font-size: 40px; margin-bottom: 8px;">🦦</div>
      <h2 style="margin: 0 0 8px 0; color: #fff;">Mã Bản Quyền Otter Desktop</h2>
      <span class="badge">GÓI ${packageTitle} (${durationLabel})</span>
    </div>
    
    <p style="margin-top: 20px; color: #cbd5e1;">Xin chào <strong>${options.to}</strong>,</p>
    <p style="color: #cbd5e1;">Cảm ơn bạn đã lựa chọn Otter. Dưới đây là thông tin và mã bản quyền kích hoạt dành riêng cho bạn:</p>

    <div class="key-box">
      <strong>MÃ TOKEN / LICENSE KEY:</strong><br><br>
      ${options.licenseKey}
    </div>

    <div class="info-row">
      <span style="color: #94a3b8;">Loại gói:</span>
      <strong style="color: #10b981;">Otter Pro - ${packageTitle}</strong>
    </div>
    <div class="info-row">
      <span style="color: #94a3b8;">Thời hạn sử dụng:</span>
      <strong style="color: #fff;">${durationLabel}</strong>
    </div>
    <div class="info-row">
      <span style="color: #94a3b8;">Ngày hết hạn:</span>
      <strong style="color: #38bdf8;">${expiryText}</strong>
    </div>

    <h4 style="color: #fff; margin-top: 24px;">🚀 Hướng dẫn kích hoạt:</h4>
    <ol style="color: #cbd5e1; font-size: 14px; line-height: 1.6;">
      <li>Khởi động <strong>Otter</strong> trên máy tính của bạn.</li>
      <li>Mở trình duyệt truy cập <code>http://127.0.0.1:1993</code> (hoặc mở menu Tiện ích Otter trên Chrome).</li>
      <li>Dán mã token ở trên vào ô <strong>Kích Hoạt Bản Quyền</strong> và bấm Xác nhận.</li>
    </ol>

    <div class="footer">
      Email này được gửi tự động từ Otter License Server.<br>
      Cộng đồng hỗ trợ: <a href="https://www.facebook.com/share/g/1CN8sjFYDH/?mibextid=wwXIfr" style="color: #38bdf8;">Nhóm Facebook Hỗ Trợ Otter</a>
    </div>
  </div>
</body>
</html>`;
}

/**
 * Dịch vụ gửi email thông báo mã Token bản quyền
 */
export async function sendLicenseEmail(options: EmailOptions): Promise<MailerResult> {
  const htmlContent = generateLicenseEmailHtml(options);
  const textContent = `
Xin chào ${options.to},
Mã bản quyền kích hoạt Otter của bạn:
- Gói: ${options.packageType.toUpperCase()} (${options.durationDays > 0 ? options.durationDays + ' ngày' : 'Trọn đời'})
- Mã Token / License Key: ${options.licenseKey}
- Hết hạn: ${options.expiresAt || 'Vĩnh viễn'}

Vui lòng nhập mã trên vào Otter tại http://127.0.0.1:1993 để kích hoạt!
`;

  // Cấu hình SMTP (ưu tiên biến môi trường, fallback cấu hình từ Pay.GPT)
  const smtpHost = process.env.SMTP_HOST || 'smtp.gmail.com';
  const smtpPort = Number(process.env.SMTP_PORT || 465);
  const smtpSecure = smtpPort === 465;
  const smtpUser = process.env.SMTP_USER || 'pay.gpt.io.vn@gmail.com';
  const smtpPass = (process.env.SMTP_PASS || 'zozw ywkm zsgp zjxh').trim();
  const smtpFromName = process.env.SMTP_FROM_NAME || 'Otter Authority';
  const smtpFromEmail = process.env.SMTP_FROM_EMAIL || smtpUser;

  let smtpSent = false;
  let smtpMessageId: string | undefined;

  if (smtpHost && smtpUser && smtpPass) {
    try {
      console.log(`[Mailer] 📧 Đang gửi email qua SMTP (${smtpHost}:${smtpPort}) tới ${options.to}...`);
      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpSecure,
        auth: {
          user: smtpUser,
          pass: smtpPass,
        },
      });

      const info = await transporter.sendMail({
        from: `"${smtpFromName}" <${smtpFromEmail}>`,
        to: options.to,
        subject: options.subject || `Mã Bản Quyền Otter - Gói ${options.packageType.toUpperCase()}`,
        text: textContent,
        html: htmlContent,
      });

      smtpSent = true;
      smtpMessageId = info.messageId;
      console.log(`[Mailer] 🚀 Đã gửi email thực tế thành công qua SMTP tới ${options.to} (Message-ID: ${info.messageId})`);
    } catch (err: any) {
      console.warn('[Mailer] ⚠️ Lỗi gửi SMTP, tiếp tục lưu trữ cục bộ:', err.message);
    }
  }

  // Chế độ lưu trữ cục bộ (Local Outbox) & Log console:
  // Đảm bảo không bao giờ bị mất mail, luôn xem được nội dung mail và token ngay lập tức
  const outboxDir = path.join(process.cwd(), 'data', 'sent-emails');
  try {
    if (!fs.existsSync(outboxDir)) {
      fs.mkdirSync(outboxDir, { recursive: true });
    }
    const safeEmail = options.to.replace(/[^a-zA-Z0-9]/g, '_');
    const filename = `${Date.now()}_${safeEmail}.html`;
    const fullPath = path.join(outboxDir, filename);
    fs.writeFileSync(fullPath, htmlContent, 'utf8');

    console.log(`[Mailer] ✅ Đã lưu bản sao mã token tới ${options.to} (Gói: ${options.packageType}, ${options.durationDays} ngày)`);
    console.log(`[Mailer] 💾 Bản sao email lưu tại: ${fullPath}`);

    return {
      success: true,
      deliveryMode: smtpSent ? 'smtp' : 'local_log',
      messageId: smtpMessageId || `msg_${Date.now()}`,
      savedPath: fullPath,
    };
  } catch (err: any) {
    return {
      success: false,
      deliveryMode: smtpSent ? 'smtp' : 'local_log',
      messageId: smtpMessageId,
      error: err.message,
    };
  }
}
