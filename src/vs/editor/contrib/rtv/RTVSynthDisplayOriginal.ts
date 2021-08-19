import { ICodeEditor } from 'vs/editor/browser/editorBrowser';
import { MarkdownRenderer } from 'vs/editor/browser/core/markdownRenderer';
import { MarkdownString } from 'vs/base/common/htmlContent';
import { IRTVDisplayBox } from 'vs/editor/contrib/rtv/RTVInterfaces';
import { TableElement, isHtmlEscape, removeHtmlEscape } from 'vs/editor/contrib/rtv/RTVUtils';
import { IModeService } from 'vs/editor/common/services/modeService';
import { IOpenerService } from 'vs/platform/opener/common/opener';

export class RTVSynthDisplay {

}
export class RTVSynthDisplayBox implements IRTVDisplayBox{
	private _box: HTMLDivElement;
	private _line: HTMLDivElement;
	private _allEnvs: any[] = [];
	private _allVars: Set<string> = new Set<string>();
	private _modeService: IModeService;
	private _openerService: IOpenerService;
	// private _deltaVarSet: DeltaVarSet;
	private _cellDictionary: { [k: string]: [HTMLElement] } = {}; // each HTMLElement is a `td` TableCellElement
	constructor(
		private readonly _editor: ICodeEditor,
		readonly originalLineNode: HTMLElement,
		readonly originalBoxNode: HTMLElement,
		readonly modeService: IModeService,
		readonly openerService: IOpenerService,
		readonly envs: any[],
		readonly vars: Set<string>,
		readonly lineNumber: number
	) {
		let editor_div = this._editor.getDomNode();
		if (editor_div === null) {
			throw new Error('Cannot find Monaco Editor');
		}
		this._box = originalBoxNode.cloneNode(true) as HTMLDivElement;
		this._line = originalLineNode.cloneNode(true) as HTMLDivElement;

		for (
			let elm: Node = this._box;
			elm.firstChild;
			elm = elm.firstChild
		) {
			if (elm.nodeName === 'TBODY') {
				let rows = Array.from(elm.childNodes!).slice(1); // skip the header
				rows.forEach((r) => {
					let cells = Array.from(r.childNodes!) as HTMLTableCellElement[]; // td elements
					cells.forEach((cell) => {
						if (cell.id !== '') { // should be always true
							cell.id = this.transformCellId(cell.id);
						}
						const vname = cell.id.split('-')[1];
						// const newCell : HTMLElement = cell.firstChild! as HTMLElement;
						if (vname in this._cellDictionary) {
							this._cellDictionary[vname].push(cell);
						} else {
							this._cellDictionary[vname] = [cell];
						}
					});
				});
				break;
			}
		}

		this._allEnvs = envs;
		this._allVars = vars;
		this._modeService = modeService;
		this._openerService = openerService;
		// TODO: change cell ids in cellDictionary accordingly `line-var-idx-synth`
		this._box.id = 'rtv-synth-box';
		this._box.style.opacity = '1';
		this._line.id = 'rtv-synth-line';
		this._line.style.opacity = '1';
		editor_div.appendChild(this._line);
		editor_div.appendChild(this._box);
	}

	public show() {
		this._box.style.opacity = '1';
		this._line.style.opacity = '1';
	}

	public hide() {
		this._box.style.opacity = '0';
		this._line.style.opacity = '0';
	}

	public isSynthBox() {
		return true;
	}

	public destroy() {
		this._box.remove();
		this._line.remove();
	}

	public getElement(): HTMLElement {
		return this._box;
	}

	public getEnvs(): any[] {
		return this._allEnvs;
	}

	public allVars() {
		return this._allVars;
	}

	public getCellContent() {
		return this._cellDictionary;
	}

	public transformCellId(cellId: string) : string {
		return `${cellId}-synth`;
	}

	public getCellId(varname: string, idx: number): string {
		return `${this.lineNumber}-${varname}-${idx}-synth`;
	}

	public getCell(varname: string, idx: number): HTMLTableCellElement | null {
		return document.getElementById(this.getCellId(varname, idx)) as HTMLTableCellElement;
	}

	public async updateContent(allEnvs: any[], updateInPlace?: boolean, outputVars?: string[], prevEnvs?: Map<number, any>) {

		let outVarNames: string[];
		if (!outputVars) {
			outVarNames = [];
		} else {
			outVarNames = outputVars!;
		}

		// TODO: currently only works for single var assignment (broken for loops)
		this._allEnvs = this.computeEnvs(allEnvs);
		let envs = this._allEnvs;

		// Compute set of vars in all envs
		// this._allVars = new Set<string>();

		let vars = this._allVars;

		if (prevEnvs) {
			const oldVars = vars;
			vars = new Set();
			for (const v of oldVars) {
				// remove any variables newly defined by the synthsizer
				let rs = true;
				if (outVarNames.includes(v)) {
					for (const env of envs) {
						const time = env['time'];
						const prev = prevEnvs.get(time);
						if (prev) {
							rs = v in prev;
						}
					}
				}

				if (rs) {
					vars.add(v);
				}
			}
		}


		let rows: TableElement[][] = [];
		// Generate all rows
		for (let i = 0; i < envs.length; i++) {
			let env = envs[i];
			let loopID = env['$'];
			let iter = env['#'];
			let row: TableElement[] = [];
			vars.forEach((v: string) => {
				let v_str: string;
				let varName = v;
				let varEnv = env;

				if (outVarNames.includes(v)) {
					varName += '_in';
					if (prevEnvs && prevEnvs.has(env['time'])) {
						varEnv = prevEnvs.get(env['time']);
					}
				}

				if (varEnv[v] === undefined) {
					v_str = '';
				} else if (isHtmlEscape(varEnv[v])) {
					v_str = varEnv[v];
				} else {
					v_str = '```python\n' + varEnv[v] + '\n```';
				}

				row.push(new TableElement(v_str, loopID, iter, this.lineNumber, varName, varEnv));
			});
			outVarNames.forEach((v: string, i: number) => {
				let v_str: string;
				if (env[v] === undefined) {
					v_str = '';
				} else if (isHtmlEscape(env[v])) {
					v_str = env[v];
				} else {
					v_str = '```python\n' + env[v] + '\n```';
				}
				row.push(new TableElement(v_str, loopID, iter, this.lineNumber, v, env, i === 0));
			});
			rows.push(row);
		}


		const renderer = new MarkdownRenderer(
			{ 'editor': this._editor },
			this._modeService,
			this._openerService);

		this._cellDictionary = {};
		await this.updateTableByCols(renderer, rows);
	}


