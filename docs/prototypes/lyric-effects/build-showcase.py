"""把歌词特效演示（showcase.html）打包成单个 HTML 文件，用于在后台作为「HTML 页面」上传。

core.js 与 showcase-data.js 内联进页面：单文件上传最简单，也不依赖沙箱（不透明源）里加载子资源。
用法：python3 docs/prototypes/lyric-effects/build-showcase.py，输出到同目录的 dist/lyric-effects-showcase.html
"""
from pathlib import Path

here = Path(__file__).resolve().parent
html = (here / 'showcase.html').read_text(encoding='utf-8')
for name in ('core.js', 'showcase-data.js'):
    tag = f'<script src="{name}"></script>'
    if html.count(tag) != 1:
        raise SystemExit(f'showcase.html 中找不到唯一的 {tag}')
    html = html.replace(tag, '<script>\n' + (here / name).read_text(encoding='utf-8') + '\n</script>')
out = here / 'dist' / 'lyric-effects-showcase.html'
out.parent.mkdir(exist_ok=True)
out.write_text(html, encoding='utf-8')
print(f'{out} ({len(html.encode()) // 1024} KB)')
