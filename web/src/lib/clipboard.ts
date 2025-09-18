/**
 * copyToClipboard
 * - 优先使用 navigator.clipboard.writeText（异步）
 * - 如果不可用或失败，使用隐藏的 textarea + document.execCommand('copy') 回退
 * - 尝试在回退时恢复原始 selection
 *
 * 返回 Promise<boolean>，表示是否成功复制
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch  {
  }
  if (typeof document === 'undefined') return false;

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.top = '0';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);

  const selection = document.getSelection();
  let originalRange: Range | null = null;
  if (selection && selection.rangeCount > 0) {
    originalRange = selection.getRangeAt(0);
  }

  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);

  try {
    const successful = document.execCommand('copy');
    document.body.removeChild(textarea);
    if (selection) {
      selection.removeAllRanges();
      if (originalRange) selection.addRange(originalRange);
    }
    return Boolean(successful);
  } catch {
    document.body.removeChild(textarea);
    if (selection) {
      selection.removeAllRanges();
      if (originalRange) selection.addRange(originalRange);
    }
    return false;
  }
}

export default copyToClipboard;
