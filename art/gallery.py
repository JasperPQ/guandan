"""像素扑克牌的选图画廊：J/Q/K 人像和小丑，每张两个候选。out/gallery.json + out/gallery.html。
本地查看：python -m http.server 8768 --directory art/out，打开 http://localhost:8768/gallery.html"""
from __future__ import annotations

import json
import shutil
import time

from PIL import Image

import pixellab
from cards import OUT, W, H, blank, draw_index, draw_portrait, joker, FRAME_COLOR, RANK_TEXT, load_selection

ROLE_NAME = {"K": "K（国王）", "Q": "Q（王后）", "J": "J（侍从）"}
SUIT_NAME = {"S": "黑桃", "H": "红桃", "D": "方块", "C": "梅花"}


def candidate_card(key: str, name: str) -> str:
    """把候选人像合成成整张牌（放大 4 倍）存到 out/gallery-cards/，画廊里看的是成品牌面。"""
    portrait = Image.open(OUT / "faces" / f"{name}.png").convert("RGBA")
    if key == "joker":
        card = joker(portrait, big=True)
    else:
        suit, role = key[0], key[1]
        card = blank()
        draw_portrait(card, portrait, FRAME_COLOR[suit])
        rank = {v: k for k, v in RANK_TEXT.items()}[role]
        draw_index(card, rank, suit)
    target = OUT / "gallery-cards" / f"{name}.png"
    target.parent.mkdir(exist_ok=True)
    card.resize((W * 4, H * 4), Image.NEAREST).save(target)
    return target.relative_to(OUT).as_posix()


def build() -> dict:
    selection = load_selection()
    items = []
    keys = [f"{suit}{role}" for suit in "SHDC" for role in "KQJ"] + ["joker"]
    for key in keys:
        names = sorted(p.stem for p in (OUT / "faces").glob(f"{key}-c[0-9].png"))
        chosen = selection.get(key) or (names[0] if names else None)
        title = "大小王（小王是大王去色）" if key == "joker" else f"{SUIT_NAME[key[0]]} {ROLE_NAME[key[1]]}"
        items.append({
            "id": key, "title": title, "kind": "image", "scale": 1,
            "candidates": [{"id": name.split("-")[-1], "src": candidate_card(key, name), "label": "", **({"recommended": True} if name == chosen else {})} for name in names],
        })
    return {
        "round": "faces",
        "title": "像素扑克牌 · 人像",
        "updated": time.strftime("%m-%d %H:%M"),
        "spent": pixellab.spent_usd(),
        "intro": ("掼蛋和德州共用这一副像素牌。数字牌、A、牌背是代码逐像素画的，J/Q/K 和大小王的人像是 PixelLab 画的，每张两个候选。\\n"
                  "现在牌桌上用的是标「推荐」的那张；想换就点「选这张」，都不满意就点「重画」写备注。最后把底部文字复制给我。"),
        "preview": [{"src": "deck-preview.png", "caption": "整副牌（当前选择）：四行花色 + 大小王、两种牌背、德州的筹码和庄家按钮"}],
        "items": items,
    }


if __name__ == "__main__":
    (OUT / "gallery.json").write_text(json.dumps(build(), ensure_ascii=False, indent=1))
    shutil.copyfile(pixellab.ART / "gallery.html", OUT / "gallery.html")
    print("gallery ok")
