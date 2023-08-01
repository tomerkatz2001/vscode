// import {MarkdownRenderer} from "vs/editor/browser/core/markdownRenderer";
// import {MarkdownString} from "vs/base/common/htmlContent";
import {ICodeEditor} from "vs/editor/browser/editorBrowser";
import {IModeService} from "vs/editor/common/services/modeService";
import {IOpenerService} from "vs/platform/opener/common/opener";
import {IThemeService} from "vs/platform/theme/common/themeService";
import {RTVSynthView} from "vs/editor/contrib/rtv/RTVSynthView";
import {CursorPos, example, getUtils, isHtmlEscape, removeHtmlEscape, TableElement} from "./RTVUtils";
import {MarkdownRenderer} from "vs/editor/browser/core/markdownRenderer";
import { MarkdownString } from 'vs/base/common/htmlContent';

export class RTVInputBox extends RTVSynthView{

	private varNames: string[];
	private _boxEnv:any = {};

	private _cellElements?: Map<string, HTMLTableCellElement[]>;
	private _cursorPos: CursorPos;

	onEnterPressed?: ()=>void;
	constructor(
		_editor: ICodeEditor,
		originalLineNode: HTMLElement,
		originalBoxNode: HTMLElement,
		modeService: IModeService,
		openerService: IOpenerService,
		lineNumber: number,
		@IThemeService _themeService: IThemeService,
		private inVarNames:string[],
		private outVarNames:string[],
		private _rows: TableElement[][],
	){
		super(_editor, originalLineNode, originalBoxNode, modeService, openerService, lineNumber, [], _themeService);
		this.varNames = this.inVarNames.concat(this.outVarNames) ;
		this._cursorPos = new CursorPos(undefined, undefined, undefined, undefined, 0 );
		this.bindCellElementsChanged((cells)=>{this._cellElements = cells});
		this.bindUpdateCursorPos(this.changeCursorPos);
		this.bindRequestNextCell(this.findNextCell);
		this.bindToggleElement(this.toggleElement);
		this.bindToggleIfChanged(this.toggleIfChanged);
	}

	public getBoxAsExample(): example{
		var inputs: { [key: string]: string; } = {};
		var outputs: { [key: string]: string; } = {};
		Object.entries(this._boxEnv).forEach(([key, value], index) => {
			if(this.inVarNames.includes(key)){
				inputs[key] = value as string;
			}else{
				outputs[key] = value as string;
			}
		});
		return {inputs: inputs, outputs:outputs};
	}
	public updateBoxContent(rows: TableElement[][], init: boolean = false) {
		this._rows = rows
		const renderer = new MarkdownRenderer(
			{ 'editor': this._editor },
			this._modeService,
			this._openerService);

		this._firstEditableCellId = undefined;
		let cellElements = new Map<string, HTMLTableCellElement[]>();

		if (init) {
			// remove existing cells
			this._table!.childNodes.forEach((child) => {
				this._table!.removeChild(child)
			});
			this._table!.id = this.getTableId();

			this.show();
		}

		// update cell contents and add event listeners
		for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
			let newRow: HTMLTableRowElement;
			if (init) {
				newRow = this._table!.insertRow(-1);
				if (rowIdx > 0) { // skip the headers
					newRow.id = this.getRowId(rowIdx - 1);
				}
			}
			const row = rows[rowIdx];
			for (let _colIdx = 0; _colIdx < row.length; _colIdx++) {
				let cell: HTMLTableCellElement | undefined;
				const elmt = row[_colIdx];
				const vname = elmt.vname!;
				if (init) {
					cell = newRow!.insertCell(-1);
					if (rowIdx > 0) {
						cell!.id = this.getCellId(elmt.vname!, rowIdx - 1);
					}
					this.addCellContentAndStyle(cell!, elmt, renderer, rowIdx == 0);
				}

				// skip the headers
				if (rowIdx > 0) {
					if (!cell) {
						// not init
						cell = this.getCell(vname, rowIdx - 1)!;
					}
					if (cell! !== null) {
						if (!init) {
							cell = this.updateCell(cell!, elmt, renderer);
						}
						if (!this._firstEditableCellId && elmt.editable) {
							this._firstEditableCellId = this.getCellId(vname, rowIdx - 1);
						}

						// build cellElements
						let vcells = cellElements!.get(vname) ?? [];
						vcells.push(cell!);
						cellElements!.set(vname, vcells);

					}

				}
			}
		}

