# -*- coding: utf-8 -*-
"""生成 EmailClaw 报告中的 4 张矢量风格示意图（PNG）。"""
import os
from PIL import Image, ImageDraw, ImageFont

CJK_PATH = "/usr/share/fonts/truetype/droid/DroidSansFallbackFull.ttf"
LAT_PATH = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
LATB_PATH = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
OUT = "report_images"
os.makedirs(OUT, exist_ok=True)

# 配色
BLUE_F, BLUE_B = "#EAF2FB", "#3F6FB0"
GREEN_F, GREEN_B = "#E8F5E9", "#4C9A52"
ORANGE_F, ORANGE_B = "#FFF3E0", "#E08A2B"
PURP_F, PURP_B = "#F3EAFB", "#8E5FB5"
GREY_F, GREY_B = "#EEEEEE", "#888888"
RED_F, RED_B = "#FDECEC", "#D05050"
ARROW = "#555555"
INK = "#1A1A1A"

_fc = {}
def _f(path, size):
    k = (path, size)
    if k not in _fc:
        _fc[k] = ImageFont.truetype(path, size)
    return _fc[k]

def is_cjk(ch):
    o = ord(ch)
    return (0x2E80 <= o <= 0x9FFF) or (0x3000 <= o <= 0x303F) or \
           (0xFF00 <= o <= 0xFFEF) or (o >= 0x20000)

def char_font(ch, size, bold):
    if is_cjk(ch):
        return _f(CJK_PATH, size)
    return _f(LATB_PATH if bold else LAT_PATH, size)

def line_metrics(d, text, size, bold):
    """混合字体下整行的宽度、最大 ascent / descent。"""
    w = 0.0; asc = 0; desc = 0
    for ch in (text or " "):
        f = char_font(ch, size, bold)
        w += d.textlength(ch, font=f)
        a, dd = f.getmetrics()
        asc = max(asc, a); desc = max(desc, dd)
    return w, asc, desc

def mtext_w(d, text, size, bold=False):
    return line_metrics(d, text, size, bold)[0]

def draw_line(d, x_left, baseline, text, size, bold, fill):
    cx = x_left
    for ch in text:
        f = char_font(ch, size, bold)
        if bold and is_cjk(ch):
            d.text((cx, baseline), ch, font=f, fill=fill, anchor="ls",
                   stroke_width=1, stroke_fill=fill)
        else:
            d.text((cx, baseline), ch, font=f, fill=fill, anchor="ls")
        cx += d.textlength(ch, font=f)

def draw_mixed_left(d, x, y_top, text, size, bold=False, fill=INK):
    _, asc, _ = line_metrics(d, text, size, bold)
    draw_line(d, x, y_top + asc, text, size, bold, fill)

def fit_size(d, lines, max_w, start, bold, min_size=12):
    s = start
    while s > min_size:
        if all(mtext_w(d, ln, s, bold) <= max_w for ln in lines):
            return s
        s -= 1
    return min_size

def text_block(d, cx, cy, text, size, fill=INK, max_w=None, bold=False, gap=6):
    lines = text.split("\n")
    if max_w:
        size = fit_size(d, lines, max_w, size, bold)
    mets = [line_metrics(d, ln, size, bold) for ln in lines]
    heights = [a + dd for (_, a, dd) in mets]
    total = sum(heights) + gap * (len(lines) - 1)
    y = cy - total / 2
    for ln, (w, asc, dd) in zip(lines, mets):
        draw_line(d, cx - w / 2, y + asc, ln, size, bold, fill)
        y += asc + dd + gap

def tw(d, text, size, bold=False):
    w, a, dd = line_metrics(d, text, size, bold)
    return w, a + dd

def box(d, x, y, w, h, text="", fill=BLUE_F, border=BLUE_B, size=22,
        bold=False, radius=14, tcolor=INK, bw=2):
    d.rounded_rectangle([x, y, x + w, y + h], radius=radius, fill=fill,
                        outline=border, width=bw)
    if text:
        text_block(d, x + w / 2, y + h / 2, text, size, fill=tcolor,
                   max_w=w - 16, bold=bold)

def ellipse(d, cx, cy, w, h, text="", fill=ORANGE_F, border=ORANGE_B, size=20):
    d.ellipse([cx - w/2, cy - h/2, cx + w/2, cy + h/2], fill=fill, outline=border, width=2)
    text_block(d, cx, cy, text, size, fill=INK, max_w=w - 18)

