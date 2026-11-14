#!/usr/bin/env python3
"""统计一个人的说话方式指纹，作为分析的客观依据。

用法：python3 style_stats.py <self.txt> [--top 15]

输入：每行一条 TA 本人的发言（一条里的换行写成 " ⏎ "），空行与 # 开头的行忽略。
输出：长度分布、句末习惯、标点与符号、语气词与网络用语、emoji 与颜文字、语言构成与多语混用、口头禅候选。
匹配是粗略的（例如「草」也会匹配「草地」），结论需要结合原文判断。只依赖 Python 3 标准库。
"""

import argparse
import re
import statistics
from collections import Counter

LINE_BREAK = "⏎"

CJK = r"㐀-䶿一-鿿豈-﫿"
KANA = r"\u3040-\u30FF\u31F0-\u31FF\uFF66-\uFF9F"
HANGUL = r"\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F"
CJK_RE = re.compile(f"[{CJK}]")
CJK_RUN_RE = re.compile(f"[{CJK}]+")
KANA_RE = re.compile(f"[{KANA}]")
CJK_KANA_RUN_RE = re.compile(f"[{CJK}{KANA}]+")
HANGUL_RE = re.compile(f"[{HANGUL}]")
EAST_ASIAN_RE = re.compile(f"[{CJK}{KANA}{HANGUL}]")
LATIN_WORD_RE = re.compile(r"[A-Za-z][A-Za-z']+")
WORD_TOKEN_RE = re.compile(r"[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*")
EMOJI_RE = re.compile("[\U0001F300-\U0001FAFF\U0001F000-\U0001F2FF☀-➿⭐⭕]")
KAOMOJI_RE = re.compile(r"[（(][^()（）]{0,12}[ω▽∀＿^°´`･•ﾟ≧≦><；;Д′～￣︶˘ᵕ◕‿♡∇Ő◔ㅂ][^()（）]{0,12}[)）]")
TAG_RE = re.compile(r"\[(表情包?|语音|图片)[:：]?\s*([^\]]*)\]")

# 语气词与网络用语：中文/日文按子串匹配，英文/罗马音按整词匹配（不区分大小写）
MARKERS = [
    "哈哈哈", "哈哈", "hhh", "233", "嘿嘿", "嘻嘻", "呜呜", "笑死", "草", "绝了", "好家伙", "离谱", "无语", "破防",
    "确实", "真的", "其实", "感觉", "我觉得", "讲道理", "属于是", "好耶", "冲", "顶", "摸鱼", "牛", "666", "tql", "yyds",
    "xswl", "nb", "卧槽", "我去", "害", "唉", "诶", "欸", "嗯嗯", "嗯", "哦", "噢", "啊", "呀", "吧", "呢", "嘛", "捏",
    "啥", "咋", "大佬", "老师", "兄弟", "bro", "qwq", "QAQ", "orz", "lol", "lmao", "imo", "btw", "lgtm", "tbh", "ngl", "idk", "+1",
    "なるほど", "たしかに", "わかる", "それな", "まじ", "やば", "かも", "じゃん", "笑", "www", "ww",
]

# 生成口头禅候选时跳过的常见词
COMMON_NGRAMS = set(
    "我们 你们 他们 一个 这个 那个 可以 就是 什么 没有 不是 还是 但是 因为 所以 如果 自己 现在 时候 知道 然后 这样 "
    "怎么 已经 应该 我的 你的 有点 一下 一样 的话 东西 问题 这种 那种 时间 今天 出来 起来 一点 不会 不能 可能 还有 "
    "ている ています ですか ますか した ない から けど って のは こと もの よう そう それ これ あれ ですね".split()
)
STOP_WORDS = set(
    "the a an to is are was were be been am and or of in on at it its i you he she we they them their that this "
    "for with not do did does have has had will would can could should may might what when where why how all some "
    "there here your just very into about then than also only from but as by".split()
)

# 先匹配更长的后缀（「。。」是省略号而不是句号）
ENDINGS = [
    ("...", "省略号"), ("。。", "省略号"), ("…", "省略号"), ("。", "句号"), (".", "句号"), ("！", "感叹号"), ("!", "感叹号"),
    ("？", "问号"), ("?", "问号"), ("～", "波浪号"), ("~", "波浪号"), ("，", "逗号"), (",", "逗号"),
]

