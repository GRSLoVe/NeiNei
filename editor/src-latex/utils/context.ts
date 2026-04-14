/**
 * Matemáticas: $$…$$, $…$ (MarkText inline_math), además \\(\\…\\) y \\[\\…\\] (LaTeX clásico).
 * El salto genérico \\ + carácter debe ir *después* de probar \\( y \\[, si no nunca se detectan.
 */

import { EditorState, SelectionRange } from "@codemirror/state";
import { EditorView, PluginValue, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { findMatchingBracket, getCloseBracket } from "src/utils/editor_utils";
import { Mode } from "../snippets/options";
import { Environment } from "../snippets/environment";
import { getLatexSuiteConfig } from "../snippets/codemirror/config";
import { textAreaEnvs } from "./default_text_areas";

export interface Bounds {
	inner_start: number;
	inner_end: number;
	outer_start: number;
	outer_end: number;
}

export enum MathMode {
	InlineMath,
	BlockMath,
}

type MathBounds = Bounds & { mode: MathMode };

/** marktext/src/muya/lib/parser/rules.js — inline_math */
const RE_INLINE_MATH = /^(\$)([^\$]*?[^\$\\])(\\*)\$(?!\$)/;

function isLengthEven (str: string): boolean {
	return str.length % 2 === 0;
}

/** Siguiente `$$` no escapado desde `from` (índice del primer `$`). */
function findClosingDoubleDollar (doc: string, from: number): number {
	let j = from;
	while (j < doc.length - 1) {
		if (doc[j] === "\\" && j + 1 < doc.length) {
			j += 2;
			continue;
		}
		if (doc[j] === "$" && doc[j + 1] === "$") return j;
		j++;
	}
	return -1;
}

function tryMatchInlineMath (doc: string, i: number): MathBounds | null {
	if (doc[i] !== "$") return null;
	if (doc[i + 1] === "$") return null;
	const slice = doc.slice(i);
	const m = RE_INLINE_MATH.exec(slice);
	if (!m) return null;
	const backs = m[3] ?? "";
	if (!isLengthEven(backs)) return null;
	const full = m[0];
	const inner = m[2] + backs;
	return {
		outer_start: i,
		outer_end: i + full.length,
		inner_start: i + 1,
		inner_end: i + 1 + inner.length,
		mode: MathMode.InlineMath,
	};
}

/** Cierre `\\)` desde `from`: si `\\` va seguido de `)`, cuenta como delimitador, no como escape suelto. */
function findClosingParenDelimiter (doc: string, from: number): number {
	let j = from;
	while (j < doc.length - 1) {
		if (doc[j] === "\\" && j + 1 < doc.length) {
			if (doc[j + 1] === ")") return j;
			j += 2;
			continue;
		}
		j++;
	}
	return -1;
}

/** Cierre `\\]` (display LaTeX). */
function findClosingBracketDelimiter (doc: string, from: number): number {
	let j = from;
	while (j < doc.length - 1) {
		if (doc[j] === "\\" && j + 1 < doc.length) {
			if (doc[j + 1] === "]") return j;
			j += 2;
			continue;
		}
		j++;
	}
	return -1;
}

function tryMatchParenInlineMath (doc: string, i: number): MathBounds | null {
	if (doc[i] !== "\\" || doc[i + 1] !== "(") return null;
	const innerStart = i + 2;
	const closePos = findClosingParenDelimiter(doc, innerStart);
	if (closePos < 0) {
		return {
			outer_start: i,
			outer_end: doc.length,
			inner_start: innerStart,
			inner_end: doc.length,
			mode: MathMode.InlineMath,
		};
	}
	return {
		outer_start: i,
		outer_end: closePos + 2,
		inner_start: innerStart,
		inner_end: closePos,
		mode: MathMode.InlineMath,
	};
}

function tryMatchBracketBlockMath (doc: string, i: number): MathBounds | null {
	if (doc[i] !== "\\" || doc[i + 1] !== "[") return null;
	const innerStart = i + 2;
	const closePos = findClosingBracketDelimiter(doc, innerStart);
	if (closePos < 0) {
		return {
			outer_start: i,
			outer_end: doc.length,
			inner_start: innerStart,
			inner_end: doc.length,
			mode: MathMode.BlockMath,
		};
	}
	return {
		outer_start: i,
		outer_end: closePos + 2,
		inner_start: innerStart,
		inner_end: closePos,
		mode: MathMode.BlockMath,
	};
}

/** Display $$…$$, $…$, \\[\\…\\], \\(\\…\\). */
export function scanDollarMath (doc: string): MathBounds[] {
	const out: MathBounds[] = [];
	let i = 0;
	while (i < doc.length) {
		const paren = tryMatchParenInlineMath(doc, i);
		if (paren) {
			out.push(paren);
			i = paren.outer_end;
			continue;
		}
		const brack = tryMatchBracketBlockMath(doc, i);
		if (brack) {
			out.push(brack);
			i = brack.outer_end;
			continue;
		}
		if (doc[i] === "\\" && i + 1 < doc.length) {
			i += 2;
			continue;
		}
		if (doc[i] === "$" && doc[i + 1] === "$") {
			const innerStart = i + 2;
			const closePos = findClosingDoubleDollar(doc, innerStart);
			if (closePos >= innerStart) {
				/* `$$$$` u otro `$$` vacío: no registrar bloque (evita rangos raros); igual avanzamos. */
				if (closePos > innerStart) {
					out.push({
						outer_start: i,
						outer_end: closePos + 2,
						inner_start: innerStart,
						inner_end: closePos,
						mode: MathMode.BlockMath,
					});
				}
				i = closePos + 2;
			} else {
				out.push({
					outer_start: i,
					outer_end: doc.length,
					inner_start: innerStart,
					inner_end: doc.length,
					mode: MathMode.BlockMath,
				});
				return out;
			}
			continue;
		}
		const inl = tryMatchInlineMath(doc, i);
		if (inl) {
			out.push(inl);
			i = inl.outer_end;
			continue;
		}
		i += 1;
	}
	return out;
}

function langIfWithinCodeblock(_state: EditorState): null {
	return null;
}

const getInnerEquationBounds = (view: EditorView, pos?: number): Bounds | null => {
	if (pos === undefined) pos = view.state.selection.main.to;
	const bounds = getMathBoundsPlugin(view).inMathBound(view.state, pos);
	if (!bounds) return null;
	let text = view.state.sliceDoc(bounds.inner_start, bounds.inner_end);
	text = text.replaceAll("\\$", "\u0000");
	const rel = pos - bounds.inner_start;
	const leftRel = text.lastIndexOf("$", rel - 1);
	const rightRel = text.indexOf("$", rel);
	if (leftRel === -1 || rightRel === -1) return bounds;
	return {
		inner_start: bounds.inner_start + leftRel + 1,
		inner_end: bounds.inner_start + rightRel,
		outer_start: bounds.inner_start + leftRel,
		outer_end: bounds.inner_start + rightRel + 1,
	};
};

export const contextPlugin = ViewPlugin.fromClass(
	class Context implements PluginValue {
		view: EditorView;
		state: EditorState;
		mode: Mode;
		pos: number;
		ranges: SelectionRange[];
		codeblockLanguage: string | null = null;
		boundsCache: Map<number, Bounds | null>;
		innerBoundsCache: Map<number, Bounds | null>;

		constructor(view: EditorView) {
			this.view = view;
			this.state = view.state;
			this.mode = new Mode();
			this.pos = 0;
			this.ranges = [];
			this.boundsCache = new Map();
			this.innerBoundsCache = new Map();
			this.updateFromView(view);
		}

		update(update: ViewUpdate) {
			if (!(update.docChanged || update.selectionSet || update.viewportChanged)) return;
			this.updateFromView(update.view);
		}

		updateFromView(view: EditorView) {
			const state = view.state;
			const sel = state.selection;
			this.view = view;
			this.state = state;
			this.pos = sel.main.to;
			this.ranges = Array.from(sel.ranges).reverse();
			this.mode = new Mode();
			this.boundsCache = new Map();
			this.innerBoundsCache = new Map();
			this.codeblockLanguage = null;

			const codeBlockInfo = langIfWithinCodeblock(state);
			const codeblockLanguage = codeBlockInfo?.codeblockLanguage ?? null;
			const inCode = codeblockLanguage !== null;

			const settings = getLatexSuiteConfig(state);
			const forceMath =
				inCode && settings.forceMathLanguages.includes(codeblockLanguage);
			this.mode.codeMath = forceMath;
			this.mode.code = inCode && !forceMath ? codeblockLanguage : false;
			if (inCode && this.mode.code !== false) {
				this.codeblockLanguage = codeblockLanguage;
				this.boundsCache.set(this.pos, codeBlockInfo as Bounds);
			}

			const mathBoundsCache = getMathBoundsPlugin(view);
			const inMath = forceMath || mathBoundsCache.inMathBound(state, this.pos);

			if (inMath !== true && inMath !== null) {
				const inInlineEquation = inMath.mode === MathMode.InlineMath;
				this.mode.blockMath = !inInlineEquation;
				this.mode.inlineMath = inInlineEquation;
				this.boundsCache.set(this.pos, inMath);
			}

			if (inMath) {
				this.mode.textEnv = this.inTextEnvironment();
			}

			this.mode.text = !inCode && !inMath;
		}

		isWithinEnvironment(pos: number, envs: Environment | Environment[]): boolean {
			if (!this.mode.inMath()) return false;

			const bounds = this.getInnerBounds();
			if (!bounds) return false;

			const { inner_start: start, inner_end: end } = bounds;
			let text = this.state.sliceDoc(start, end);
			if (!Array.isArray(envs)) {
				envs = [envs];
			}
			outer_loop: for (const env of envs) {
				pos -= start;
				const openBracket = env.openSymbol.slice(-1);
				const closeBracket = getCloseBracket(openBracket);

				let offset: number;
				let openSearchSymbol: string;

				if (
					["{", "[", "("].contains(openBracket) &&
					env.closeSymbol === closeBracket
				) {
					offset = env.openSymbol.length - 1;
					openSearchSymbol = openBracket;
				} else {
					offset = 0;
					openSearchSymbol = env.openSymbol;
				}

				let left = text.lastIndexOf(env.openSymbol, pos - 1);

				while (left != -1) {
					const right = findMatchingBracket(
						text,
						left + offset,
						openSearchSymbol,
						env.closeSymbol,
						false,
					);

					if (right === -1) continue outer_loop;

					if (right >= pos && pos >= left + env.openSymbol.length) {
						return true;
					}

					if (left <= 0) continue outer_loop;

					left = text.lastIndexOf(env.openSymbol, left - 1);
				}
			}

			return false;
		}

		inTextEnvironment(): boolean {
			return this.isWithinEnvironment(this.pos, textAreaEnvs);
		}

		getBounds(pos: number = this.pos): Bounds | null {
			const cached = this.boundsCache.get(pos);
			if (cached !== undefined) {
				return cached;
			}

			let bounds: Bounds | null;
			if (this.mode.codeMath) {
				bounds = null;
			} else {
				bounds = getMathBoundsPlugin(this.view).inMathBound(this.state, pos);
			}

			this.boundsCache.set(pos, bounds);
			return bounds;
		}

		getInnerBounds(pos: number = this.pos): Bounds | null {
			const cached = this.innerBoundsCache.get(pos);
			if (cached !== undefined) {
				return cached;
			}
			let bounds: Bounds | null;
			if (this.mode.codeMath) {
				bounds = this.getBounds(pos);
			} else {
				bounds = getInnerEquationBounds(this.view, pos);
			}
			this.innerBoundsCache.set(pos, bounds);

			return bounds;
		}
	},
);

type ContextPluginValue<T> = T extends ViewPlugin<infer V> ? V : never;
export type Context = ContextPluginValue<typeof contextPlugin>;
export const getContextPlugin = (view: EditorView): Context => {
	const plugin = view.plugin(contextPlugin);
	if (!plugin) {
		throw new Error("Context plugin not found");
	}
	return plugin;
};

export const mathBoundsPlugin = ViewPlugin.fromClass(
	class {
		protected mathBounds: MathBounds[] = [];
		equations: Map<number, string> | null = null;

		constructor(view: EditorView) {
			this.refresh(view.state.doc.toString());
		}

		update(update: ViewUpdate) {
			if (update.docChanged || update.viewportChanged) {
				this.equations = null;
				this.refresh(update.state.doc.toString());
			}
		}

		refresh(doc: string) {
			this.mathBounds = scanDollarMath(doc);
		}

		inMathBound = (state: EditorState, pos: number): MathBounds | null => {
			this.refresh(state.doc.toString());
			for (const b of this.mathBounds) {
				if (pos >= b.inner_start && pos < b.inner_end) return b;
			}
			for (const b of this.mathBounds) {
				if (pos >= b.outer_start && pos < b.outer_end) return b;
			}
			return null;
		};

		getEquationBounds(state: EditorState, pos?: number): MathBounds | null {
			if (pos === undefined) pos = state.selection.main.to;
			this.refresh(state.doc.toString());
			return this.inMathBound(state, pos);
		}

		getEquations(state: EditorState) {
			if (this.equations) return this.equations;
			this.refresh(state.doc.toString());
			this.equations = new Map(
				this.mathBounds.map((bound) => [
					bound.inner_start,
					state.sliceDoc(bound.inner_start, bound.inner_end),
				]),
			);
			return this.equations;
		}
	},
);

export const getMathBoundsPlugin = (view: EditorView) => {
	const plugin = view.plugin(mathBoundsPlugin);
	if (!plugin) {
		throw new Error("MathBoundsPlugin not found");
	}
	return plugin;
};

/** Compat: exports vacíos (el árbol Lezer ya no aplica). */
export const OPEN_INLINE_MATH_NODE = "inline";
export const OPEN_DISPLAY_MATH_NODE = "display";
export const open_math_nodes = new Set([OPEN_INLINE_MATH_NODE, OPEN_DISPLAY_MATH_NODE]);
export const close_math_nodes = new Set(["close-inline", "close-display"]);
