import { SYNTHESIZED_COMMENT_START, SYNTHESIZED_COMMENT_END } from './RTVCommentsConsts.js'

export function getScopeIdx(lineno: number, lines: string[]): number {
	let idx = 0
	for (let i = lineno; i > 0; i--) {
		const lineContent = lines[i];
		if (lineContent?.includes(SYNTHESIZED_COMMENT_START)) {
			idx++;
		}
	}
	if (isFuncSpec(lineno, lines)) {
		return -idx;
	}
	return idx;
}

/**
	 * This function will check if the comment at lineno is a function comment or a scope comment
	 * @param lineno - line number to start look from
	 * @param lines - all the lines in the editor
	 */
function isFuncSpec(lineno: number, lines: string[]): boolean {
	let startCount = 0
	let endCount = 0
	for (let line of lines.slice(lineno)) {
		if (line.includes(SYNTHESIZED_COMMENT_START)) {
			startCount++;
		}
		if (line.includes(SYNTHESIZED_COMMENT_END)) {
			endCount++;
		}
		if (startCount === endCount) {
			return false
		}
	}
	return true //no end found - it is a function block
}