		// send vcells info back to Model
		this.onCellElementsChanged!(cellElements);
	}

	protected updateCell(cell: HTMLTableCellElement, elmt: TableElement, r: MarkdownRenderer, header: boolean = false): HTMLTableCellElement{

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


		// Remove any existing content
		cell.childNodes?.forEach((child) => cell.removeChild(child));

		if (elmt.editable) {
			// make the TableCellElement `td` editable if applicable
			cell.contentEditable = 'true';
		}


		// Add the new content
		cell.appendChild(cellContent);

		if (!header) {
			this.addListeners(cell);
		}

		return cell;
	}

	protected addListeners(cell: HTMLElement) {
		if (cell.id) { // won't work for cells w/o id, i.e., the header cells
			const [varname, idx] = cell.id.split('-').slice(1);

			cell.onclick = (e: MouseEvent) => {
				const selection = window.getSelection()!;
				const range = selection.getRangeAt(0)!;
				this.updateCursorPos!(range, cell);
			}

			cell.onblur = async () => {
				await this.requestToggleIfChanged!(+idx, varname, cell);
			}

			cell.onkeydown = async (e: KeyboardEvent) => {
				let rs: boolean = true;

				const selection = window.getSelection()!;
				const range = selection.getRangeAt(0)!;

				this.updateCursorPos!(range, cell);

				switch(e.key) {
					case 'Enter':
						e.preventDefault();

						if (e.shiftKey) {
							await this.requestToggleIfChanged!(+idx, varname, cell);
							this.onEnterPressed!();
						}
						break;

					case 'Escape':
						// stop synth
						rs = false;
						e.preventDefault();
						this.exitSynthHandler!();
						break;

					default:
						// how do we handle the situation where `Tab` is pressed immediately after a regular keystroke?
						// - currently we _don't_ process any synth request under this situation
						if (e.key === 'Tab') {
							e.preventDefault();
							this.focusNextRow(cell, e.shiftKey, false);
						}

				}
				return rs;
			}; // end of onkeydown
		}

	}

	private changeCursorPos(range: Range, node: HTMLElement) {
		const row = node.id!.split('-')[2];

		this._cursorPos.node = node;
		this._cursorPos.startPos = range.startOffset ?? undefined;
		this._cursorPos.endPos = range.endOffset ?? undefined;
		this._cursorPos.collapsed = range.collapsed ?? undefined;
		this._cursorPos.row = +row;
	}
	private findNextCell(backwards: boolean, skipLine: boolean, varname: string): HTMLTableCellElement {
		let varIdx: number;
		let row = this._cursorPos!.row;

		if (skipLine) {
			varIdx = 0;
			row += backwards ? -1 : +1;
		} else {
			// Check what the next variable is
			varIdx = this.varNames.indexOf(varname) + (backwards ? -1 : +1);
			if (varIdx < 0) {
				varIdx = this.varNames.length - 1;
				row -= 1;
			} else if (varIdx >= this.varNames!.length) {
				varIdx = 0;
				row += 1;
			}
		}

		// this._rows include the header, so we need to ignore/skip it
		if (row >= this._rows!.length - 1) {
			row = 0;
		} else if (row < 0) {
			row = this._rows!.length - 2;
		}

		const nextVar = this.varNames[varIdx];
		const vcells = this._cellElements!.get(nextVar)!;
		const tmpCell = vcells[row];
		let nextCell = tmpCell;

		while (nextCell.contentEditable !== 'true') {
			row += (backwards ? -1 : +1);

			if (row >= this._rows!.length - 1) {
				row = 0;
			} else if (row < 0) {
				row = this._rows!.length - 2;
			}

			nextCell = vcells[row];
			if (nextCell.id === tmpCell.id) {
				row =  0;
				nextCell = vcells[row];
				break;
			}
		}

		return nextCell;
	}
	public updateBoxState(varname: string, content: string) {
		this._boxEnv[varname] = content;
		console.log(`env[${varname}] = ${content}`);
	}
	private async toggleElement(idx: number, varname: string, cell: HTMLElement, force?: boolean, updateSynthBox: boolean = true): Promise<boolean> {
		let utils = getUtils();
		let error = await utils.validate(cell.textContent!.trim());
		if (error) {
			this.addError(error, cell, 500);
			return false;
		}
		this.updateBoxState(varname, cell.innerText.trim());

		const varIdx = this.varNames.indexOf(varname);
		let _cell = this._cellElements?.get(varname)![0]!; // assume only one line in inputBox
		let elm = this._rows[idx+1][varIdx]; // rows contains headers.
		elm.content = cell.innerText.trim();


		const renderer = new MarkdownRenderer(
		{ 'editor': this._editor },
		this._modeService,
		this._openerService);
		this.updateCell(_cell, elm, renderer);
			return true;
	}

	private async toggleIfChanged(idx: number, varname: string, cell: HTMLElement, updateBoxContent: boolean = true): Promise<boolean> {
		let success = false;
		if (cell) {
			let valueChanged = this._boxEnv[varname] !== cell.textContent!;
			success = valueChanged ? await this.toggleElement(idx, varname, cell, true, updateBoxContent) : true;
		} else {
			console.error('toggleIfChanged called, but parent can\' be found: ');
			console.error(cell);
		}

		return success;
	}
	public selectFirstEditableCell() : boolean {
		try {
			//this._currRow = +cellId; // already handled by this.select
			let cell = document.getElementById(this._firstEditableCellId!);
			cell!.contentEditable = 'true';
			this.select(cell!);
			return true;

		} catch (err) {
			console.error(`can't fid the first editable cell.`);
			return false;
		}
	}
	public bindOnEnterPresses(handler: ()=> void){
		this.onEnterPressed = handler;
	}
}