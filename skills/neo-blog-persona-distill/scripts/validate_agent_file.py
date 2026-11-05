#!/usr/bin/env python3
"""校验 neo-blog AI 用户导入文件：一个 AI 用户为一个 JSON 对象，多个为对象数组。

用法：python3 validate_agent_file.py <file.json>

错误（error）会导致导入失败；警告（warning）不会，但导入时会被截断、截到范围边界、忽略，或者影响效果。
规则与博客后端一致（internal/service/ai_agent.go 的 normalizeAgentProfile、newAIUser、parseActiveHours）。
只依赖 Python 3.9+ 标准库。
"""

import json
import re
import sys
from urllib.parse import urlparse

try:
    from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
except ImportError:  # Python < 3.9
    ZoneInfo = None

MAX_AGENTS = 200
TIERS = ("ambient", "expert")
DEFAULT_COLORS = ("blue", "green", "orange", "red", "rose", "pink", "violet", "yellow")
TRIGGERS = ("browse", "post.published", "comment.replied")
SELF_EDIT_FIELDS = ("avatar", "background", "nickname", "preferred_color")

# 字段类型与范围：(类型, 最小值, 最大值)；文字为 (str, 最大长度)；数组为 (list, 最多条数, 每条最大长度)
TEXT_FIELDS = {"archetype": 40, "persona": 2000, "tone": 200, "model_override": 128}
LIST_FIELDS = {"interests": (30, 30), "expertise": (30, 30), "blocked_topics": (30, 30), "style_samples": (10, 200)}
OBJECT_FIELDS = {
    "activity": {
        "daily_actions": ("number", 0, 48),
        "active_hours": ("str",),
        "timezone": ("str",),
        "weekend_factor": ("number", 0, 5),
    },
    "behavior": {
        "lurk": ("number", 0, 1),
        "like": ("number", 0, 1),
        "comment": ("number", 0, 1),
        "reply_probability": ("number", 0, 1),
        "dig_old_posts": ("number", 0, 1),
        "delay_min_minutes": ("int", 0, 1440),
        "delay_max_minutes": ("int", 0, 1440),
    },
    "limits": {
        "comments_per_day": ("int", 0, 1000),
        "likes_per_day": ("int", 0, 10000),
        "comments_per_post": ("int", 0, 100),
        "cooldown_minutes": ("int", 0, 10080),
    },
    "ai_interaction": {"enabled": ("bool",), "base_probability": ("number", 0, 1)},
    "self_edit": {"enabled": ("bool",), "fields": ("list",), "hint": ("str",)},
    "memory": {
        "remember_people": ("bool",),
        "retention_days": ("int", 0, 3650),
        "max_items": ("int", 0, 5000),
        "milestone_familiarity": ("number", 0, 1),
    },
    "web_fetch": {"enabled": ("bool",), "allowed_domains": ("list",)},
}
KNOWN_PROFILE_KEYS = set(TEXT_FIELDS) | set(LIST_FIELDS) | set(OBJECT_FIELDS) | {"triggers"}

# 常见的 AI 腔：与博客生成评论后的检查一致（internal/agentrunner/humanize.go 的 aiToneTells），示例里带这些，模型会照着说
AI_TONE_TELLS = [
    ("客套话", r"感谢(你的|您的|楼主|博主|作者)?分享|学到了|受益(匪浅|良多)|(写|讲|总结|分析)得(真|很|非常|太|好)?(好|棒|到位|清晰|透彻|详细)([^听]|$)"),
    ("总结和强调用语", r"值得(一提|注意)的是|需要注意的是|总的来说|总而言之|综上所述|总之[，,]"),
    ("固定句式", r"不仅[^。！？\n]{1,24}而且|不仅[^，。！？\n]{1,20}(还|更)|不是[^，。！？\n]{1,12}而是|一方面[^。！？\n]*另一方面|首先[^。！？\n]*其次"),
    ("讲道理的腔调", r"从[^，。！？\n]{1,12}(角度|层面|维度)(来看|而言|出发|看)|让人(深思|反思|感慨|动容)|这让我(想到|想起)"),
    ("元叙述", r"(看|读)完(这篇|文章|你的|了这篇)|作为一(个|名)|我注意到"),
    ("客套收尾", r"希望[^，。！？\n]{0,20}(帮助|有用|继续)|期待(更多|后续|下一篇|你的)|加油[！!～~]*$"),
    ("先肯定再转折", r"^[^，。！？\n]{0,16}(挺|很|真|确实|非常)(对|好|有道理|实用|到位|中肯|准确)[的啊呀]?[，,](不过|但是?|只是)"),
    ("破折号", r"——"),
    ("列点或标题", r"(?m)^[ \t]*(?:[-*•]|\d+[.、)）]|#{1,6})[ \t]+"),
    ("Markdown", r"\*\*.+?\*\*|`[^`]*`"),
]
# persona / tone 里的句式套路：模型会照着写成固定的三段式
STRUCTURE_TELL = r"先(肯定|夸|认可|赞同|表扬|共情)[^。；\n]{0,12}(再|然后|后)|(最后|结尾)再?(总结|升华|给出?(建议|总结))|总结(一下|收尾)|三段式"
SAMPLE_SHORT = 30  # 大多数示例应在这个字数以内
SAMPLE_LONG = 60  # 超过这个字数的示例单独提示


