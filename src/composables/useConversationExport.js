import { ref } from 'vue';
import { createShareSnapshot } from '../api/share.js';

export function useConversationExport(chatStore, toast) {
  const showExportMenu = ref(false);
  const closeExportMenu = () => { showExportMenu.value = false; };

  const getExportMessages = (conv) => {
    if (!conv?.messages?.length) return null;
    const messages = conv.messages.filter((msg) => msg.id !== 'welcome' && msg.text?.trim());
    return messages.length > 0 ? messages : null;
  };

  const buildPlainText = (conv, messages) => {
    const lines = [`# ${conv.title || '对话记录'}`, `导出时间：${new Date().toLocaleString('zh-CN')}`, ''];
    messages.forEach((msg) => {
      lines.push(`【${msg.role === 'user' ? '👤 用户' : '🤖 AI'}】`, msg.text, '');
    });
    return lines.join('\n');
  };

  const buildMarkdown = (conv, messages) => {
    const lines = [`# ${conv.title || '对话记录'}`, '', `> 导出时间：${new Date().toLocaleString('zh-CN')}`, ''];
    messages.forEach((msg) => {
      lines.push(`### ${msg.role === 'user' ? '👤 用户' : '🤖 AI'}`, '', msg.text, '', '---', '');
    });
    return lines.join('\n');
  };

  const buildHtml = (conv, messages) => {
    const escapeHtml = (value) => String(value || '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/\n/g, '<br/>');
    const items = messages.map((msg) => {
      const isUser = msg.role === 'user';
      return `<div class="message ${isUser ? 'user' : 'ai'}"><div class="avatar">${isUser ? '用户' : 'AI'}</div><div class="bubble">${escapeHtml(msg.text)}</div></div>`;
    }).join('');
    return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>${escapeHtml(conv.title || '对话记录')} — 武理小精灵</title><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;background:#f1f5f9;padding:24px 16px}.header,.chat,.footer{max-width:720px;margin-left:auto;margin-right:auto}.header{text-align:center;margin-bottom:20px}.header h1{font-size:18px;color:#1e293b}.header p,.footer{font-size:12px;color:#94a3b8;margin-top:6px}.message{display:flex;gap:10px;margin-bottom:14px;align-items:flex-start}.message.user{flex-direction:row-reverse}.avatar{width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;color:#fff;flex-shrink:0}.user .avatar{background:#bfdbfe;color:#1e40af}.ai .avatar{background:linear-gradient(135deg,#3b82f6,#818cf8)}.bubble{max-width:75%;padding:10px 14px;border-radius:14px;font-size:14px;line-height:1.7;word-break:break-word}.user .bubble{background:#2563eb;color:#fff;border-top-right-radius:4px}.ai .bubble{background:#fff;color:#334155;border:1px solid #e2e8f0;border-top-left-radius:4px}.footer{text-align:center;margin-top:28px;font-size:11px;color:#cbd5e1}</style></head><body><div class="header"><h1>${escapeHtml(conv.title || '对话记录')}</h1><p>由武理小精灵 AI 助手导出 · ${new Date().toLocaleString('zh-CN')}</p></div><div class="chat">${items}</div><div class="footer">武理小精灵 WUT Assistant</div></body></html>`;
  };

  const downloadBlob = (content, type, filename) => {
    const blob = new Blob([content], { type: `${type};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  };

  const dateSuffix = () => new Date().toISOString().slice(0, 10);

  const copyConversationAsText = async () => {
    const conv = chatStore.currentConversation;
    const messages = getExportMessages(conv);
    if (!messages) return toast.warning('当前会话没有内容可复制');
    try {
      await navigator.clipboard.writeText(buildPlainText(conv, messages));
      toast.success('对话已复制为纯文本');
    } catch (error) {
      console.error('[AIChat] 复制失败:', error);
      toast.error('复制失败，请手动选择复制');
    } finally {
      closeExportMenu();
    }
  };

  const exportConversation = () => {
    const conv = chatStore.currentConversation;
    const messages = getExportMessages(conv);
    if (!messages) return toast.warning('当前会话没有内容可导出');
    downloadBlob(buildMarkdown(conv, messages), 'text/markdown', `${conv.title || '对话记录'}_${dateSuffix()}.md`);
    toast.success('对话已导出为 Markdown 文件');
    closeExportMenu();
  };

  const exportConversationAsHtml = () => {
    const conv = chatStore.currentConversation;
    const messages = getExportMessages(conv);
    if (!messages) return toast.warning('当前会话没有内容可导出');
    downloadBlob(buildHtml(conv, messages), 'text/html', `${conv.title || '对话记录'}_${dateSuffix()}.html`);
    toast.success('对话已导出为 HTML 文件');
    closeExportMenu();
  };

  const shareConversation = async () => {
    const conv = chatStore.currentConversation;
    const messages = getExportMessages(conv);
    if (!messages) return toast.warning('当前会话没有内容可分享');
    try {
      const { code, url } = await createShareSnapshot({
        title: conv.title || '对话记录',
        messages: messages.map(({ role, text, timestamp }) => ({ role, text, timestamp })),
      });
      const fullUrl = `${window.location.origin}${url}`;
      try {
        await navigator.clipboard.writeText(fullUrl);
        toast.success('分享链接已复制到剪贴板');
      } catch {
        toast.success(`分享链接：${fullUrl}`);
      }
      console.debug('[AIChat] 分享链接已生成:', code);
    } catch (error) {
      console.error('[AIChat] 生成分享链接失败:', error);
      toast.error('生成分享链接失败，请稍后重试');
    } finally {
      closeExportMenu();
    }
  };

  return { showExportMenu, closeExportMenu, copyConversationAsText, exportConversation, exportConversationAsHtml, shareConversation };
}