def arrowhead(d, x, y, ang, color, size=12):
    import math
    a1 = ang + math.radians(150); a2 = ang - math.radians(150)
    p1 = (x + size * math.cos(a1), y + size * math.sin(a1))
    p2 = (x + size * math.cos(a2), y + size * math.sin(a2))
    d.polygon([(x, y), p1, p2], fill=color)

def arrow(d, p1, p2, color=ARROW, width=3, both=False, label="", lsize=18, lbg="white"):
    import math
    x1, y1 = p1; x2, y2 = p2
    d.line([x1, y1, x2, y2], fill=color, width=width)
    ang = math.atan2(y2 - y1, x2 - x1)
    arrowhead(d, x2, y2, ang, color)
    if both:
        arrowhead(d, x1, y1, ang + math.pi, color)
    if label:
        mx, my = (x1 + x2) / 2, (y1 + y2) / 2
        w, h = tw(d, label, lsize)
        d.rectangle([mx - w/2 - 4, my - h/2 - 2, mx + w/2 + 4, my + h/2 + 4], fill=lbg)
        text_block(d, mx, my, label, lsize, fill="#333333")

def elbow(d, p1, p2, color=ARROW, width=3, label="", lsize=17, via="h"):
    """L 形连线，最后一段带箭头。via='h' 先水平再竖直。"""
    import math
    x1, y1 = p1; x2, y2 = p2
    if via == "h":
        mid = (x2, y1)
    else:
        mid = (x1, y2)
    d.line([x1, y1, mid[0], mid[1]], fill=color, width=width)
    d.line([mid[0], mid[1], x2, y2], fill=color, width=width)
    ang = math.atan2(y2 - mid[1], x2 - mid[0])
    arrowhead(d, x2, y2, ang, color)
    if label:
        lx = (x1 + mid[0]) / 2 if via == "h" else mid[0]
        ly = y1 if via == "h" else (y1 + mid[1]) / 2
        w, h = tw(d, label, lsize)
        d.rectangle([lx - w/2 - 3, ly - h/2 - 2, lx + w/2 + 3, ly + h/2 + 3], fill="white")
        text_block(d, lx, ly, label, lsize, fill="#333333")

def actor(d, cx, top, label):
    r = 16; color = "#333333"
    d.ellipse([cx - r, top, cx + r, top + 2*r], outline=color, width=3)
    by = top + 2*r
    d.line([cx, by, cx, by + 42], fill=color, width=3)          # body
    d.line([cx - 24, by + 14, cx + 24, by + 14], fill=color, width=3)  # arms
    d.line([cx, by + 42, cx - 20, by + 78], fill=color, width=3)       # leg
    d.line([cx, by + 42, cx + 20, by + 78], fill=color, width=3)       # leg
    text_block(d, cx, by + 98, label, 20, fill=INK, bold=True, max_w=180)

def canvas(w, h, title=""):
    img = Image.new("RGB", (w, h), "white")
    d = ImageDraw.Draw(img)
    if title:
        text_block(d, w/2, 34, title, 28, fill=INK, bold=True)
    return img, d

def save(img, name):
    p = os.path.join(OUT, name)
    img.save(p, dpi=(200, 200))
    print("  saved", p, img.size)

