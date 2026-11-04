#!/usr/bin/env python3
"""从 QQ Chat Exporter（QCE）导出的 JSON 中提取 TA 本人的发言，并统计样本是否够用。

用法：python3 qce_extract.py --uin <TA 的 QQ 号> --out <distill-id/corpus> <导出的 JSON 文件...>
      [--tz Asia/Shanghai] [--target 200] [--group-target 50]

- 只输出 TA 本人的消息：跳过系统消息和撤回；其他人的消息一律不输出，@ 到的人统一替换为 @某人。
- 每次运行都根据传入的全部文件重新生成输出（覆盖），同一条消息出现在多个文件里只算一次，
  所以翻倍时间窗口后把新导出的文件和旧文件一起传进来即可。
- 输出 <out>/qq.txt（每行一条，消息内换行替换为 ⏎）与 <out>/qq-timestamps.txt（ISO 8601，带时区），
  合并进 self.txt / timestamps.txt 后再跑 style_stats.py / active_hours.py。
- 按私聊、群聊分别统计「有文字的发言」条数，并提示哪一类还要把时间窗口翻倍。
只依赖 Python 3.9+ 标准库。
"""

import argparse
import json
import os
import re
import sys
from datetime import datetime
from zoneinfo import ZoneInfo

LINE_BREAK = " ⏎ "
# 图片、表情等在 content.text 中的占位符；去掉后没有文字的算作非文字消息
PLACEHOLDER_RE = re.compile(r"\[(?:图片|表情|动画表情|视频|语音|文件|转发消息|位置|名片)[^\]]*\]")


def load_messages(path):
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    chat = data.get("chatInfo") or {}
    return chat.get("type") or "unknown", chat.get("name") or os.path.basename(path), data.get("messages") or []


def is_target(sender, uins, uids):
    return str(sender.get("uin") or "") in uins or str(sender.get("uid") or "") in uids


def clean_text(content):
    text = (content.get("text") or "").strip()
    # 去掉 @ 的对象，只保留「@ 了别人」这个习惯
    for m in content.get("mentions") or []:
        name = m.get("name")
        if name:
            text = text.replace(f"@{name}", "@某人")
    return re.sub(r"\s*\n\s*", LINE_BREAK, text)


def main():
    parser = argparse.ArgumentParser(description="提取 QCE 导出中 TA 本人的发言并统计样本量")
    parser.add_argument("files", nargs="+", help="QCE 导出的 JSON 文件")
    parser.add_argument("--uin", action="append", default=[], help="TA 的 QQ 号，可重复")
    parser.add_argument("--uid", action="append", default=[], help="TA 的 UID（导出中没有 QQ 号时使用），可重复")
    parser.add_argument("--out", required=True, help="输出目录，通常是 distill-<id>/corpus")
    parser.add_argument("--tz", default="Asia/Shanghai", help="时间戳输出使用的时区")
    parser.add_argument("--target", type=int, default=200, help="TA 有文字的发言合计目标")
    parser.add_argument("--group-target", type=int, default=50, help="其中群聊发言的目标（没有共同群时忽略）")
    args = parser.parse_args()
    if not (args.uin or args.uid):
        parser.error("需要 --uin 或 --uid")
    uins, uids, tz = set(args.uin), set(args.uid), ZoneInfo(args.tz)

    seen, rows, kinds = set(), [], set()
    per_type = {"private": [0, 0], "group": [0, 0]}  # [全部发言, 有文字的发言]
    print("文件 | 类型 | TA 发言 | 有文字 | 最早 ～ 最晚")
    for path in args.files:
        chat_type, name, messages = load_messages(path)
        kind = "group" if chat_type == "group" else "private"
        kinds.add(kind)
        total = texts = 0
        first = last = None
        for msg in messages:
            if msg.get("system") or msg.get("recalled") or not is_target(msg.get("sender") or {}, uins, uids):
                continue
            key = (kind, name, msg.get("id"))
            if key in seen:
                continue
            seen.add(key)
            text = clean_text(msg.get("content") or {})
            if not text:
                continue
            ts = datetime.fromtimestamp((msg.get("timestamp") or 0) / 1000, tz)
            has_text = bool(PLACEHOLDER_RE.sub("", text).strip())
            total += 1
            texts += has_text
            first = ts if first is None or ts < first else first
            last = ts if last is None or ts > last else last
            rows.append((ts, text))
        per_type[kind][0] += total
        per_type[kind][1] += texts
        span = f"{first:%Y-%m-%d} ～ {last:%Y-%m-%d}" if first else "-"
        print(f"{os.path.basename(path)} | {'群聊' if kind == 'group' else '私聊'} | {total} | {texts} | {span}")

    os.makedirs(args.out, exist_ok=True)
    rows.sort()
    with open(os.path.join(args.out, "qq.txt"), "w", encoding="utf-8") as f:
        f.writelines(text + "\n" for _, text in rows)
    with open(os.path.join(args.out, "qq-timestamps.txt"), "w", encoding="utf-8") as f:
        f.writelines(ts.isoformat(timespec="seconds") + "\n" for ts, _ in rows)

    private_texts, group_texts = per_type["private"][1], per_type["group"][1]
    print(f"\n合计：私聊 {private_texts} 条、群聊 {group_texts} 条有文字的发言（共 {len(rows)} 条，已写入 {args.out}/qq.txt）")
    names = {"private": "私聊", "group": "群聊"}
    if private_texts + group_texts < args.target:
        todo = [names[k] for k in ("private", "group") if k in kinds]
    elif "group" in kinds and group_texts < args.group_target:
        todo = [names["group"]]
    else:
        print("样本已够，不用再导出更早的记录。")
        return
    print(f"样本不够：把{'、'.join(todo)}的时间窗口翻倍，只导出新增的那一段，再连同已有文件一起重新运行。")


if __name__ == "__main__":
    sys.exit(main())
