/**
 * 掼蛋的新手教程：在浏览器里按剧本走（packages/game/src/tutorial.ts），
 * 牌桌就是真正对局的 Table，咕噜嘎的对话框叠在上面；剧本走完开一局练习局，另外三个座位交给人机。
 * 不连服务器，不占房间；首页、等候房间都能进来（从等候房间进来时，房主开局会自动回到牌桌，见 App.tsx）。
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  createPracticeGame,
  createTutorialGame,
  DEFAULT_ROOM_ACCESS,
  sameCommand,
  selectionMatches,
  TUTORIAL_SELF,
  TUTORIAL_STEPS,
  tutorialActor,
  tutorialApply,
  tutorialBot,
  tutorialCanAct,
  viewForPlayer,
  type Card,
  type LobbyMember,
  type LobbyRoomSnapshot,
  type MatchAction,
  type MatchState,
  type Seat,
  type TutorialCommand,
  type TutorialStep,
} from "@guandan/game";
import Table from "./Table.js";
import { Coach, isTouchDevice, StepPips, type CoachView } from "./tutorial/Coach.js";
import { writeTutorial } from "./tutorial/storage.js";
import { useTutorial } from "./tutorial/useTutorial.js";
import { GAME_ID } from "./tutorialGame.js";

/** 自己在假房间里的成员 id：和对局里的玩家 id 一样，牌桌按它找自己。 */
const SELF_MEMBER = TUTORIAL_SELF;
const TUTORIAL_CODE = "GULU01";
const randomSeed = () => Math.floor(Math.random() * 2 ** 31);