# =====================================================================
# 图 2-1  用例图
# =====================================================================
def diagram_usecase():
    W, H = 1640, 1180
    img, d = canvas(W, H, "EmailClaw 系统用例图")
    # 系统边界
    bx, by, bw, bh = 430, 95, 760, 1010
    d.rounded_rectangle([bx, by, bx+bw, by+bh], radius=18, outline="#9AA7B5", width=2)
    text_block(d, bx+bw/2, by+26, "EmailClaw 系统", 22, fill="#5A6573", bold=True)
    cx = bx + bw/2
    # 用例（椭圆）按流程纵向排列
    ucs = [
        ("UC1 邮箱连接/鉴权", 175), ("UC2 实时接收新邮件", 175),
        ("UC3 邮件解析与入库", 175),
    ]
    ew, eh = 300, 66
    y = by + 95
    pos = {}
    def put(name, yy, w=ew):
        ellipse(d, cx, yy, w, eh, name, ORANGE_F, ORANGE_B, 19)
        pos[name] = (cx, yy)
    put("UC1 邮箱连接/鉴权", by+95)
    put("UC2 实时接收新邮件", by+185)
    put("UC3 邮件解析与入库", by+275)
    # UC4/UC5 一行
    ellipse(d, cx-165, by+390, 290, 70, "UC4 规则匹配\n(命中跳过 Agent)", BLUE_F, BLUE_B, 18)
    ellipse(d, cx+165, by+390, 290, 70, "UC5 智能分类\n分类/重要性/摘要", BLUE_F, BLUE_B, 18)
    pos["UC5"] = (cx+165, by+390)
    # UC6 / UC7
    ellipse(d, cx-165, by+510, 290, 66, "UC6 重要性判断\n与推送决策", GREEN_F, GREEN_B, 18)
    ellipse(d, cx+165, by+510, 290, 66, "UC7 飞书卡片推送", GREEN_F, GREEN_B, 19)
    pos["UC7"] = (cx+165, by+510)
    # UC8 大椭圆
    ellipse(d, cx, by+635, 470, 80, "UC8 卡片交互\n已读/重点/归档/删除/纠错/详情/重新分析", PURP_F, PURP_B, 17)
    pos["UC8"] = (cx, by+635)
    # UC9 UC10
    ellipse(d, cx-150, by+760, 270, 60, "UC9 邮件搜索", PURP_F, PURP_B, 19)
    ellipse(d, cx+150, by+760, 270, 60, "UC10 规则管理", PURP_F, PURP_B, 19)
    pos["UC9"]=(cx-150,by+760); pos["UC10"]=(cx+150,by+760)
    # 用例之间的纵向衔接（虚线感用细灰线）
    seq = [(cx,by+95+eh/2,cx,by+185-eh/2),(cx,by+185+eh/2,cx,by+275-eh/2),
           (cx,by+275+eh/2,cx,by+390-35)]
    for x1,y1,x2,y2 in seq:
        d.line([x1,y1,x2,y2], fill="#BBBBBB", width=2)
    d.line([cx,by+390+35,cx,by+510-33], fill="#BBBBBB", width=2)
    d.line([cx,by+510+33,cx,by+635-40], fill="#BBBBBB", width=2)
    d.line([cx,by+635+40,cx,by+760-30], fill="#BBBBBB", width=2)

    # 左侧参与者
    actor(d, 150, 150, "邮箱服务器\n(IMAP)")
    actor(d, 150, 720, "用户")
    # 右侧参与者
    actor(d, W-150, 360, "OpenClaw\n/DeepSeek")
    actor(d, W-150, 720, "飞书平台")
    actor(d, W-150, 980, "数据库/IMAP")

    # 关联线
    arrow(d, (200, 175), (bx+90, by+185))                      # 邮箱→UC1/2/3 区
    arrow(d, (200, 175), (bx+90, by+275))
    arrow(d, (W-200, 400), (pos["UC5"][0]+150, pos["UC5"][1]), label="增强")  # OpenClaw→UC5
    arrow(d, (pos["UC7"][0]+150, pos["UC7"][1]), (W-205, 740))  # UC7→飞书
    arrow(d, (210, 760), (pos["UC9"][0]-135, pos["UC9"][1]))    # 用户→UC9
    arrow(d, (210, 760), (pos["UC8"][0]-235, pos["UC8"][1]+10)) # 用户→UC8
    arrow(d, (210, 740), (pos["UC10"][0]-135, pos["UC10"][1]))  # 用户→UC10 (approx)
    arrow(d, (pos["UC8"][0]+235, pos["UC8"][1]), (W-210, 980), label="同步")  # UC8→DB/IMAP
    save(img, "fig_usecase.png")

# =====================================================================
# 图 3-1  功能模块图
# =====================================================================
def diagram_module():
    W, H = 1660, 880
    img, d = canvas(W, H, "系统功能模块图")
    # 根节点
    rw, rh = 360, 64
    rx = W/2 - rw/2; ry = 90
    box(d, rx, ry, rw, rh, "EmailClaw 智能邮件管家", GREY_F, "#666666", 23, bold=True)
    mods = [
        ("①用户与鉴权", "·注册/登录\n·JWT 鉴权\n·IMAP 凭据加密\n·三层防御鉴权", BLUE_F, BLUE_B),
        ("②邮件接入与解析", "·多用户 IMAP 连接\n·断线重连\n·MIME 解析\n·去重(标记+DB)", GREEN_F, GREEN_B),
        ("③智能分析", "·规则引擎\n·本地规则 Agent\n·OpenClaw+大模型\n·失败自动回退", ORANGE_F, ORANGE_B),
        ("④交互与推送", "·飞书卡片推送\n·8 种按钮交互\n·先 toast 再刷新\n·真实 IMAP 同步", PURP_F, PURP_B),
        ("⑤检索与管理", "·邮件多条件搜索\n·邮件详情\n·规则 CRUD\n·用户偏好设置", RED_F, RED_B),
    ]
    n = len(mods); mw, mh = 290, 76; gap = (W - 80 - n*mw)/(n-1);
    y1 = 240
    cxs = []
    for i,(t,sub,f,b) in enumerate(mods):
        x = 40 + i*(mw+gap)
        cx = x + mw/2; cxs.append(cx)
        box(d, x, y1, mw, mh, t, f, b, 21, bold=True)
        # 子项框
        box(d, x+10, y1+mh+40, mw-20, 200, sub, "#FAFAFA", "#CCCCCC", 18, radius=10, bw=1)
    # 连线：根 → 各模块
    root_bottom = (W/2, ry+rh)
    busy = ry+rh+30
    d.line([W/2, ry+rh, W/2, busy], fill=ARROW, width=3)
    d.line([cxs[0], busy, cxs[-1], busy], fill=ARROW, width=3)  # 水平总线
    for cx in cxs:
        arrow(d, (cx, busy), (cx, y1))
    save(img, "fig_module.png")

