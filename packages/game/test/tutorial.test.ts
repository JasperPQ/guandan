import { describe, expect, it } from "vitest";
import {
	TUTORIAL_FINAL_STEP,
	TUTORIAL_SELF,
	TUTORIAL_STEPS,
	anchorVisible,
	createPracticeGame,
	createTutorialGame,
	sameCommand,
	tutorialActor,
	tutorialApply,
	tutorialBot,
	tutorialCanAct,
	type MatchState,
	type TutorialStep,
} from "../src/index.js";

const fixed = () => 0.42;

/** 按剧本走到（不含）某一步，返回那时的局面。 */
function walkTo(stopId?: string): { state: MatchState; trace: { step: TutorialStep; before: MatchState; after: MatchState }[] } {
	let state = createTutorialGame("新玩家");
	const trace: { step: TutorialStep; before: MatchState; after: MatchState }[] = [];
	for (const step of TUTORIAL_STEPS) {
		if (step.id === stopId) break;
		const before = state;
		if (step.kind === "do") state = tutorialApply(state, TUTORIAL_SELF, step.expect, fixed);
		if (step.kind === "watch") {
			for (const move of step.moves) {
				const actor = tutorialActor(state);
				if (!actor) throw new Error(`${step.id}：没有人能走`);
				state = tutorialApply(state, actor, move, fixed);
			}
		}
		trace.push({ step, before, after: state });
	}
	return { state, trace };
}

describe("新手教程剧本", () => {
	it("从头走到尾：每一步都合法，高亮的东西那时都看得见", () => {
		const { trace } = walkTo();
		for (const { step, before, after } of trace) {
			if (step.kind === "do") {
				if (before.phase === "playing") expect(tutorialActor(before), step.id).toBe(TUTORIAL_SELF);
				expect(tutorialCanAct(before, TUTORIAL_SELF), step.id).toBe(true);
			}
			if (!step.anchor) continue;
			// 看对手走：锚点可以是走完才出现的东西；其余步骤在做之前就要看得见
			const state = step.kind === "watch" ? after : before;
			expect(anchorVisible(state, step.anchor), `${step.id} 的锚点 ${step.anchor}`).toBe(true);
			if (step.kind === "do" && step.then) {
				for (const follow of step.then) expect(anchorVisible(before, follow.anchor), `${step.id} 的 then ${follow.anchor}`).toBe(true);
			}
		}
	});

	it("关键几幕一定发生", () => {
		// 逢人配：红桃 5 在手里
		expect(walkTo("wild").state.hand.hands[0]!.some((card) => card.id === "a0-H5")).toBe(true);
		// 双上：队友头游、你二游，升 3 级 5 → 8
		const result = walkTo("result").state;
		expect(result.phase).toBe("handOver");
		expect(result.lastResult?.finishOrder.slice(0, 2)).toEqual([2, 0]);
		expect(result.lastResult?.upgrade).toBe(3);
		expect(result.teamLevels).toEqual([8, 3]);
		// 进贡：大王给头游（队友），级牌 8 给你；进贡的咕噜一号先出
		const resist = walkTo("resist").state;
		expect(resist.phase).toBe("playing");
		expect(resist.hand.level).toBe(8);
		expect(resist.hand.tribute?.transfers.map((transfer) => [transfer.from, transfer.to, transfer.card.rank])).toEqual([[1, 2, 17], [3, 0, 8]]);
		expect(resist.hand.tribute?.returns.map((transfer) => [transfer.from, transfer.to, transfer.card.rank])).toEqual([[2, 1, 5], [0, 3, 3]]);
		expect(resist.hand.turn).toBe(1);
		// 过 A：赢下整场
		const end = walkTo("win").state;
		expect(end.phase).toBe("finished");
		expect(end.winnerTeam).toBe(0);
	});

	it("剧本本身：id 不重复，结尾一步在最后，每步都有话", () => {
		const ids = TUTORIAL_STEPS.map((step) => step.id);
		expect(new Set(ids).size).toBe(ids.length);
		const finales = TUTORIAL_STEPS.filter((step) => step.kind === "info" && step.finale);
		expect(finales.map((step) => step.id)).toEqual([TUTORIAL_FINAL_STEP]);
		expect(TUTORIAL_STEPS.at(-1)?.id).toBe(TUTORIAL_FINAL_STEP);
		for (const step of TUTORIAL_STEPS) {
			expect(step.say.length, step.id).toBeGreaterThan(0);
			// 补充最多两句
			expect((step.note ?? "").split("。").filter(Boolean).length, step.id).toBeLessThanOrEqual(3);
		}
	});

	it("按错的不算：sameCommand 只认剧本那一手", () => {
		const step = TUTORIAL_STEPS.find((candidate) => candidate.id === "lead")!;
		if (step.kind !== "do") throw new Error("lead 应该是 do");
		expect(sameCommand(step.expect, { type: "play", cardIds: ["a0-DQ", "a0-HJ", "a0-H5", "a0-S9", "a0-C8"] })).toBe(true);
		expect(sameCommand(step.expect, { type: "play", cardIds: ["a0-S3", "a0-D3"] })).toBe(false);
		expect(sameCommand(step.expect, { type: "pass" })).toBe(false);
	});

	it("练习局交给人机：120 局都能打完一局，没有卡住", () => {
		let stuck = 0;
		for (let game = 0; game < 120; game += 1) {
			let state = createPracticeGame("新玩家", game + 1);
			let steps = 0;
			while (state.phase !== "handOver" && state.phase !== "finished" && steps < 2000) {
				const actor = tutorialActor(state);
				if (!actor) break;
				const command = tutorialBot(state, actor);
				if (!command) break;
				state = tutorialApply(state, actor, command, fixed);
				steps += 1;
			}
			if (state.phase !== "handOver") stuck += 1;
		}
		expect(stuck).toBe(0);
	});
});