PUNCTUATION = [
    ("句号 。", "。"), ("英文句号 .", "single_dot"), ("逗号 ，", "，"), ("半角逗号 ,", ","), ("感叹号 ！/!", "！!"), ("问号 ？/?", "？?"),
    ("省略号 …/...", None), ("波浪号 ～/~", "～~"), ("顿号 、", "、"), ("引号 “”「」", "“”「」"), ("括号 （）()", "（）()"),
]


def load(path):
    messages = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#"):
                messages.append(line)
    return messages


def visible_len(msg):
    return len(re.sub(r"\s+", "", msg.replace(LINE_BREAK, "")))


def ending(msg):
    msg = TAG_RE.sub("", msg.replace(LINE_BREAK, "")).rstrip()
    if not msg:
        return "只有表情 / 语音"
    if EMOJI_RE.search(msg[-1]):
        return "emoji"
    if KAOMOJI_RE.search(msg[-14:]) and msg[-1] in ")）":
        return "颜文字"
    for suffix, name in ENDINGS:
        if msg.endswith(suffix):
            return name
    if msg[-1].isalnum() or EAST_ASIAN_RE.match(msg[-1]):
        return "无标点"
    return f"其他（{msg[-1]}）"


def has_marker(msg, marker):
    if re.fullmatch(r"[A-Za-z]+", marker):
        return re.search(rf"(?<![A-Za-z]){re.escape(marker)}(?![A-Za-z])", msg, re.IGNORECASE) is not None
    return marker in msg


def pct(n, total):
    return f"{n / total * 100:.0f}%" if total else "0%"


def section(title):
    print(f"\n## {title}")


def catchphrases(messages, top):
    total = len(messages)
    min_count = max(3, round(total * 0.03))
    counts = Counter()
    for msg in messages:
        grams = set()
        for run in CJK_KANA_RUN_RE.findall(msg):
            for n in (2, 3, 4):
                for i in range(len(run) - n + 1):
                    grams.add(run[i:i + n])
        for word in LATIN_WORD_RE.findall(msg):
            word = word.lower()
            if word not in STOP_WORDS:
                grams.add(word)
        counts.update(grams)
    candidates = {g: c for g, c in counts.items() if c >= min_count and g not in COMMON_NGRAMS}
    # 同样频率时保留更长的短语，去掉被包含的片段
    result = []
    for gram, count in sorted(candidates.items(), key=lambda kv: (-kv[1], -len(kv[0]))):
        if any(gram in longer and count <= c for longer, c in result):
            continue
        result.append((gram, count))
        if len(result) >= top:
            break
    return result, min_count