# =====================================================================
# 图 3-2  系统架构与端到端数据流图
# =====================================================================
def diagram_arch():
    W, H = 1560, 1480
    img, d = canvas(W, H, "系统架构与端到端数据流图")
    # 主后端（大框，右上）
    bex, bey, bew, beh = 700, 110, 760, 560
    box(d, bex, bey, bew, beh, "", BLUE_F, BLUE_B, 20, radius=16, bw=3)
    text_block(d, bex+bew/2, bey+34, "主后端服务 (:3000)", 24, fill=BLUE_B, bold=True)
    box(d, bex+40, bey+70, bew-80, 56, "UserMailbox ── ImapManager", "white", "#9AB", 19, radius=10, bw=1)
    text_block(d, bex+bew/2, bey+158, "↓ onIncomingEmail", 18, fill="#555")
    # processIncomingEmail 流水线
    box(d, bex+40, bey+185, bew-80, 340, "", "white", "#9AB", 18, radius=10, bw=1)
    text_block(d, bex+bew/2, bey+212, "processIncomingEmail 流水线", 20, fill=INK, bold=True)
    steps = ["1. upsertEmail 入库", "2. notifiedAt 去重", "3. ruleEngine 规则匹配（命中跳过 Agent）",
             "4. agentService 分析（本地 / OpenClaw）", "5. feishuService 推送决策（阈值/高亮）",
             "6. markNotified 标记已处理"]
    sy = bey+250
    for s in steps:
        text_block(d, bex+bew/2, sy, s, 18, fill="#222"); sy += 44
    # 用户邮箱（左上）
    box(d, 90, 200, 300, 110, "用户邮箱\n(QQ / Gmail …)", GREEN_F, GREEN_B, 21, bold=True)
    # PostgreSQL（左中）
    box(d, 90, 430, 300, 100, "PostgreSQL\n数据库", "#FFF8E1", "#C9A227", 21, bold=True)
    # OpenClaw（左下偏上）
    box(d, 90, 590, 300, 90, "OpenClaw\n+ DeepSeek", ORANGE_F, ORANGE_B, 20, bold=True)
    # 飞书 bot（中下）
    box(d, bex, 800, bew, 150, "", PURP_F, PURP_B, 20, radius=16, bw=3)
    text_block(d, bex+bew/2, 832, "飞书机器人服务 (:3001)", 24, fill=PURP_B, bold=True)
    text_block(d, bex+bew/2, 882, "buildEmailCard → sendCard / 监听 card.action.trigger", 18, fill="#333")
    text_block(d, bex+bew/2, 916, "先 toast → 转发后端 → updateCard 刷新", 18, fill="#333")
    # 飞书用户（底部）
    box(d, bex+bew/2-160, 1110, 320, 90, "飞书用户", "#E3F2FD", "#1E88E5", 22, bold=True)

    # 连线
    arrow(d, (390, 255), (bex, bey+250), both=True, label="IMAP长连接 / 抓取·操作")
    arrow(d, (390, 470), (bex, bey+360), both=True, label="Prisma")
    elbow(d, (240, 590), (bex, bey+430), label="子进程调用", via="v")
    # 后端 → bot 推送
    arrow(d, (bex+bew/2-120, bey+beh), (bex+bew/2-120, 800), label="POST /api/notify-email")
    # bot → 后端 回调
    arrow(d, (bex+bew/2+150, 800), (bex+bew/2+150, bey+beh), color="#9467bd",
          label="POST /api/feishu/webhook")
    text_block(d, bex+bew/2+150, (800+bey+beh)/2+26, "(X-Bot-Secret)", 16, fill="#9467bd")
    # bot → 飞书用户
    arrow(d, (bex+bew/2-120, 950), (bex+bew/2-120, 1110), label="飞书 OpenAPI 发卡")
    # 飞书用户 → bot 点击
    elbow(d, (bex+bew/2+200, 1110), (bex+bew/2+200, 950), color="#1E88E5", via="v", label="点击按钮")
    save(img, "fig_arch.png")

