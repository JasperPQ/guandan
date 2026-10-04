import { useState } from "react";

function GameRules() {
  const [open, setOpen] = useState(false);
  return (
    <section className={open ? "game-rules open" : "game-rules"}>
      <button className="game-rules-toggle" type="button" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
        <span aria-hidden="true">✦</span> 游戏规则 <i aria-hidden="true">{open ? "收起 ▴" : "展开 ▾"}</i>
      </button>
      {open && (
        <div className="game-rules-panel">
          <div className="game-rules-block">
            <h3>目标</h3>
            <p>4 人两队，对家是队友。每局按庄家队的级数打，从 2 打起；头游所在的队升级，先打过 <b>A</b> 的队获胜。</p>
            <h3>大小与逢人配</h3>
            <p>大王 &gt; 小王 &gt; 级牌 &gt; A &gt; K … 2。两张<b>红桃级牌</b>是逢人配，可当除王以外的任何牌。</p>
          </div>
          <div className="game-rules-block">
            <h3>牌型</h3>
            <ul>
              <li>单张、对子、三同张、三带二（带一对）</li>
              <li>顺子：恰好 5 张；三连对：3 个连对；钢板：2 个连续三张</li>
              <li>炸弹：4 张及以上同点数；同花顺；天王炸（四个王）</li>
              <li>炸弹大小：天王炸 &gt; 6 张及以上炸弹 &gt; 同花顺 &gt; 5 张炸 &gt; 4 张炸</li>
            </ul>
          </div>
          <div className="game-rules-block">
            <h3>升级</h3>
            <ul>
              <li>头游 + 二游升 3 级，头游 + 三游升 2 级，头游 + 末游升 1 级</li>
              <li>打自己的 A 时，拿头游且队友不是末游即获胜</li>
            </ul>
            <h3>进贡</h3>
            <ul>
              <li>末游把最大的牌贡给头游，双下时两人都贡；收贡者还一张 10 以下的牌</li>
              <li>进贡方手里有两张大王时可抗贡</li>
            </ul>
          </div>
        </div>
      )}
    </section>
  );
}

export default GameRules;