export default function TutorialMode({ name, brand, themeToggle, waitingRoom, onExit }: {
  /** 首页填过的昵称；没填叫「新玩家」。 */
  name: string;
  brand: ReactNode;
  themeToggle: ReactNode;
  /** 从等候房间点进来的：那个房间的房间码。 */
  waitingRoom?: string | undefined;
  onExit: () => void;
}) {
  const selfName = name.trim().length >= 2 ? name.trim() : "新玩家";
  const [selection, setSelection] = useState<readonly Card[]>([]);

  const tutorial = useTutorial<MatchState, TutorialCommand, TutorialStep>({
    steps: TUTORIAL_STEPS,
    self: TUTORIAL_SELF,
    start: () => createTutorialGame(selfName),
    restart: () => createPracticeGame(selfName, randomSeed()),
    apply: (state, playerId, command) => tutorialApply(state, playerId, command),
    same: sameCommand,
    actor: tutorialActor,
    canAct: tutorialCanAct,
    bot: tutorialBot,
    // 出牌快一点，进贡还贡、准备慢一点让人看清楚
    botDelay: (state) => (state.phase === "playing" ? 1000 : 1300),
    watchDelay: (command) => (command.type === "pass" ? 900 : command.type === "fastForward" ? 600 : 1500),
  });
  const { game, step, index, practice, flash } = tutorial;
  // 每开一局练习局，牌桌重新挂载（选牌、提示从头来）
  const [table, setTable] = useState(0);
  const newPractice = () => {
    setTable((value) => value + 1);
    tutorial.newPractice();
  };

  // 走到最后一步就算学完（之后首页不再邀请）
  useEffect(() => {
    if (practice || (step?.kind === "info" && step.finale)) writeTutorial(GAME_ID, "done");
  }, [practice, step?.id]);

  function leave() {
    writeTutorial(GAME_ID, "skipped");
    onExit();
  }

  const members = useMemo<LobbyMember[]>(() => game.players.map((player, seat) => (
    player.id === TUTORIAL_SELF
      ? { id: SELF_MEMBER, name: selfName, isHost: false, connected: true, seat: seat as Seat }
      : { id: player.id, name: player.name, isHost: false, connected: true, seat: seat as Seat, bot: true }
  )), [game.players, selfName]);
  const view = useMemo(() => viewForPlayer(game, TUTORIAL_SELF), [game]);
  const room = useMemo<LobbyRoomSnapshot>(() => ({
    code: TUTORIAL_CODE,
    spectators: [],
    access: DEFAULT_ROOM_ACCESS,
    status: "playing",
    members,
    chat: [],
    voice: [],
    match: view,
  }), [view, members]);

  let coach: CoachView | null = null;
  if (step) {
    const note = isTouchDevice() && step.noteTouch ? step.noteTouch : step.note;
    const finale = step.kind === "info" && step.finale === true;
    // 先选牌再出：选对了，高亮就挪到「出牌」
    let anchor = step.anchor ?? null;
    if (step.kind === "do" && step.then) {
      for (const follow of step.then) if (selectionMatches(selection, follow.cards)) anchor = follow.anchor;
    }
    coach = {
      key: `${step.id}:${anchor ?? ""}`,
      say: step.say,
      ...(note ? { note } : {}),
      ...(flash ? { flash } : {}),
      anchor,
      focus: step.kind !== "watch",
      face: flash ? "surprised" : step.face ?? "base",
      footer: (
        <>
          <StepPips index={index} total={TUTORIAL_STEPS.length} />
          {!finale && <button className="tut-link" type="button" onClick={leave}>跳过教程</button>}
        </>
      ),
      actions: step.kind !== "info" ? null : finale ? (
        <>
          <button className="quiet-button" type="button" onClick={onExit}>结束教程</button>
          <button className="primary-button tut-main" type="button" onClick={newPractice}>开一局练习</button>
        </>
      ) : (
        <button className="primary-button tut-main" type="button" onClick={tutorial.next}>下一步 ▶</button>
      ),
    };
  }

  const onAction = (action: MatchAction) => tutorial.onCommand(action);

  return (
    <div className={practice ? "tut-practice" : "tut-script"} style={{ display: "contents" }}>
      <Table
        key={table}
        room={room}
        busy={false}
        error=""
        notice=""
        brand={brand}
        connection={
          <>
            <span className="connection-status online"><span className="connection-dot" />{practice ? "练习局" : "新手教程"}</span>
            <button className="quiet-button tut-exit" type="button" onClick={practice ? onExit : leave}>退出教程</button>
          </>
        }
        themeToggle={themeToggle}
        chat={<Checklist index={index} practice={practice} waitingRoom={waitingRoom} />}
        onAction={onAction}
        onCancelAuto={() => undefined}
        onRematch={() => undefined}
        onDissolve={() => undefined}
        watchId={SELF_MEMBER}
        onWatch={() => undefined}
        onLeave={onExit}
        selfMemberId={SELF_MEMBER}
        mode={practice ? "practice" : "tutorial"}
        onSelection={setSelection}
        {...(practice
          ? {
              finalActions: (
                <>
                  <button className="quiet-button" type="button" onClick={onExit}>结束教程</button>
                  <button className="primary-button" type="button" onClick={newPractice}>再练一局</button>
                </>
              ),
            }
          : {})}
      />
      {coach && <Coach view={coach} />}
    </div>
  );
}

/** 侧栏：剧本进行中列出这次学哪几样；练习局只留一句话。 */
function Checklist({ index, practice, waitingRoom }: { index: number; practice: boolean; waitingRoom: string | undefined }) {
  const lessons = TUTORIAL_STEPS.map((step, at) => ({ step, at })).filter(({ step }) => step.lesson);
  const done = lessons.filter(({ at }) => at < index).length;
  return (
    <section className="room-chat tut-checklist" aria-label="新手教程进度">
      {practice ? (
        <>
          <h3>练习局 <small>教程学完了</small></h3>
          <p>拿不准就点「提示」（键盘 H），我告诉你我会怎么出、为什么。打完一局可以结束，也可以再练一局。</p>
        </>
      ) : (
        <>
          <h3>新手教程 <small>{done}/{lessons.length}</small></h3>
          <ul>
            {lessons.map(({ step, at }) => {
              const nextLesson = lessons.find((item) => item.at > at)?.at ?? TUTORIAL_STEPS.length;
              const state = index >= nextLesson ? "done" : index >= at ? "now" : "";
              return (
                <li key={step.id} className={state}>
                  <i aria-hidden="true">{state === "done" ? "✓" : state === "now" ? "▶" : "·"}</i>
                  {step.lesson}
                </li>
              );
            })}
          </ul>
        </>
      )}
      {waitingRoom && <p>你还在房间 {waitingRoom} 里，房主一开局就自动回到牌桌。</p>}
    </section>
  );
}