# =====================================================================
# 图 3-5  数据库 ER 关系图
# =====================================================================
def diagram_er():
    W, H = 1560, 1120
    img, d = canvas(W, H, "数据库 ER 关系图")
    def entity(x, y, w, title, fields, fill, border):
        rh = 46; fh = 30; h = rh + fh*len(fields) + 12
        d.rounded_rectangle([x, y, x+w, y+h], radius=10, fill="white", outline=border, width=2)
        d.rounded_rectangle([x, y, x+w, y+rh], radius=10, fill=fill, outline=border, width=2)
        d.rectangle([x, y+rh-12, x+w, y+rh], fill=fill, outline=None)
        d.line([x, y+rh, x+w, y+rh], fill=border, width=2)
        text_block(d, x+w/2, y+rh/2, title, 22, fill=INK, bold=True)
        fy = y+rh+8
        for fld in fields:
            draw_mixed_left(d, x+14, fy, fld, 17, fill="#333")
            fy += fh
        return (x, y, w, h)
    # User 顶部中央
    U = entity(610, 90, 340, "User", ["id (PK)","email / password","imapPassword(加密)","feishuUserId","preferences(JSON)"], BLUE_F, BLUE_B)
    # Email 中央
    E = entity(610, 470, 340, "Email", ["id (PK)","userId (FK)","uid / messageId","subject / body","category / importance","summary / notifiedAt","isRead/Archived/Deleted"], GREEN_F, GREEN_B)
    # Classification 右
    C = entity(1080, 500, 360, "Classification", ["id (PK)","emailId (FK, 唯一)","category / confidence","reasoning / model","feedback"], ORANGE_F, ORANGE_B)
    # Rule 左上
    R = entity(90, 250, 330, "Rule", ["id (PK)","userId (FK)","conditions(JSON)","actions(JSON)","priority / isEnabled"], PURP_F, PURP_B)
    # Contact 左下
    Ct = entity(90, 620, 330, "Contact", ["id (PK)","userId (FK)","email / name","isImportant / category"], RED_F, RED_B)
    # AgentLog 底部
    A = entity(610, 930, 340, "AgentLog", ["id (PK)","userId (FK)","type / status","model / duration"], GREY_F, "#777777")

    def rel(p1, p2, l1, l2, label, via="v"):
        elbow(d, p1, p2, color="#666", via=via)
        # 端点重数标注
        if l1: draw_mixed_left(d, p1[0]+8, p1[1]-26, l1, 18, fill="#C0392B")
        if l2: draw_mixed_left(d, p2[0]+10, p2[1]-30, l2, 18, fill="#C0392B")
        if label:
            mx,my=(p1[0]+p2[0])/2,(p1[1]+p2[1])/2
            w,h=tw(d,label,16); d.rectangle([mx-w/2-3,my-h/2-2,mx+w/2+3,my+h/2+3],fill="white")
            text_block(d, mx, my, label, 16, fill="#555")
    # User 1 ── N Email
    rel((780, U[1]+U[3]), (780, E[1]), "1", "N", "拥有")
    # Email 1 ── 1 Classification
    arrow(d, (950, E[1]+90), (C[0], C[1]+90), color="#666", label="1 ── 1 分析")
    # User 1 ── N Rule
    elbow(d, (U[0], U[1]+60), (R[0]+R[2], R[1]+60), color="#666", via="h")
    draw_mixed_left(d, U[0]-26, U[1]+38, "1", 18, fill="#C0392B")
    draw_mixed_left(d, R[0]+R[2]+4, R[1]+38, "N", 18, fill="#C0392B")
    # User 1 ── N Contact
    elbow(d, (U[0], U[1]+U[3]-20), (Ct[0]+Ct[2], Ct[1]+60), color="#666", via="v")
    draw_mixed_left(d, Ct[0]+Ct[2]+4, Ct[1]+38, "N", 18, fill="#C0392B")
    # Email/User ── N AgentLog
    rel((760, E[1]+E[3]), (760, A[1]), "", "N", "审计日志")
    save(img, "fig_er.png")

if __name__ == "__main__":
    print("生成示意图…")
    diagram_usecase()
    diagram_module()
    diagram_arch()
    diagram_er()
    print("完成。")
