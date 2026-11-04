#!/usr/bin/env python3
"""从发言、提交等时间戳统计作息，给出 active_hours 与 weekend_factor 的建议值。

用法：python3 active_hours.py <timestamps.txt> [--tz Asia/Shanghai] [--threshold 0.4]

输入：每行一个时间，支持 ISO 8601（2025-03-02T23:41:00+08:00、2025-03-02T15:41:00Z、
git log --date=iso 的 2025-03-02 23:41:00 +0800）和 Unix 时间戳（秒或毫秒）。
不带时区的时间按 --tz 理解。空行与 # 开头的行忽略。只依赖 Python 3.9+ 标准库。
"""

import argparse
import re
from collections import Counter
from datetime import datetime, timedelta, timezone

from zoneinfo import ZoneInfo


def parse(line, tz):
    """返回 (带时区的时间, 原始时区偏移或 None)"""
    s = line.strip()
    if re.fullmatch(r"\d{10}(\d{3})?", s):
        seconds = int(s) / (1000 if len(s) == 13 else 1)
        return datetime.fromtimestamp(seconds, timezone.utc), None
    s = re.sub(r"\s*Z$", "+00:00", s)
    s = re.sub(r"\s*([+-])(\d{2}):?(\d{2})$", r"\1\2:\3", s)  # " +0800" → "+08:00"
    s = s.replace("/", "-")
    dt = datetime.fromisoformat(s.replace(" ", "T", 1) if "T" not in s else s)
    if dt.tzinfo is None:
        return dt.replace(tzinfo=tz), None
    return dt, dt.utcoffset()


def fmt_offset(delta):
    minutes = int(delta.total_seconds() // 60)
    sign = "+" if minutes >= 0 else "-"
    minutes = abs(minutes)
    return f"{sign}{minutes // 60:02d}:{minutes % 60:02d}"


def suggest_hours(counts, threshold):
    """计数不低于最大值 × threshold 的小时视为活跃，相邻的合并为区间（可跨零点）"""
    peak = max(counts)
    active = [c >= peak * threshold for c in counts]
    # 两段活跃时间之间只差一个有记录的小时时连起来，避免 21-22,23-2 这样的碎片
    active = [a or (counts[h] > 0 and active[h - 1] and active[(h + 1) % 24]) for h, a in enumerate(active)]
    if all(active):
        return "", []
    # 从一个不活跃的小时开始转一圈，跨零点的区间不会被拆开；区间为 [起, 止)，止为 0 时写成 24
    start = active.index(False)
    ranges, run = [], None
    for i in range(1, 25):
        h = (start + i) % 24
        if active[h] and run is None:
            run = h
        elif not active[h] and run is not None:
            ranges.append((run, h))
            run = None
    ranges.sort()
    weights = [sum(counts[(a + k) % 24] for k in range((b - a) % 24)) for a, b in ranges]
    spec = ",".join(f"{a}-{b or 24}" for a, b in ranges)
    return spec, list(zip(ranges, weights))


def main():
    parser = argparse.ArgumentParser(description="从时间戳统计作息")
    parser.add_argument("file", help="每行一个时间的文本文件")
    parser.add_argument("--tz", default="Asia/Shanghai", help="统计用的 IANA 时区（TA 所在地），默认 Asia/Shanghai")
    parser.add_argument("--threshold", type=float, default=0.4, help="活跃小时的阈值（相对最活跃的小时），默认 0.4")
    args = parser.parse_args()
    tz = ZoneInfo(args.tz)

    times, offsets, bad = [], Counter(), []
    with open(args.file, encoding="utf-8") as f:
        for line in f:
            if not line.strip() or line.lstrip().startswith("#"):
                continue
            try:
                dt, offset = parse(line, tz)
            except ValueError:
                bad.append(line.strip())
                continue
            times.append(dt.astimezone(tz))
            if offset is not None:
                offsets[fmt_offset(offset)] += 1
    if bad:
        print(f"跳过 {len(bad)} 行无法解析的时间，例如：{bad[0]!r}")
    if not times:
        print("没有可统计的时间")
        return

    times.sort()
    first, last = times[0].date(), times[-1].date()
    print(f"# 作息统计（{len(times)} 个时间，{first} ～ {last}，按 {args.tz}）")
    if len(times) < 50:
        print("注意：少于 50 个时间，建议值只能作为参考")

    if offsets:
        print("\n## 时间戳自带的时区偏移")
        total = sum(offsets.values())
        for off, c in offsets.most_common(5):
            print(f"{off}：{c / total * 100:.0f}%（{c}）")
        now_offset = fmt_offset(datetime.now(tz).utcoffset())
        if offsets.most_common(1)[0][0] != now_offset:
            print(f"注意：最常见的偏移与 {args.tz} 当前的 {now_offset} 不同，确认 TA 所在地后用 --tz 重新统计")

    counts = [0] * 24
    for t in times:
        counts[t.hour] += 1
    peak = max(counts)
    print("\n## 按小时分布")
    for h, c in enumerate(counts):
        bar = "█" * round(c / peak * 30) if peak else ""
        print(f"{h:02d} {bar} {c}")

    spec, ranges = suggest_hours(counts, args.threshold)
    print("\n## 建议")
    print(f"active_hours：{spec!r}" + ("（全天都很活跃）" if not spec else ""))
    in_ranges = {(a + k) % 24 for (a, b), _ in ranges for k in range((b - a) % 24)}
    secondary = [h for h, c in enumerate(counts) if h not in in_ranges and c >= peak * args.threshold / 2]
    if spec and secondary:
        print(f"次活跃的小时（未计入）：{'、'.join(f'{h} 点' for h in secondary)}，可按素材类型决定是否加上")
    if len(ranges) > 3:
        print("区间较多，可以只保留活动最多的 2～3 段：" + "，".join(
            f"{a}-{b or 24}（{w}）" for (a, b), w in sorted(ranges, key=lambda x: -x[1])))

    # 周末系数：周末日均 / 工作日日均，天数按统计区间内的日历天计算
    weekday_days = weekend_days = 0
    d = first
    while d <= last:
        if d.weekday() >= 5:
            weekend_days += 1
        else:
            weekday_days += 1
        d += timedelta(days=1)
    weekend_events = sum(t.weekday() >= 5 for t in times)
    weekday_events = len(times) - weekend_events
    if weekday_days and weekend_days and weekday_events:
        factor = (weekend_events / weekend_days) / (weekday_events / weekday_days)
        print(f"weekend_factor：{min(5.0, factor):.1f}（工作日日均 {weekday_events / weekday_days:.2f}，周末日均 {weekend_events / weekend_days:.2f}）")
    else:
        print("weekend_factor：数据不足，保持默认")
    active_days = len({t.date() for t in times})
    span_days = (last - first).days + 1
    print(f"有记录的天数：{active_days} / {span_days}，有记录的日子平均 {len(times) / active_days:.1f} 次")
    print("提示：工作类素材（git 提交、工作群）反映上班时间，逛博客往往在午休和晚上，结合社交平台的时间调整。")


if __name__ == "__main__":
    main()