def ai_tone_issues(text):
    return [name for name, pattern in AI_TONE_TELLS if re.search(pattern, text.strip())]


def structure_tell(text):
    """返回 text 中没有被否定（如「不会先肯定再补充」）的句式套路"""
    for m in re.finditer(STRUCTURE_TELL, text):
        if not re.search(r"不|别|避免|很少", text[max(0, m.start() - 6):m.start()]):
            return m.group(0)
    return None


def check_speaking_style(r, path, profile):
    """说话方式的效果提示：示例评论的长度与 AI 腔、persona / tone 里的句式套路"""
    samples = profile.get("style_samples")
    if isinstance(samples, list):
        texts = [s.strip() for s in samples if isinstance(s, str) and s.strip()]
        for i, s in enumerate(samples):
            if not isinstance(s, str):
                continue
            issues = ai_tone_issues(s)
            if issues:
                r.warn(f"{path}.style_samples[{i}]", f"有 AI 腔（{'、'.join(issues)}）：模型会照着说，博客生成评论后也会因此要求重写；除非 TA 本人真这么说，否则改掉")
            if len(s.strip()) > SAMPLE_LONG:
                r.warn(f"{path}.style_samples[{i}]", f"偏长（{len(s.strip())} 字）：博客评论大多 5～{SAMPLE_SHORT} 字，长的示例留一两条就够")
        if len(texts) >= 3 and sum(len(t) > SAMPLE_SHORT for t in texts) * 2 > len(texts):
            r.warn(f"{path}.style_samples", f"超过一半的示例在 {SAMPLE_SHORT} 字以上，模型会照着写长评论；除非 TA 本来就话多，否则多写几条短的")
    for key in ("persona", "tone"):
        value = profile.get(key)
        tell = structure_tell(value) if isinstance(value, str) else None
        if tell:
            r.warn(f"{path}.{key}", f"写了句式套路「{tell}」：模型会照着写成固定的三段式；改成描述习惯（长度、句末、语气词、频率），除非这是 TA 一贯的说话方式")


class Report:
    def __init__(self):
        self.errors = []
        self.warnings = []

    def error(self, path, msg):
        self.errors.append(f"{path}: {msg}")

    def warn(self, path, msg):
        self.warnings.append(f"{path}: {msg}")


