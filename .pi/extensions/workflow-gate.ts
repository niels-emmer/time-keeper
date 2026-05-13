import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

type Phase = "idle" | "research" | "plan" | "build" | "verify";
type SuggestedExecutor = "parent" | "repo-governor" | "local-builder" | "local-reviewer";
type Complexity = "trivial" | "bounded" | "nontrivial" | "risky";

type WorkflowState = {
	active: boolean;
	prompt: string;
	phase: Phase;
	complexity: Complexity;
	suggestedExecutor: SuggestedExecutor;
	planRequired: boolean;
	approvalGranted: boolean;
	buildStarted: boolean;
	verifyAttempted: boolean;
	verifyPassed: boolean | null;
	risky: boolean;
	riskyMutationConfirmed: boolean;
	mutatedPaths: string[];
	verificationCommands: string[];
};

const APPROVAL_RE = /^(go|approved?|proceed|continue|implement|do it|ship it|sounds good|looks good|yes)\b/i;
const REVIEW_RE = /\b(review|audit|sanity check|double-check|check this|look over|critique)\b/i;
const GOVERNANCE_RE = /\b(governance|agents?\.md|agentic memory|memory docs?|repo docs?|documentation alignment|align docs?|routing index|pi structure|pi governance)\b/i;
const RISKY_RE = /\b(auth|authentication|token|bearer|security|schema|migration|database|sqlite|storage|persistence|middleware|api surface|api route|route contract|trust boundary|permission)\b/i;
const NONTRIVIAL_RE = /\b(implement|feature|refactor|debug|diagnose|investigate|plan|design|architecture|workflow|extension|subagent|build agent|orchestrator|verify|test strategy|audit system)\b/i;
const BOUNDED_BUILD_RE = /\b(fix|update|edit|change|rename|refactor|test|docs?|readme|contributing|agents?\.md|prompt|extension)\b/i;
const MUTATING_BASH_RE = /(\bmkdir\b|\brm\b|\bmv\b|\bcp\b|\btouch\b|\bchmod\b|\bchown\b|\bpatch\b|\bgit\s+apply\b|\bsed\s+-i\b|\bperl\s+-pi\b|\btee\b|\bcat\b\s*>|\becho\b.*>|\bpython\b.*write\(|\bnode\b.*writeFile\()/i;
const VERIFY_BASH_RE = /\b(test|vitest|jest|pytest|cargo test|go test|build|lint|check|validate|typecheck)\b/i;
const RESEARCH_BASH_RE = /\b(ls|find|rg|grep|git diff|git status|git show|git log)\b/i;

function createIdleState(): WorkflowState {
	return {
		active: false,
		prompt: "",
		phase: "idle",
		complexity: "trivial",
		suggestedExecutor: "parent",
		planRequired: false,
		approvalGranted: false,
		buildStarted: false,
		verifyAttempted: false,
		verifyPassed: null,
		risky: false,
		riskyMutationConfirmed: false,
		mutatedPaths: [],
		verificationCommands: [],
	};
}

function normalize(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

function isShortApproval(text: string): boolean {
	const normalized = normalize(text);
	return normalized.split(" ").length <= 6 && APPROVAL_RE.test(normalized);
}

function classifyPrompt(text: string): WorkflowState {
	const normalized = normalize(text);
	const lower = normalized.toLowerCase();
	const risky = RISKY_RE.test(lower);
	const governance = GOVERNANCE_RE.test(lower);
	const review = REVIEW_RE.test(lower);
	const boundedBuild = BOUNDED_BUILD_RE.test(lower);
	const nontrivial = risky || NONTRIVIAL_RE.test(lower) || normalized.length > 180;

	let suggestedExecutor: SuggestedExecutor = "parent";
	if (governance) suggestedExecutor = "repo-governor";
	else if (review && !risky) suggestedExecutor = "local-reviewer";
	else if (boundedBuild && !risky) suggestedExecutor = "local-builder";

	let complexity: Complexity = "trivial";
	if (risky) complexity = "risky";
	else if (nontrivial) complexity = "nontrivial";
	else if (suggestedExecutor !== "parent") complexity = "bounded";

	return {
		active: true,
		prompt: normalized,
		phase: nontrivial ? "research" : "idle",
		complexity,
		suggestedExecutor,
		planRequired: risky || nontrivial,
		approvalGranted: false,
		buildStarted: false,
		verifyAttempted: false,
		verifyPassed: null,
		risky,
		riskyMutationConfirmed: false,
		mutatedPaths: [],
		verificationCommands: [],
	};
}

function isMutatingToolCall(event: { toolName: string; input: Record<string, unknown> }): boolean {
	if (event.toolName === "edit" || event.toolName === "write") return true;
	if (event.toolName !== "bash") return false;
	const command = typeof event.input.command === "string" ? event.input.command : "";
	return MUTATING_BASH_RE.test(command);
}

function isVerificationToolCall(event: { toolName: string; input: Record<string, unknown> }): boolean {
	if (event.toolName !== "bash") return false;
	const command = typeof event.input.command === "string" ? event.input.command : "";
	return VERIFY_BASH_RE.test(command);
}

function isResearchToolCall(event: { toolName: string; input: Record<string, unknown> }): boolean {
	if (event.toolName === "read") return true;
	if (event.toolName !== "bash") return false;
	const command = typeof event.input.command === "string" ? event.input.command : "";
	return RESEARCH_BASH_RE.test(command);
}

function extractPaths(event: { toolName: string; input: Record<string, unknown> }): string[] {
	if (event.toolName === "edit" || event.toolName === "write" || event.toolName === "read") {
		const path = typeof event.input.path === "string" ? event.input.path : "";
		return path ? [path] : [];
	}
	if (event.toolName !== "bash") return [];
	const command = typeof event.input.command === "string" ? event.input.command : "";
	const paths = new Set<string>();
	for (const marker of ["auth", "schema", "migration", "db/", "middleware", "routes/"]) {
		if (command.includes(marker)) paths.add(marker);
	}
	return [...paths];
}

function isRiskyPath(path: string): boolean {
	return /(auth|token|schema|migration|sqlite|database|middleware|routes\/|api\b|security)/i.test(path);
}

function summarizeState(state: WorkflowState): string[] {
	if (!state.active) return ["Workflow gate: idle"];
	const lines = [
		`Prompt: ${state.prompt}`,
		`Phase: ${state.phase}`,
		`Complexity: ${state.complexity}`,
		`Suggested executor: ${state.suggestedExecutor}`,
		`Plan required: ${state.planRequired ? "yes" : "no"}`,
		`Approval granted: ${state.approvalGranted ? "yes" : "no"}`,
		`Build started: ${state.buildStarted ? "yes" : "no"}`,
		`Verify attempted: ${state.verifyAttempted ? "yes" : "no"}`,
	];
	if (state.mutatedPaths.length > 0) lines.push(`Mutated paths: ${state.mutatedPaths.join(", ")}`);
	if (state.verificationCommands.length > 0) lines.push(`Verification: ${state.verificationCommands.join(" | ")}`);
	return lines;
}

function statusText(ctx: ExtensionContext, state: WorkflowState): string {
	const theme = ctx.ui.theme;
	if (!state.active) return theme.fg("dim", "Workflow: idle");

	const phaseColor: Record<Phase, "dim" | "accent" | "warning" | "success"> = {
		idle: "dim",
		research: "accent",
		plan: "warning",
		build: "accent",
		verify: state.verifyPassed === false ? "warning" : "success",
	};
	const executorColor: Record<SuggestedExecutor, "dim" | "accent" | "warning"> = {
		parent: "dim",
		"repo-governor": "accent",
		"local-builder": "accent",
		"local-reviewer": "warning",
	};

	let text = theme.fg(phaseColor[state.phase], `RPBV:${state.phase}`);
	text += theme.fg("dim", ` • ${state.suggestedExecutor}`);
	text = theme.fg(executorColor[state.suggestedExecutor], text);
	if (state.planRequired && !state.approvalGranted) text += theme.fg("warning", " • approval pending");
	if (state.buildStarted && !state.verifyAttempted) text += theme.fg("warning", " • verify pending");
	if (state.verifyAttempted && state.verifyPassed === true) text += theme.fg("success", " • verified");
	if (state.verifyAttempted && state.verifyPassed === false) text += theme.fg("warning", " • verify failed");
	return text;
}

function buildWorkflowGuidance(state: WorkflowState): string | null {
	if (!state.active) return null;
	const lines: string[] = [];
	lines.push("## Time Keeper Workflow Gate");
	lines.push(`- Task complexity: ${state.complexity}.`);
	lines.push(`- Suggested executor: ${state.suggestedExecutor}.`);

	if (state.suggestedExecutor === "local-builder") {
		lines.push("- If delegation helps, prefer the project-local `local-builder` for this bounded task.");
	} else if (state.suggestedExecutor === "local-reviewer") {
		lines.push("- If delegation helps, prefer the project-local `local-reviewer` for this bounded review task.");
	} else if (state.suggestedExecutor === "repo-governor") {
		lines.push("- If delegation helps, prefer the project-local `repo-governor` for governance and doc-alignment work.");
	}

	if (state.planRequired && !state.approvalGranted) {
		lines.push("- Follow Research -> Plan before Build.");
		lines.push("- Do not call mutating tools yet. First gather context, then present a concise plan and stop for user approval.");
		lines.push("- Keep the plan concrete: target files, constraints, validation, and why the chosen executor is appropriate.");
		return `\n\n${lines.join("\n")}`;
	}

	if (!state.planRequired && !state.buildStarted && state.suggestedExecutor !== "parent") {
		lines.push("- This is a bounded task. Keep the flow lightweight: brief research, do the work with the suggested executor if delegation helps, then verify.");
		return `\n\n${lines.join("\n")}`;
	}

	if (state.approvalGranted && !state.buildStarted) {
		lines.push("- Build approval has been granted.");
		lines.push("- Proceed to Build, then run the narrowest credible Verify step before finishing.");
		return `\n\n${lines.join("\n")}`;
	}

	if (state.buildStarted && !state.verifyAttempted) {
		lines.push("- Build is underway or complete.");
		lines.push("- Run Verify before you finish, and report what you ran.");
		return `\n\n${lines.join("\n")}`;
	}

	return null;
}

export default function workflowGate(pi: ExtensionAPI) {
	let state = createIdleState();

	const syncStatus = (ctx: ExtensionContext) => {
		if (!ctx.hasUI) return;
		ctx.ui.setStatus("workflow-gate", statusText(ctx, state));
	};

	const updateState = (ctx: ExtensionContext, next: Partial<WorkflowState>) => {
		state = {
			...state,
			...next,
			mutatedPaths: next.mutatedPaths ?? state.mutatedPaths,
			verificationCommands: next.verificationCommands ?? state.verificationCommands,
		};
		syncStatus(ctx);
	};

	pi.on("session_start", async (_event, ctx) => {
		state = createIdleState();
		syncStatus(ctx);
	});

	pi.on("input", async (event, ctx) => {
		if (event.source === "extension") return { action: "continue" } as const;
		const text = normalize(event.text);
		if (!text || text.startsWith("/")) return { action: "continue" } as const;

		if (state.active && state.planRequired && !state.approvalGranted && isShortApproval(text)) {
			updateState(ctx, { approvalGranted: true, phase: state.buildStarted ? "build" : "plan" });
			if (ctx.hasUI) ctx.ui.notify("Workflow gate: build approved.", "info");
			return { action: "continue" } as const;
		}

		state = classifyPrompt(text);
		syncStatus(ctx);
		if (ctx.hasUI && state.active && (state.planRequired || state.suggestedExecutor !== "parent")) {
			ctx.ui.notify(
				`Workflow gate: ${state.phase === "idle" ? "bounded" : state.phase} task • suggested ${state.suggestedExecutor}`,
				"info",
			);
		}
		return { action: "continue" } as const;
	});

	pi.on("before_agent_start", async (event) => {
		const guidance = buildWorkflowGuidance(state);
		if (!guidance) return undefined;
		return { systemPrompt: `${event.systemPrompt}${guidance}` };
	});

	pi.on("tool_call", async (event, ctx) => {
		if (!state.active) return undefined;

		if (isResearchToolCall(event) && !state.buildStarted && state.phase === "research") {
			syncStatus(ctx);
		}

		if (isVerificationToolCall(event)) {
			updateState(ctx, { phase: "verify" });
		}

		if (!isMutatingToolCall(event)) return undefined;

		if (state.planRequired && !state.approvalGranted) {
			if (!ctx.hasUI) {
				return { block: true, reason: "Workflow gate blocked file mutation until plan approval." };
			}
			const ok = await ctx.ui.confirm(
				"Workflow gate",
				"No build approval is recorded for this non-trivial task. Allow file mutation anyway?",
			);
			if (!ok) return { block: true, reason: "Blocked until build approval." };
			state.approvalGranted = true;
		}

		const paths = extractPaths(event);
		const touchesRiskySurface = state.risky || paths.some(isRiskyPath);
		if (touchesRiskySurface && !state.riskyMutationConfirmed) {
			if (!ctx.hasUI) {
				return { block: true, reason: "Workflow gate blocked risky mutation in non-interactive mode." };
			}
			const label = paths.length > 0 ? ` (${paths.join(", ")})` : "";
			const ok = await ctx.ui.confirm(
				"Risky mutation",
				`This build step touches a risky surface${label}. Continue?`,
			);
			if (!ok) return { block: true, reason: "Blocked risky mutation." };
			state.riskyMutationConfirmed = true;
		}

		const mergedPaths = [...new Set([...state.mutatedPaths, ...paths])];
		updateState(ctx, {
			phase: "build",
			buildStarted: true,
			approvalGranted: true,
			mutatedPaths: mergedPaths,
		});
		return undefined;
	});

	pi.on("tool_result", async (event, ctx) => {
		if (!state.active) return undefined;
		if (event.toolName !== "bash") return undefined;
		const command = typeof event.input.command === "string" ? event.input.command : "";
		if (!VERIFY_BASH_RE.test(command)) return undefined;
		const commands = [...state.verificationCommands, command.trim()];
		updateState(ctx, {
			phase: "verify",
			verifyAttempted: true,
			verifyPassed: !event.isError,
			verificationCommands: commands,
		});
		return undefined;
	});

	pi.on("agent_end", async (_event, ctx) => {
		if (!state.active) return;
		if (state.buildStarted && !state.verifyAttempted && ctx.hasUI) {
			ctx.ui.notify("Workflow gate: build happened without Verify. Run a narrow verification step before finishing.", "warning");
		}
		if (state.verifyAttempted && state.verifyPassed === false && ctx.hasUI) {
			ctx.ui.notify("Workflow gate: verification failed or returned an error.", "warning");
		}
		syncStatus(ctx);
	});

	pi.registerCommand("rpbv-status", {
		description: "Show current Research-Plan-Build-Verify workflow state",
		handler: async (_args, ctx) => {
			const lines = summarizeState(state);
			if (ctx.hasUI) ctx.ui.notify(lines.join("\n"), "info");
		},
	});

	pi.registerCommand("rpbv-approve", {
		description: "Approve Build for the current workflow-gated task",
		handler: async (_args, ctx) => {
			if (!state.active) {
				if (ctx.hasUI) ctx.ui.notify("Workflow gate: no active task.", "warning");
				return;
			}
			updateState(ctx, { approvalGranted: true, phase: state.buildStarted ? "build" : "plan" });
			if (ctx.hasUI) ctx.ui.notify("Workflow gate: build approved.", "info");
		},
	});

	pi.registerCommand("rpbv-reset", {
		description: "Reset the current workflow-gate state",
		handler: async (_args, ctx) => {
			state = createIdleState();
			syncStatus(ctx);
			if (ctx.hasUI) ctx.ui.notify("Workflow gate: state reset.", "info");
		},
	});
}
