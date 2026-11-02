const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);
}

interface LayoutOptions {
  title: string;
  preheader: string;
  content: string;
}

export function renderLayout({
  title,
  preheader,
  content,
}: LayoutOptions): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
  </head>
  <body style="margin:0;padding:0;background-color:#f4f5f7;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f4f5f7;">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;background-color:#ffffff;border-radius:8px;font-family:Arial,Helvetica,sans-serif;color:#1f2937;">
            <tr>
              <td style="padding:32px;font-size:16px;line-height:24px;">
                <h1 style="margin:0 0 16px;font-size:22px;line-height:30px;color:#111827;">${escapeHtml(title)}</h1>
                ${content}
              </td>
            </tr>
          </table>
          <p style="max-width:480px;margin:16px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;color:#6b7280;">
            You received this email because this address was used to sign up for Auth Service.
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
