/**
 * copyToClipboard
 * - 优先使用 navigator.clipboard.writeText（异步）
 * - 如果不可用或失败，使用隐藏的 textarea + document.execCommand('copy') 回退
 * - 尝试在回退时恢复原始 selection
 *
 * 返回 Promise<boolean>，表示是否成功复制
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  // 优先使用现代 Clipboard API
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (err) {
    // 忽略并回退到老方法
    // console.warn('navigator.clipboard.writeText failed, falling back to execCommand', err);
  }

  // 回退到 textarea + execCommand 方案（在许多旧浏览器上可用）
  if (typeof document === 'undefined') return false;

  const textarea = document.createElement('textarea');
  textarea.value = text;
  // 防止页面滚动，把元素放到不可见但可选中的位置
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.top = '0';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);

  // 保存当前 selection（以便恢复）
  const selection = document.getSelection();
  let originalRange: Range | null = null;
  if (selection && selection.rangeCount > 0) {
    originalRange = selection.getRangeAt(0);
  }

  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);

  try {
    // 使用 any 绕开 TypeScript 中关于 execCommand 的弃用声明
    const successful = (document as any).execCommand('copy');
    // 清理并恢复 selection
    document.body.removeChild(textarea);
    if (selection) {
      selection.removeAllRanges();
      if (originalRange) selection.addRange(originalRange);
    }
    return Boolean(successful);
  } catch (err) {
    // 清理并恢复 selection
    document.body.removeChild(textarea);
    if (selection) {
      selection.removeAllRanges();
      if (originalRange) selection.addRange(originalRange);
    }
    return false;
  }
}

export default copyToClipboard;
