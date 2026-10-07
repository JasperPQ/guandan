"""像素扑克牌：用代码逐像素画出整副牌（54 张 + 牌背），J/Q/K 和大小王嵌 PixelLab 画的人像（faces.py）。
德州扑克用的筹码、庄家按钮也在这里画。掼蛋和德州共用这一套，导出到两个仓库的 public/cards-pixel/。

牌面 41×57 像素（奇数宽高，花色点能对称地落在正中）：
- 黑色描边、四角各缺一个像素做出圆角，米色牌面，右下内侧一道暗边；
- 左上角标：点阵字（2 像素粗的笔画，5×8）+ 7×7 花色；右下角是它转 180°；
- 2–10 按真牌的位置摆花色点，下半部分的点倒过来；A 中间一个大花色；
- J/Q/K、大小王：中间 24×32 的人像，四周一圈花色色框。
文件名和原来的 SVG 一致：Sa.png、H10.png、Cq.png，大王 J1.png（彩色）、小王 J2.png（黑白）。

用法：python cards.py
"""
from __future__ import annotations

import json
import pathlib

from PIL import Image, ImageOps

ART = pathlib.Path(__file__).resolve().parent
OUT = ART / "out"
TARGETS = [
    ART.parent / "apps/web/public/cards-pixel",
    ART.parent.parent / "texas-holdem/apps/web/public/cards-pixel",
]
SELECTION_FILE = ART / "selection.json"

W, H = 41, 57
INK = (28, 23, 20, 255)
FACE = (246, 238, 219, 255)
FACE_SHADE = (222, 208, 178, 255)
RED = (200, 44, 54, 255)
BLACK = (31, 26, 36, 255)
SUIT_COLOR = {"S": BLACK, "C": BLACK, "H": RED, "D": RED}
# 人像外框的颜色（和 faces.py 的配色对应）
FRAME_COLOR = {"S": (44, 58, 110, 255), "H": (168, 38, 48, 255), "D": (214, 140, 40, 255), "C": (36, 104, 62, 255)}
TRANSPARENT = (0, 0, 0, 0)

# 点阵字：5 宽 8 高，2 像素粗的笔画（"1" 3 宽）
GLYPHS = {
    "A": [".###.", "##.##", "##.##", "#####", "##.##", "##.##", "##.##", "##.##"],
    "2": [".###.", "##.##", "...##", "..##.", ".##..", "##...", "##...", "#####"],
    "3": ["####.", "...##", "...##", ".###.", "...##", "...##", "...##", "####."],
    "4": ["...##", "..###", ".####", "##.##", "#####", "...##", "...##", "...##"],
    "5": ["#####", "##...", "##...", "####.", "...##", "...##", "...##", "####."],
    "6": [".###.", "##...", "##...", "####.", "##.##", "##.##", "##.##", ".###."],
    "7": ["#####", "...##", "...##", "..##.", "..##.", ".##..", ".##..", ".##.."],
    "8": [".###.", "##.##", "##.##", ".###.", "##.##", "##.##", "##.##", ".###."],
    "9": [".###.", "##.##", "##.##", "##.##", ".####", "...##", "...##", ".###."],
    "0": [".###.", "##.##", "##.##", "##.##", "##.##", "##.##", "##.##", ".###."],
    "1": [".##", "###", ".##", ".##", ".##", ".##", ".##", ".##"],
    "J": ["..###", "...##", "...##", "...##", "...##", "##.##", "##.##", ".###."],
    "Q": [".###.", "##.##", "##.##", "##.##", "##.##", "##.##", ".###.", "...##"],
    "K": ["##.##", "##.##", "####.", "###..", "####.", "##.##", "##.##", "##.##"],
    "O": [".###.", "##.##", "##.##", "##.##", "##.##", "##.##", "##.##", ".###."],
    "E": ["#####", "##...", "##...", "####.", "##...", "##...", "##...", "#####"],
    "R": ["####.", "##.##", "##.##", "####.", "###..", "##.#.", "##.##", "##.##"],
}