	// modieifed (but copied) code from `RTVDisplay.ts` -- refactor?
	public computeEnvs(allEnvs: any[]) : any[]{
		// Get all envs at this line number
		let envs;

		envs = allEnvs[this.lineNumber-1];

		envs = this.addMissingLines(envs);

		return envs;
	}


	// copied from `RTVDisplay.ts`
	private addMissingLines(envs: any[]): any[] {
		let last = function <T>(a: T[]): T { return a[a.length - 1]; };
		let active_loop_iters: number[] = [];
		let active_loop_ids: string[] = [];
		let envs2: any[] = [];
		for (let i = 0; i < envs.length; i++) {
			let env = envs[i];
			if (env.begin_loop !== undefined) {
				if (active_loop_iters.length > 0) {
					let loop_iters: string[] = env.begin_loop.split(',');
					this.bringToLoopCount(envs2, active_loop_iters, last(active_loop_ids), +loop_iters[loop_iters.length - 2]);
				}
				active_loop_ids.push(env['$']);
				active_loop_iters.push(0);
			} else if (env.end_loop !== undefined) {
				let loop_iters: string[] = env.end_loop.split(',');
				this.bringToLoopCount(envs2, active_loop_iters, last(active_loop_ids), +last(loop_iters));
				active_loop_ids.pop();
				active_loop_iters.pop();
				active_loop_iters[active_loop_iters.length - 1]++;
			} else {
				let loop_iters: string[] = env['#'].split(',');
				this.bringToLoopCount(envs2, active_loop_iters, last(active_loop_ids), +last(loop_iters));
				envs2.push(env);
				active_loop_iters[active_loop_iters.length - 1]++;
			}
		}
		return envs2;
	}

	// copied from `RTVDisplay.ts`
	private bringToLoopCount(envs: any[], active_loop_iters: number[], loopId: string, iterCount: number) {
		while (active_loop_iters[active_loop_iters.length - 1] < iterCount) {
			envs.push({ '#': active_loop_iters.join(','), '$': loopId });
			active_loop_iters[active_loop_iters.length - 1]++;
		}
	}

	private async updateTableByCols(
		renderer: MarkdownRenderer,
		rows: TableElement[][]) {
			for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
				const row = rows[rowIdx];
				for (let _colIdx = 0; _colIdx < row.length; _colIdx++) {
					const elmt = row[_colIdx];
					// Get the cell
					// Note: use `rowIdx` instead of `... - 1` here because we didn't include the header row in the first place
					let cell = this.getCell(elmt.vname!, rowIdx)!;
					let editable;
					if (cell !== null) {
						await this.updateCell(cell, elmt, renderer, editable);
					}
				}
			}
	}

	// [Lisa, 7/14] remove async
	private async updateCell(cell: HTMLTableCellElement, elmt: TableElement, r: MarkdownRenderer, editable: boolean = false){

		let s = elmt.content;
		let cellContent: HTMLElement;
		if (s === '') {
			// Make empty strings into a space to make sure it's allocated a space
			// Otherwise, the divs in a row could become invisible if they are
			// all empty
			cellContent = document.createElement('div');
			cellContent.innerHTML = '&nbsp';
		}
		else if (isHtmlEscape(s)) {
			cellContent = document.createElement('div');
			cellContent.innerHTML = removeHtmlEscape(s);
		} else {
			let renderedText = r.render(new MarkdownString(s));
			cellContent = renderedText.element;
		}

		// `this._cellDictionary` is empty here
		if (this.lineNumber === elmt.controllingLineNumber) {
			const name = elmt.vname!;
			if (name in this._cellDictionary) {
				this._cellDictionary[name].push(cell);
			} else {
				this._cellDictionary[name] = [cell];
			}
		}


		// // Remove any existing content
		// cell.childNodes.forEach((child) => cell.removeChild(child));

		// if (editable) {
		// 	// make the TableCellElement `td` editable if applicable
		// 	cell.contentEditable = 'true';
		// }

		// // Add the new content
		// cell.appendChild(cellContent);


		return new Promise<void>((resolve, _reject) => {
			// The 0 timeout seems odd, but it's really a thing in browsers.
			// We need to let layout threads catch up after we updated content to
			// get the correct sizes for boxes.
			// setTimeout(() => {

				// Remove any existing content
				cell.childNodes.forEach((child) => cell.removeChild(child));

				if (editable) {
					// make the TableCellElement `td` editable if applicable
					cell.contentEditable = 'true';
				}

				// Add the new content
				cell.appendChild(cellContent);
				resolve();
			// }, 0);
		});
	}

}
