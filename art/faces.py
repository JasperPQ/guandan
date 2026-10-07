"""像素扑克牌的人像：J / Q / K 每种花色一套（12 张），外加小丑（大小王）。
pixflux 32×32（PixelLab 画布面积不能小于 32×32）、透明背景，每张出两个候选到 out/faces/；
cards.py 合成时裁中间 24 列放进牌框。挑好后写进 selection.json。
用法：python faces.py [名字...]"""
from __future__ import annotations

import sys

import pixellab

OUT = pixellab.ART / "out" / "faces"

# 花色配色：黑桃深蓝、红桃深红、方块橙金、梅花深绿
SUIT_COLOR = {"S": "deep navy blue and black", "H": "crimson red", "D": "orange and gold", "C": "dark forest green"}
ROLE = {
    "K": "a playing card king, bearded, golden crown, holding a sword upright, wearing a {color} royal robe with ermine collar",
    "Q": "a playing card queen, golden crown, holding a single flower, wearing a {color} royal gown",
    "J": "a playing card jack, young knave with a feathered cap, holding a halberd, wearing a {color} tunic",
}
ITEMS: dict[str, str] = {}
for suit, color in SUIT_COLOR.items():
    for role, text in ROLE.items():
        ITEMS[f"{suit}{role}"] = "tiny pixel art bust portrait of " + text.format(color=color) + ", head and shoulders centered, front view, symmetrical, bold shapes"
ITEMS["joker"] = "tiny pixel art bust portrait of a grinning court jester with a three pointed hat with bells, colorful red, yellow and purple outfit, front view, symmetrical, bold shapes"


def make(name: str, seed: int) -> None:
    pixellab.generate_image(f"{name}-c{seed % 10}", {
        "description": ITEMS[name],
        "image_size": {"width": 32, "height": 32},
        "no_background": True,
        "outline": "single color black outline",
        "seed": seed,
    }, OUT)


if __name__ == "__main__":
    for name in sys.argv[1:] or list(ITEMS):
        for seed in (701, 702):
            make(name, seed)
        print(name, "done; spent", round(pixellab.spent_usd(), 4), flush=True)