# 7×7 花色
SUITS = {
    "S": ["...#...", "..###..", ".#####.", "#######", "#######", "...#...", "..###.."],
    "H": [".##.##.", "#######", "#######", "#######", ".#####.", "..###..", "...#..."],
    "D": ["...#...", "..###..", ".#####.", "#######", ".#####.", "..###..", "...#..."],
    "C": ["..###..", "..###..", "##.#.##", "#######", "##.#.##", "...#...", "..###.."],
}
# A 用的 15×15 大花色
BIG_SUITS = {
    "S": [
        ".......#.......", "......###......", ".....#####.....", "....#######....", "...#########...",
        "..###########..", ".#############.", "###############", "###############", "###############",
        ".#####.#.#####.", "..###..#..###..", ".......#.......", "......###......", ".....#####.....",
    ],
    "H": [
        "..###.....###..", ".#####...#####.", "#######.#######", "###############", "###############",
        "###############", ".#############.", "..###########..", "...#########...", "....#######....",
        ".....#####.....", "......###......", ".......#.......", "...............", "...............",
    ],
    "D": [
        ".......#.......", "......###......", ".....#####.....", "....#######....", "...#########...",
        "..###########..", ".#############.", "###############", ".#############.", "..###########..",
        "...#########...", "....#######....", ".....#####.....", "......###......", ".......#.......",
    ],
    "C": [
        ".....#####.....", "....#######....", "....#######....", "....#######....", ".....#####.....",
        "..###..#..###..", ".#####.#.#####.", "###############", "###############", ".#####.#.#####.",
        "..###..#..###..", ".......#.......", "......###......", ".....#####.....", "...............",
    ],
}

RANK_TEXT = {11: "J", 12: "Q", 13: "K", 14: "A"}
FILE_RANK = {11: "j", 12: "q", 13: "k", 14: "a"}

# 花色点的位置（左上角坐标）。左列 x=11、中列 x=17、右列 x=23；行 y=6/19/31/44（上下对称），中间行 y=25。
COLS = {"L": 11, "C": 17, "R": 23}
PIPS: dict[int, list[tuple[str, int]]] = {
    2: [("C", 6), ("C", 44)],
    3: [("C", 6), ("C", 25), ("C", 44)],
    4: [("L", 6), ("R", 6), ("L", 44), ("R", 44)],
    5: [("L", 6), ("R", 6), ("C", 25), ("L", 44), ("R", 44)],
    6: [("L", 6), ("R", 6), ("L", 25), ("R", 25), ("L", 44), ("R", 44)],
    7: [("L", 6), ("R", 6), ("C", 15), ("L", 25), ("R", 25), ("L", 44), ("R", 44)],
    8: [("L", 6), ("R", 6), ("C", 15), ("L", 25), ("R", 25), ("C", 35), ("L", 44), ("R", 44)],
    9: [("L", 6), ("R", 6), ("L", 19), ("R", 19), ("C", 25), ("L", 31), ("R", 31), ("L", 44), ("R", 44)],
    10: [("L", 6), ("R", 6), ("C", 12), ("L", 19), ("R", 19), ("L", 31), ("R", 31), ("C", 38), ("L", 44), ("R", 44)],
}


def stamp(image: Image.Image, pattern: list[str], x: int, y: int, color: tuple[int, int, int, int], flip: bool = False) -> None:
    rows = pattern[::-1] if flip else pattern
    for dy, row in enumerate(rows):
        cells = row[::-1] if flip else row
        for dx, cell in enumerate(cells):
            if cell == "#":
                image.putpixel((x + dx, y + dy), color)


def blank(face: tuple[int, int, int, int] = FACE) -> Image.Image:
    """描边、圆角、牌面底色、右下一道暗边。"""
    image = Image.new("RGBA", (W, H), TRANSPARENT)
    for y in range(H):
        for x in range(W):
            edge = x in (0, W - 1) or y in (0, H - 1)
            corner = (x in (0, W - 1)) and (y in (0, H - 1))
            if corner:
                continue
            image.putpixel((x, y), INK if edge else face)
    # 圆角处补一像素描边
    for x, y in [(1, 1), (W - 2, 1), (1, H - 2), (W - 2, H - 2)]:
        image.putpixel((x, y), INK)
    for x in range(2, W - 1):
        if image.getpixel((x, H - 2)) == face:
            image.putpixel((x, H - 2), FACE_SHADE)
    for y in range(2, H - 1):
        if image.getpixel((W - 2, y)) == face:
            image.putpixel((W - 2, y), FACE_SHADE)
    return image


def rank_glyphs(rank: int) -> list[list[str]]:
    text = RANK_TEXT.get(rank, str(rank))
    return [GLYPHS[ch] for ch in text]