def main():
    parser = argparse.ArgumentParser(description="统计说话方式指纹")
    parser.add_argument("file", help="每行一条发言的文本文件")
    parser.add_argument("--top", type=int, default=15, help="每项最多列出的条数")
    args = parser.parse_args()

    messages = load(args.file)
    total = len(messages)
    if total == 0:
        print("没有可统计的发言")
        return
    print(f"# 说话方式统计（{total} 条发言）")
    if total < 30:
        print("注意：少于 30 条，统计结果只能作为参考")

    section("长度（字，不含空白）")
    lengths = sorted(visible_len(m) for m in messages)
    q = statistics.quantiles(lengths, n=4) if total >= 4 else [lengths[0], statistics.median(lengths), lengths[-1]]
    print(f"中位数 {statistics.median(lengths):.0f}，平均 {statistics.mean(lengths):.1f}，四分位 {q[0]:.0f} / {q[-1]:.0f}，最短 {lengths[0]}，最长 {lengths[-1]}")
    buckets = [(0, 10), (10, 30), (30, 80), (80, 200), (200, 10 ** 9)]
    print("分布：" + "，".join(
        f"{lo}～{hi if hi < 10 ** 9 else ''}字 {pct(sum(lo <= x < hi for x in lengths), total)}" for lo, hi in buckets))
    print(f"多行消息：{pct(sum(LINE_BREAK in m for m in messages), total)}")
    latin_word_counts = [len(WORD_TOKEN_RE.findall(m)) for m in messages if LATIN_WORD_RE.search(m)]
    if latin_word_counts:
        print(f"拉丁/英文词数（含拉丁词的 {len(latin_word_counts)} 条）：中位数 {statistics.median(latin_word_counts):.0f} 词，平均 {statistics.mean(latin_word_counts):.1f} 词，最长 {max(latin_word_counts)} 词")

    section("句末")
    for name, count in Counter(ending(m) for m in messages).most_common(args.top):
        print(f"{name}：{pct(count, total)}（{count}）")

    section("标点与符号（含有该符号的发言占比）")
    for name, chars in PUNCTUATION:
        if chars is None:
            count = sum(("…" in m) or ("..." in m) or ("。。" in m) for m in messages)
        elif chars == "single_dot":
            count = sum(re.search(r"(?<!\.)\.(?!\.)", m) is not None for m in messages)
        else:
            count = sum(any(c in m for c in chars) for m in messages)
        print(f"{name}：{pct(count, total)}")

    section("语气词与网络用语（含有的发言占比）")
    found = [(mk, sum(has_marker(m, mk) for m in messages)) for mk in MARKERS]
    found = sorted([(mk, c) for mk, c in found if c], key=lambda kv: -kv[1])[: args.top * 2]
    print("，".join(f"{mk} {pct(c, total)}" for mk, c in found) or "无")

    section("emoji、颜文字与表情（来自截图转写的 [表情: …] 标记）")
    emoji_msgs = sum(bool(EMOJI_RE.search(m)) for m in messages)
    kaomoji_msgs = sum(bool(KAOMOJI_RE.search(m)) for m in messages)
    tag_msgs = sum(bool(TAG_RE.search(m)) for m in messages)
    print(f"含 emoji：{pct(emoji_msgs, total)}，含颜文字：{pct(kaomoji_msgs, total)}，含表情 / 表情包 / 语音标记：{pct(tag_msgs, total)}")
    emojis = Counter(e for m in messages for e in EMOJI_RE.findall(m)).most_common(args.top)
    if emojis:
        print("常用 emoji：" + " ".join(f"{e}×{c}" for e, c in emojis))
    kaomojis = Counter(k for m in messages for k in KAOMOJI_RE.findall(m)).most_common(args.top)
    if kaomojis:
        print("常用颜文字：" + " ".join(f"{k}×{c}" for k, c in kaomojis))
    tags = Counter(f"{t}:{d.strip()}" if d.strip() else t for m in messages for t, d in TAG_RE.findall(m)).most_common(args.top)
    if tags:
        print("常用表情标记：" + "，".join(f"{t}×{c}" for t, c in tags))

    section("语言构成与多语混用")
    cjk_chars = sum(len(CJK_RE.findall(m)) for m in messages)
    kana_chars = sum(len(KANA_RE.findall(m)) for m in messages)
    hangul_chars = sum(len(HANGUL_RE.findall(m)) for m in messages)
    latin_chars = sum(len(w) for m in messages for w in LATIN_WORD_RE.findall(m))
    total_script_chars = cjk_chars + kana_chars + hangul_chars + latin_chars
    parts = []
    if cjk_chars:
        parts.append(f"汉字 {pct(cjk_chars, total_script_chars)}")
    if kana_chars:
        parts.append(f"假名 {pct(kana_chars, total_script_chars)}")
    if hangul_chars:
        parts.append(f"谚文 {pct(hangul_chars, total_script_chars)}")
    if latin_chars:
        parts.append(f"拉丁字母 {pct(latin_chars, total_script_chars)}")
    ea_only = sum(bool(EAST_ASIAN_RE.search(m)) and not bool(LATIN_WORD_RE.search(m)) for m in messages)
    latin_only = sum(bool(LATIN_WORD_RE.search(m)) and not bool(EAST_ASIAN_RE.search(m)) for m in messages)
    mixed = sum(bool(EAST_ASIAN_RE.search(m)) and bool(LATIN_WORD_RE.search(m)) for m in messages)
    print("字符构成：" + ("，".join(parts) if parts else "无明确文字"))
    print(f"消息分布：纯东亚文字 {pct(ea_only, total)}，纯拉丁/英文 {pct(latin_only, total)}，混用 {pct(mixed, total)}")

    phrases, min_count = catchphrases(messages, args.top)
    section(f"口头禅候选（至少出现在 {min_count} 条发言中）")
    print("，".join(f"{g} {pct(c, total)}（{c}）" for g, c in phrases) or "无")


if __name__ == "__main__":
    main()
