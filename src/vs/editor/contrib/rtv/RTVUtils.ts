

// import { runAtThisOrScheduleAtNextAnimationFrame } from 'vs/base/browser/dom';
// import { MainThreadFileSystem } from 'vs/workbench/api/browser/mainThreadFileSystem';
import { ErrorHoverManager } from "./RTVSynthView.js";
import { ICodeEditor } from '../../browser/editorBrowser.js';

// Helper functions / class

export function firstNonCommentLine(code: string[]): number {
	for (let i = 0; i < code.length; i++) {
		if (!(code[i].trim() == "") && !code[i].trim().startsWith("#!")) {
			return i
		}
	}
	return 0;
}

export function getLineIndent(line: string): string {
	let spaces = line.match("^\\s*");
	return spaces ? spaces[0] : "";

}

export function displayError(errorMsg: string, editor: ICodeEditor) {
	let errorManager = new ErrorHoverManager(editor);
	let editor_div = editor.getDomNode();
	let midScreenX;
	let midScreenY;
	if (!editor_div) {
		midScreenX = 1000
		midScreenY = 1000
	}
	else {
		midScreenX = editor_div.getBoundingClientRect().width / 4
		midScreenY = editor_div.getBoundingClientRect().height / 2
	}
	let tmpBox = document.createElement('div');
	tmpBox.style.maxWidth = '1600px';
	tmpBox.style.maxHeight = '400px';
	errorManager.add(tmpBox, errorMsg, 5, 1000, true, midScreenX, midScreenY, true)

}

// temporarily move the following three functions/class from RTVDisplay
// to resolve a dependency cycle between RTVDisplay and RTVSynthDisplay: RTVDisplay (-> RTVSynth -> RTVSynthDisplay) -> RTVDisplay

export function isHtmlEscape(s: string): boolean {
	return s.startsWith('```html\n') && s.endsWith('```');
}

export function removeHtmlEscape(s: string): string {
	let x = '```html\n'.length;
	let y = '```'.length;
	return s.substring(x, s.length - y);
}

export class TableElement {
	constructor(
		public content: string,
		public loopID: string,
		public iter: string,
		public controllingLineNumber: number,
		public vname?: string,
		public env?: any,
		public leftBorder?: boolean,
		public editable?: boolean
	) { }
}

export class CursorPos {
	constructor(
		public node?: HTMLElement,
		public startPos?: number,
		public endPos?: number,
		public collapsed?: boolean,
		public row: number = 0
	) { }
}

export type example = { inputs: { [k: string]: string }, outputs: { [k: string]: string } };


export function makeEmptyTable(inputVarNames: string[], outVarNames: string[], lineno: number): TableElement[][] {
	let rows: TableElement[][] = [];
	let header: TableElement[] = [];
	inputVarNames.forEach((v: string) => {
		let name = '**' + v + '**';
		if (outVarNames.includes(v)) {
			name = '```html\n<strong>' + v + '</strong><sub>in</sub>```'
		} else {
			name = '**' + v + '**'
		}
		header.push(new TableElement(name, 'header', 'header', 0, ''));
	});
	outVarNames.forEach((ov: string, i: number) => {
		header.push(new TableElement('```html\n<strong>' + ov + '</strong><sub>out</sub>```', 'header', 'header', 0, '', undefined, i === 0));
	});

	rows.push(header);

	// Generate one row
	let row: TableElement[] = [];
	inputVarNames.forEach((v: string) => {
		let varName = v;

		if (outVarNames.includes(v)) {
			varName += '_in';
		}

		row.push(new TableElement("", "", "", lineno, varName, {}));
	});
	outVarNames.forEach((v: string, i: number) => {
		row.push(new TableElement("", "", "", lineno, v, {}, i === 0));
	});
	for (let _colIdx = 0; _colIdx < row.length; _colIdx++) {
		row[_colIdx].editable = true;
	}
	rows.push(row);

	return rows
}
export function getFunctionCode(lines: string[], functionLine: number): string {
	const functionIndent = lines[functionLine - 1].match(/^\s*/)?.[0] || '';
	let functionCode = lines[functionLine - 1];

	// Find the end of the function by tracking indentation level
	let indentationLevel = 0;
	let i = functionLine;
	while (i < lines.length) {
		const line = lines[i];
		const lineIndent = line.match(/^\s*/)?.[0] || '';

		if (lineIndent.length <= functionIndent.length) {
			break;
		}

		functionCode += '\n' + line;
		indentationLevel = lineIndent.length;
		i++;
	}

	// Remove the last line if it's just a continuation of the function
	if (i < lines.length && lines[i].trim() === '') {
		functionCode = functionCode.slice(0, -1);
	}

	// Dedent the function code
	const dedentRegex = new RegExp(`^\\s{${indentationLevel}}`, 'gm');
	functionCode = functionCode.replace(dedentRegex, '');

	return functionCode;
}

export function range(start: number, end: number) { return [...Array(1 + end - start).keys()].map(v => start + v) }

export function replaceAll(string: string, search: string, replace: string): string {
	return string.split(search).join(replace);
}