def draw_index(image: Image.Image, rank: int, suit: str) -> None:
    """左上：点阵字 + 花色；右下：转 180° 再画一遍。"""
    color = SUIT_COLOR[suit]
    corner = Image.new("RGBA", (10, 19), TRANSPARENT)
    x = 1
    for glyph in rank_glyphs(rank):
        stamp(corner, glyph, x, 0, color)
        x += len(glyph[0]) + 1
    # 花色在点阵字下方居中（"10" 比较宽，花色跟着稍微右移）；离描边至少空一像素
    width = x - 2
    stamp(corner, SUITS[suit], max(1, (width - 7) // 2 + 1), 10, color)
    image.alpha_composite(corner, (1, 3))
    image.alpha_composite(corner.rotate(180), (W - 1 - 10, H - 3 - 19))


def draw_pips(image: Image.Image, rank: int, suit: str) -> None:
    color = SUIT_COLOR[suit]
    if rank == 14:
        stamp(image, BIG_SUITS[suit], 13, 21, color)
        return
    for column, y in PIPS[rank]:
        stamp(image, SUITS[suit], COLS[column], y, color, flip=y > 25)


def draw_portrait(image: Image.Image, portrait: Image.Image, frame: tuple[int, int, int, int]) -> None:
    """人像放在 24×32 的浅色底板上（x 8–31，y 12–43），上下各一道色框。
    两侧不画框线：左右角标之间只剩 25 像素宽，再加框会压到角标的花色。"""
    left, top = 8, 12
    tint = tuple(round(c * 0.18 + 246 * 0.82) for c in frame[:3]) + (255,)
    for y in range(top - 1, top + 33):
        for x in range(left, left + 24):
            border = y in (top - 1, top + 32)
            image.putpixel((x, y), frame if border else tint)
    art = fit_portrait(portrait)
    image.alpha_composite(art, (left + (24 - art.width) // 2, top + (32 - art.height)))


def fit_portrait(portrait: Image.Image) -> Image.Image:
    """PixelLab 出的是 32×32：先裁掉透明边，宽了就裁中间 24 列（不缩放，像素才不糊），高了就留下面 32 行。"""
    art = portrait.convert("RGBA")
    box = art.getchannel("A").getbbox()
    if box:
        art = art.crop(box)
    if art.width > 24:
        left = (art.width - 24) // 2
        art = art.crop((left, 0, left + 24, art.height))
    if art.height > 32:
        art = art.crop((0, art.height - 32, art.width, art.height))
    return art


def joker(portrait: Image.Image, big: bool) -> Image.Image:
    image = blank()
    color = RED if big else BLACK
    y = 3
    for ch in "JOKER":
        stamp(image, GLYPHS[ch], 2, y, color)
        y += 9
    art = portrait if big else ImageOps.grayscale(portrait.convert("RGBA")).convert("LA").convert("RGBA")
    if not big:
        # 去色后保留原来的透明区域
        art.putalpha(portrait.convert("RGBA").getchannel("A"))
    draw_portrait(image, art, RED if big else BLACK)
    return image


def back(base: tuple[int, int, int], line: tuple[int, int, int]) -> Image.Image:
    """牌背：深色底上一圈金边，里面斜格纹，正中一个小菱形。"""
    image = blank((*base, 255))
    gold = (*line, 255)
    dark = tuple(max(0, c - 40) for c in base) + (255,)
    for y in range(4, H - 4):
        for x in range(4, W - 4):
            border = x in (4, W - 5) or y in (4, H - 5)
            if border:
                image.putpixel((x, y), gold)
            elif ((x + y) % 6 == 0 or (x - y) % 6 == 0):
                image.putpixel((x, y), dark)
    stamp(image, SUITS["D"], 17, 25, gold)
    return image


def chip(color: tuple[int, int, int], size: int = 13) -> Image.Image:
    """筹码（俯视）：圆片、四段白边、中间一圈。"""
    image = Image.new("RGBA", (size, size), TRANSPARENT)
    c = (size - 1) / 2
    for y in range(size):
        for x in range(size):
            d = ((x - c) ** 2 + (y - c) ** 2) ** 0.5
            if d > c + 0.3:
                continue
            if d > c - 0.7:
                image.putpixel((x, y), INK)
            elif d > c - 2.5 and ((abs(x - c) < 1.2) or (abs(y - c) < 1.2)):
                image.putpixel((x, y), (250, 246, 236, 255))
            elif abs(d - (c - 3.6)) < 0.5:
                image.putpixel((x, y), tuple(max(0, v - 50) for v in color) + (255,))
            else:
                image.putpixel((x, y), (*color, 255))
    return image


def dealer_button(size: int = 15) -> Image.Image:
    image = chip((250, 244, 228), size)
    stamp(image, ["##.", "#.#", "#.#", "#.#", "##."], size // 2 - 1, size // 2 - 2, INK)
    return image


def poker_table(width: int = 222, height: int = 120) -> Image.Image:
    """德州扑克的椭圆牌桌（像素画，网页里整数倍放大）：外圈黑边、木质桌沿（上亮下暗）、
    一道金色细线、深绿毡面（2×2 格纹）、毡面上一圈浅色压线。"""
    image = Image.new("RGBA", (width, height), TRANSPARENT)
    cx, cy = (width - 1) / 2, (height - 1) / 2
    rx, ry = cx, cy
    felt, felt_2 = (31, 92, 64, 255), (27, 82, 57, 255)
    line = (58, 128, 92, 255)
    wood, wood_hi, wood_lo = (111, 79, 55, 255), (154, 112, 80, 255), (78, 54, 36, 255)
    gold = (214, 172, 84, 255)
    for y in range(height):
        for x in range(width):
            d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2
            if d > 1:
                continue
            # 到外圈的距离（按纵向像素粗略换算）
            depth = (1 - d ** 0.5) * min(rx, ry)
            if depth < 1.2:
                color = INK
            elif depth < 6.5:
                color = wood_hi if y < cy - ry * 0.35 else wood_lo if y > cy + ry * 0.45 else wood
            elif depth < 7.6:
                color = gold
            elif depth < 8.6:
                color = INK
            elif abs(depth - 15) < 0.55:
                color = line
            else:
                color = felt if (x // 2 + y // 2) % 2 == 0 else felt_2
            image.putpixel((x, y), color)
    return image


def load_selection() -> dict[str, str]:
    return json.loads(SELECTION_FILE.read_text()) if SELECTION_FILE.exists() else {}


def portrait_for(key: str, selection: dict[str, str]) -> Image.Image:
    """选定的人像；还没选时先用第一个候选。"""
    name = selection.get(key) or f"{key}-c1"
    path = OUT / "faces" / f"{name}.png"
    if not path.exists():  # 人像还没生成好时先留空
        return Image.new("RGBA", (24, 32), TRANSPARENT)
    return Image.open(path).convert("RGBA")


def build() -> dict[str, Image.Image]:
    selection = load_selection()
    cards: dict[str, Image.Image] = {}
    for suit in "SHDC":
        for rank in range(2, 15):
            image = blank()
            if rank in (11, 12, 13):
                draw_portrait(image, portrait_for(f"{suit}{RANK_TEXT[rank]}", selection), FRAME_COLOR[suit])
            else:
                draw_pips(image, rank, suit)
            draw_index(image, rank, suit)
            cards[f"{suit}{FILE_RANK.get(rank, rank)}"] = image
    jester = portrait_for("joker", selection)
    cards["J1"] = joker(jester, big=True)
    cards["J2"] = joker(jester, big=False)
    cards["back"] = back((140, 34, 44), (232, 190, 92))
    cards["back-blue"] = back((38, 62, 126), (232, 190, 92))
    for name, color in {"chip-red": (200, 44, 54), "chip-blue": (44, 92, 180), "chip-green": (40, 140, 80), "chip-black": (40, 36, 48)}.items():
        cards[name] = chip(color)
    cards["dealer"] = dealer_button()
    return cards


POKER_ASSETS = ART.parent.parent / "texas-holdem/apps/web/src/assets/pixel"


def main() -> None:
    cards = build()
    for target in TARGETS:
        target.mkdir(parents=True, exist_ok=True)
        for name, image in cards.items():
            if name.startswith(("chip-", "dealer")):
                continue
            image.save(target / f"{name}.png", optimize=True)
    # 德州扑克样式表里直接引用的图（筹码、庄家按钮、牌背、牌桌）放进 src/assets，由打包工具处理路径
    POKER_ASSETS.mkdir(parents=True, exist_ok=True)
    for name in ["chip-red", "chip-blue", "chip-green", "chip-black", "dealer", "back"]:
        cards[name].save(POKER_ASSETS / f"{name}.png", optimize=True)
    poker_table().save(POKER_ASSETS / "table.png", optimize=True)
    # 预览：整副牌排成一张大图
    sheet = Image.new("RGBA", ((W + 3) * 13 + 3, (H + 3) * 5 + 3), (36, 92, 66, 255))
    for row, suit in enumerate("SHDC"):
        for column, rank in enumerate(range(2, 15)):
            sheet.alpha_composite(cards[f"{suit}{FILE_RANK.get(rank, rank)}"], (3 + column * (W + 3), 3 + row * (H + 3)))
    for column, name in enumerate(["J1", "J2", "back", "back-blue"]):
        sheet.alpha_composite(cards[name], (3 + column * (W + 3), 3 + 4 * (H + 3)))
    for column, name in enumerate(["chip-red", "chip-blue", "chip-green", "chip-black", "dealer"]):
        sheet.alpha_composite(cards[name], (3 + (5 + column) * (W + 3), 3 + 4 * (H + 3) + 20))
    OUT.mkdir(exist_ok=True)
    sheet.resize((sheet.width * 3, sheet.height * 3), Image.NEAREST).save(OUT / "deck-preview.png")
    print("ok", len(cards), "张 →", ", ".join(str(t) for t in TARGETS))


if __name__ == "__main__":
    main()
