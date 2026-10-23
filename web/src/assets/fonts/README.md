# 分享图字体

`NotoSansSC-Medium.subset.ttf` 供 `src/app/(main)/p/[id]/opengraph-image.tsx` 生成分享图使用。

- 来源：[Noto Sans SC](https://github.com/google/fonts/tree/main/ofl/notosanssc)（SIL Open Font License 1.1）
- satori（`next/og`）只支持 ttf / otf / woff，不接受 woff2，因此这里放的是解压后的子集文件
- 子集范围：ASCII 可见字符、GB2312 全部汉字与符号（6763 字）、`src/locales/*.json` 中出现过的字符、常用排版符号；可变字体实例化为 `wght=500`，并去掉布局表与 hinting 以控制体积（约 2.3MB）
- 标题里出现子集之外的生僻字时，分享图中该字会缺失；需要时按下面的步骤重新生成更大的子集

重新生成（需要 `python3` 与 `pip install fonttools`）：

```bash
cd /tmp
curl -sSL -o NotoSansSC.ttf "https://github.com/google/fonts/raw/main/ofl/notosanssc/NotoSansSC%5Bwght%5D.ttf"
python3 - <<'PY'
import glob
from fontTools.ttLib import TTFont
from fontTools import subset
from fontTools.varLib.instancer import instantiateVariableFont

chars = {chr(c) for c in range(0x20, 0x7F)}
for hi in range(0xA1, 0xF8):                     # GB2312 汉字与符号
    for lo in range(0xA1, 0xFF):
        try:
            chars.add(bytes([hi, lo]).decode('gb2312'))
        except UnicodeDecodeError:
            pass
for path in glob.glob('web/src/locales/*.json'): # 站内文案用字
    chars.update(open(path, encoding='utf-8').read())
chars.update('—–…·“”‘’《》〈〉【】「」『』〔〕×÷≥≤≠±°№€£¥©®™✓')

f = instantiateVariableFont(TTFont('NotoSansSC.ttf'), {'wght': 500}, updateFontNames=True)
cmap = f.getBestCmap()
opt = subset.Options()
opt.name_IDs = ['*']
opt.notdef_outline = True
opt.drop_tables += ['GSUB', 'GPOS', 'GDEF', 'gasp', 'hdmx', 'VDMX', 'LTSH', 'prep', 'fpgm', 'cvt ']
sub = subset.Subsetter(options=opt)
sub.populate(unicodes=[ord(c) for c in chars if ord(c) in cmap])
sub.subset(f)
f.save('web/src/assets/fonts/NotoSansSC-Medium.subset.ttf')
PY
```