def is_number(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def check_url(r, path, value):
    if not isinstance(value, str):
        r.error(path, "应为字符串")
        return
    value = value.strip()
    if not value:
        return
    if value.startswith("/") and not value.startswith("//"):
        return
    parsed = urlparse(value)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        r.error(path, "应为 http(s) 地址或站内路径（/ 开头）")


def check_active_hours(r, path, spec):
    spec = spec.strip()
    if not spec:
        return
    for part in spec.split(","):
        part = part.strip()
        if not part:
            continue
        m = re.fullmatch(r"\s*(\d+)\s*-\s*(\d+)\s*", part)
        if not m or not all(0 <= int(x) <= 24 for x in m.groups()):
            r.error(path, f"时段 {part!r} 无效，格式如 9-12,20-24，小时取 0～24，跨零点写 22-2")
            return
        start, end = (int(x) for x in m.groups())
        if start % 24 == end % 24 and start == end:
            r.warn(path, f"时段 {part!r} 起止相同，是空区间")


def check_timezone(r, path, tz):
    tz = tz.strip()
    if not tz:
        return
    if ZoneInfo is None:
        r.warn(path, "当前 Python 不支持 zoneinfo，未校验时区")
        return
    try:
        ZoneInfo(tz)
    except (ZoneInfoNotFoundError, ValueError):
        r.error(path, f"无效的 IANA 时区 {tz!r}，如 Asia/Shanghai")


def check_object(r, path, name, obj):
    spec = OBJECT_FIELDS[name]
    for key, value in obj.items():
        p = f"{path}.{key}"
        if key not in spec:
            r.warn(p, "未知字段，导入时忽略")
            continue
        kind = spec[key][0]
        if kind == "bool":
            if not isinstance(value, bool):
                r.error(p, "应为 true 或 false")
        elif kind == "str":
            if not isinstance(value, str):
                r.error(p, "应为字符串")
        elif kind == "list":
            if not (isinstance(value, list) and all(isinstance(x, str) for x in value)):
                r.error(p, "应为字符串数组")
        elif kind in ("number", "int"):
            if not is_number(value):
                r.error(p, "应为数字")
                continue
            if kind == "int" and value != int(value):
                r.error(p, "应为整数")
                continue
            lo, hi = spec[key][1], spec[key][2]
            if not lo <= value <= hi:
                r.warn(p, f"超出范围 {lo}～{hi}，导入时截到边界")
    if name == "activity":
        if isinstance(obj.get("active_hours"), str):
            check_active_hours(r, f"{path}.active_hours", obj["active_hours"])
        if isinstance(obj.get("timezone"), str):
            check_timezone(r, f"{path}.timezone", obj["timezone"])
    if name == "behavior":
        lo, hi = obj.get("delay_min_minutes"), obj.get("delay_max_minutes")
        if is_number(lo) and is_number(hi) and hi < lo:
            r.warn(path, "delay_max_minutes 小于 delay_min_minutes，导入时取 min")
    if name == "self_edit" and isinstance(obj.get("fields"), list):
        unknown = [f for f in obj["fields"] if f not in SELF_EDIT_FIELDS]
        if unknown:
            r.warn(f"{path}.fields", f"{unknown} 不是可修改的字段，导入时忽略；可选 {list(SELF_EDIT_FIELDS)}")
    if name == "memory" and is_number(obj.get("milestone_familiarity")) and obj["milestone_familiarity"] <= 0:
        r.warn(f"{path}.milestone_familiarity", "不大于 0 时导入为默认值 0.6")


def check_profile(r, path, profile):
    if profile is None:
        r.warn(path, "没有性格档案，全部使用该类型的默认值")
        return
    if not isinstance(profile, dict):
        r.error(path, "应为对象")
        return
    for key, value in profile.items():
        p = f"{path}.{key}"
        if key not in KNOWN_PROFILE_KEYS:
            r.warn(p, "未知字段，导入时忽略")
        elif key in TEXT_FIELDS:
            if not isinstance(value, str):
                r.error(p, "应为字符串")
            elif len(value.strip()) > TEXT_FIELDS[key]:
                r.warn(p, f"超过 {TEXT_FIELDS[key]} 字，导入时截断")
        elif key in LIST_FIELDS:
            max_items, max_len = LIST_FIELDS[key]
            if not (isinstance(value, list) and all(isinstance(x, str) for x in value)):
                r.error(p, "应为字符串数组")
                continue
            items = [x.strip() for x in value if x.strip()]
            if len(set(items)) != len(items):
                r.warn(p, "有重复项，导入时去重")
            if len(items) > max_items:
                r.warn(p, f"超过 {max_items} 条，导入时只保留前 {max_items} 条")
            for i, item in enumerate(items):
                if len(item) > max_len:
                    r.warn(f"{p}[{i}]", f"超过 {max_len} 字，导入时截断")
        elif key == "triggers":
            if not (isinstance(value, list) and all(isinstance(x, str) for x in value)):
                r.error(p, "应为字符串数组")
                continue
            unknown = [t for t in value if t not in TRIGGERS]
            if unknown:
                r.warn(p, f"{unknown} 不是有效的唤醒方式，导入时忽略；可选 {list(TRIGGERS)}")
            if not [t for t in value if t in TRIGGERS]:
                r.warn(p, "没有任何唤醒方式，这个 AI 用户永远不会行动；不确定时省略该字段")
        elif key in OBJECT_FIELDS:
            if not isinstance(value, dict):
                r.error(p, "应为对象")
            else:
                check_object(r, p, key, value)

    # 效果提示：不影响导入
    persona = profile.get("persona")
    if not isinstance(persona, str) or len(persona.strip()) < 80:
        r.warn(f"{path}.persona", "人设缺失或太短（建议 200～600 字），说话会很像默认风格")
    samples = profile.get("style_samples")
    if not isinstance(samples, list) or len(samples) < 3:
        r.warn(f"{path}.style_samples", "示例评论少于 3 条，风格不容易稳定（建议 5～10 条）")
    check_speaking_style(r, path, profile)
    if not profile.get("interests"):
        r.warn(f"{path}.interests", "没有兴趣词，推荐文章时无法按兴趣匹配")


def check_agent(r, path, agent, seen):
    """path 为单个对象时是 $，数组时是 [i]"""
    if not isinstance(agent, dict):
        r.error(path, "应为对象")
        return
    username = agent.get("username")
    if not isinstance(username, str) or not username.strip():
        r.error(f"{path}.username", "必填")
    else:
        u = username.strip()
        if len(u) > 20 or re.search(r"[\s/@]", u):
            r.error(f"{path}.username", "1～20 个字符，不能包含空格、/、@")
        if u in seen:
            r.error(f"{path}.username", f"与 {seen[u]} 的用户名重复")
        seen.setdefault(u, path)
    nickname = agent.get("nickname", "")
    if not isinstance(nickname, str):
        r.error(f"{path}.nickname", "应为字符串")
    elif len(nickname.strip()) > 20:
        r.error(f"{path}.nickname", "不能超过 20 个字")
    for key in ("avatar_url", "background_url"):
        if key in agent:
            check_url(r, f"{path}.{key}", agent[key])
    color = agent.get("preferred_color", "")
    if not isinstance(color, str):
        r.error(f"{path}.preferred_color", "应为字符串")
    elif color.strip() and color.strip() not in DEFAULT_COLORS:
        r.warn(f"{path}.preferred_color", f"不在默认配色 {list(DEFAULT_COLORS)} 中；站点没有这个配色时导入失败")
    tier = agent.get("tier", "")
    if not isinstance(tier, str) or (tier.strip() and tier.strip() not in TIERS):
        r.error(f"{path}.tier", f"应为 {' 或 '.join(TIERS)}")
    for key in agent:
        if key not in ("username", "nickname", "avatar_url", "background_url", "preferred_color", "tier", "profile"):
            r.warn(f"{path}.{key}", "未知字段，导入时忽略")
    check_profile(r, f"{path}.profile", agent.get("profile"))


def validate(data):
    r = Report()
    if isinstance(data, dict):
        check_agent(r, "$", data, {})
        return r
    if not isinstance(data, list) or not data:
        r.error("$", "应为一个 AI 用户对象，或由多个对象组成的非空数组")
        return r
    if len(data) > MAX_AGENTS:
        r.error("$", f"一次最多导入 {MAX_AGENTS} 个")
    seen = {}
    for i, agent in enumerate(data):
        check_agent(r, f"[{i}]", agent, seen)
    return r


def main():
    if len(sys.argv) != 2:
        print(__doc__.strip().splitlines()[2])
        sys.exit(2)
    try:
        with open(sys.argv[1], encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, json.JSONDecodeError) as e:
        print(f"error: 无法读取 JSON：{e}")
        sys.exit(1)
    r = validate(data)
    for msg in r.errors:
        print(f"error: {msg}")
    for msg in r.warnings:
        print(f"warning: {msg}")
    count = 1 if isinstance(data, dict) else len(data) if isinstance(data, list) else 0
    print(f"\n{count} 个 AI 用户，{len(r.errors)} 个错误，{len(r.warnings)} 个警告")
    sys.exit(1 if r.errors else 0)


if __name__ == "__main__":
    main()
