

import * as cp from 'child_process';
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { ICursorPositionChangedEvent } from 'vs/editor/common/controller/cursorEvents';
//import { IKeyboardEvent } from 'vs/base/browser/keyboardEvent';
import { IModelContentChangedEvent } from 'vs/editor/common/model/textModelEvents';
import { IEditorContribution, IScrollEvent } from 'vs/editor/common/editorCommon';
import { registerEditorContribution } from 'vs/editor/browser/editorExtensions';
import { EditorLayoutInfo } from 'vs/editor/common/config/editorOptions';
import * as strings from 'vs/base/common/strings';
import { IRange, Range } from 'vs/editor/common/core/range';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { IModeService } from 'vs/editor/common/services/modeService';
import { ICodeEditor } from 'vs/editor/browser/editorBrowser';
import { MarkdownRenderer } from 'vs/editor/contrib/markdown/markdownRenderer';
import { Position } from 'vs/editor/common/core/position';
import { IMarkdownString, MarkdownString, isEmptyMarkdownString, markedStringsEquals } from 'vs/base/common/htmlContent';
import { assertMapping } from 'vs/workbench/services/keybinding/test/keyboardMapperTestUtils';
import { IConfigurationService,  IConfigurationChangeEvent } from 'vs/platform/configuration/common/configuration';
import { Registry } from 'vs/platform/registry/common/platform';
import { IConfigurationRegistry, Extensions } from 'vs/platform/configuration/common/configurationRegistry';
import { localize } from 'vs/nls';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { IAction, Action } from 'vs/base/common/actions';
import { Separator } from 'vs/base/browser/ui/actionbar/actionbar';
import { ContextSubMenu } from 'vs/base/browser/contextmenu';
import { Event } from 'vs/base/common/event';

// Helper functions
function indent(s: string): number {
	return s.length - s.trimLeft().length;
}

function isHtmlEscape(s:string):boolean {
	return strings.startsWith(s, "```html\n") && strings.endsWith(s, "```")
}

abstract class VarSet {
	public abstract getSet(): Set<string>;
	public add(v: string): VarSet {
		let vars = new Set<string>(this.getSet());
		vars.add(v);
		return new ConcreteVarSet(vars);
	}
	public remove(v: string): VarSet {
		let vars = new Set<string>(this.getSet());
		vars.delete(v);
		return new ConcreteVarSet(vars);
	}
}

class FullVarSet extends VarSet {
	constructor(private readonly _b: RTVDisplayBox) {
		super();
	}
	public getSet(): Set<string> {
		return this._b.allVars();
	}
	public add(v: string): VarSet {
		return this;
	}
}

class ConcreteVarSet extends VarSet {
	constructor(private readonly _set: Set<string>) {
		super();
	}
	public getSet(): Set<string> {
		return this._set;
	}
}

class EmptyVarSet extends ConcreteVarSet {
	constructor() {
		super(new Set<string>());
	}
	public remove(v: string): VarSet {
		return this;
	}
}

class ModVarSet extends VarSet {
	constructor(private readonly _b: RTVDisplayBox) {
		super();
	}
	public getSet(): Set<string> {
		return this._b.modVars();
	}
}


class RTVLine {
	private _div: HTMLDivElement;
	constructor(
		editor: ICodeEditor,
		x1: number,
		y1: number,
		x2: number,
		y2: number
	) {
		let editor_div = editor.getDomNode();
		if (editor_div === null) {
			throw new Error('Cannot find Monaco Editor');
		}

		this._div = document.createElement('div');
		this._div.style.position = "absolute";
		this._div.style.borderTop = "1px solid grey";
		this._div.style.transitionProperty = "all";
		this._div.style.transitionDuration = "0.3s";
		this._div.style.transitionDelay = "0s";
		this._div.style.transitionTimingFunction = "ease-in";
		this._div.style.transformOrigin = "0% 0%";
		this.move(x1,y1,x2,y2);
		editor_div.appendChild(this._div);
	}

	public destroy() {
		this._div.remove();
	}

	public move(x1: number, y1: number, x2: number, y2: number) {
		this._div.style.left = x1.toString() + "px";
		this._div.style.top = y1.toString() + "px";
		let deltaX = (x2 - x1);
		let deltaY = (y2 - y1);
		let length = Math.sqrt((deltaX * deltaX) + (deltaY * deltaY));
		this._div.style.width = length.toString() + "px";
		let angle = 0;
		if (length !== 0) {
			angle = Math.atan(deltaY / deltaX) * 180 / Math.PI;
		}
		this._div.style.transform = "rotate(" + angle.toString() + "deg)";
	}

	public setOpacity(opacity: number) {
		this._div.style.opacity = opacity.toString();
	}

	public hide(){
		this._div.style.display = "none";
	}

	public show(){
		this._div.style.display = "block";
	}

}

class TableElement {
	constructor(public content: string, public loop: string = "") {}
}

type MapLoopsToCells = { [k:string]: HTMLTableDataCellElement[]; };

class RTVDisplayBox {
	private _box: HTMLDivElement;
	private _line: RTVLine;
	private _zoom: number = 1;
	private _opacity: number = 1;
	private _hasContent: boolean = false;
	private _allVars: Set<string> = new Set<string>();
	private _removedVars: Set<string> = new Set<string>();
	private _displayedVars: VarSet;
	constructor(
		private readonly _coordinator:RTVCoordinator,
		private readonly _editor: ICodeEditor,
		private readonly _modeService: IModeService,
		private readonly _openerService: IOpenerService | null,
		private _lineNumber: number
	) {
		if (this._coordinator.displayOnlyModifiedVars) {
			this._displayedVars = new ModVarSet(this);
		} else {
			this._displayedVars = new FullVarSet(this);
		}
		let editor_div = this._editor.getDomNode();
		if (editor_div === null) {
			throw new Error('Cannot find Monaco Editor');
		}
		this._box = document.createElement('div');
		this._box.textContent = "";
		this._box.style.position = "absolute";
		this._box.style.top = "100px";
		this._box.style.left = "100px";
		this._box.style.maxWidth = "1366px";
		this._box.style.transitionProperty = "all";
		this._box.style.transitionDuration = "0.3s";
		this._box.style.transitionDelay = "0s";
		this._box.style.transitionTimingFunction = "ease-in";
		this._box.className = "monaco-editor-hover";
		this._box.onauxclick = (e) => {
			this.onClick(e);
		};
		this._box.onclick = (e) => {
			this.onClick(e);
		};
		editor_div.appendChild(this._box);
		this._line = new RTVLine(this._editor, 0, 0, 0, 0);
		this.hide();
	}

	get visible() {
		return this._hasContent;
	}

	get lineNumber() {
		return this._lineNumber;
	}

	set lineNumber(l:number) {
		this._lineNumber = l;
	}

	public destroy() {
		this._box.remove();
		this._line.destroy();
	}

	public hide() {
		this._hasContent = false;
		this._box.textContent = "";
		this._box.style.display = "none";
		this._line.hide();
	}

	public show() {
		this._hasContent = true;
		this._box.style.display = "block";
		this._line.show();
	}

	public modVars() {
		let writesAtLine = this._coordinator.writes[this._lineNumber-1];
		if (writesAtLine === undefined) {
			writesAtLine = []
		}
		let result = new Set<string>(writesAtLine);
		if (this._allVars.has("rv")) {
			result.add("rv");
		}
		return result;
	}

	public allVars() {
		return this._allVars;
	}

	public notDisplayedVars() {
		let result = new Set<string>();
		let displayed = this._displayedVars.getSet();
		this._allVars.forEach((v:string) => {
			if (!displayed.has(v)) {
				result.add(v);
			}
		});
		return result;
	}

	private onClick(e: MouseEvent) {
		let c = this._coordinator;

		let fullViewAction = this.newAction("Full", () => {
			c.changeToFullView();
		});
		let compactViewAction = this.newAction("Compact", () => {
			c.changeToCompactView();
		});

		let currViewMode = c.viewMode;
		if (currViewMode === 'full') {
			fullViewAction.checked = true;
		} else if (currViewMode === 'compact') {
			compactViewAction.checked = true;
		}

		c.contextMenuService.showContextMenu({
			getAnchor: () => ({x: e.clientX, y: e.clientY }),
			getActions: () => [
				this.newAction("Hide This Box", () => {
					c.hideBox(this);
				}),
				this.newAction("Hide All Other Boxes", () => {
					c.hideAllOtherBoxes(this);
				}),
				new Separator(),
				this.newAction("Restore This Box to Default", () => {
					c.restoreBoxToDefault(this);
				}),
				this.newAction("Restore All Boxes to Default", () => {
					c.restoreAllBoxesToDefault();
				}),
				new Separator(),
				new ContextSubMenu("Appearance of All Boxes", [ fullViewAction, compactViewAction ])
			],
			onHide: () => {},
			autoSelectFirstItem: true
		});
	}

	private isConditionalLine(): boolean {
		let lineContent = this._coordinator.getLineContent(this._lineNumber).trim();
		return strings.endsWith(lineContent, ":") &&
			   (strings.startsWith(lineContent, "if") ||
				strings.startsWith(lineContent, "else"));
	}

	private isLoopLine(): boolean {
		let lineContent = this._coordinator.getLineContent(this._lineNumber).trim();
		return strings.endsWith(lineContent, ":") &&
			   (strings.startsWith(lineContent, "for") ||
				strings.startsWith(lineContent, "while"));
	}

	private bringToLoopCount(envs:any[], active_loops:number[], iterCount:number) {
		while (active_loops[active_loops.length-1] < iterCount ) {
			envs.push({ "#" : active_loops.join(",") });
			active_loops[active_loops.length-1]++;
		}
	}

	private addMissingLines(envs: any[]): any[] {
		let active_loops: number[] = [];
		let envs2: any[] = [];
		for (let i = 0; i < envs.length; i++) {
			let env = envs[i];
			if (env.begin_loop !== undefined) {
				if (active_loops.length > 0) {
					let loop = env.begin_loop.split(",");
					this.bringToLoopCount(envs2, active_loops, +loop[loop.length-2]);
				}
				active_loops.push(0);
			} else if (env.end_loop !== undefined) {
				let loop = env.end_loop.split(",");
				this.bringToLoopCount(envs2, active_loops, +loop[loop.length-1]);
				active_loops.pop();
				active_loops[active_loops.length-1]++;
			} else {
				let loop = env["#"].split(",");
				this.bringToLoopCount(envs2, active_loops, +loop[loop.length-1]);
				envs2.push(env);
				active_loops[active_loops.length-1]++;
			}
		}
		return envs2;
	}

	private addCellContentAndStyle(cell: HTMLTableCellElement, elmt: TableElement, r:MarkdownRenderer) {
		if (this._coordinator.colBorder) {
			cell.style.borderLeft = "1px solid #454545";
		}
		let padding = this._coordinator.cellPadding + "px";
		cell.style.paddingLeft = padding;
		cell.style.paddingRight = padding;
		cell.style.paddingTop = "0";
		cell.style.paddingBottom = "0";

		if (this._coordinator.byRowOrCol === RowColMode.ByCol) {
			cell.align = 'center';
		} else {
			cell.align = 'left';
		}

		let s = elmt.content;
		let cellContent: HTMLElement;
		if (s === "") {
			// Make empty strings into a space to make sure it's allocated a space
			// Otherwise, the divs in a row could become invisible if they are
			// all empty
			cellContent = document.createElement('div');
			cellContent.innerHTML = "&nbsp";
		}
		else if (isHtmlEscape(s)) {
			cellContent = document.createElement('div');
			cellContent.innerHTML = s;
		} else {
			let renderedText = r.render(new MarkdownString(s));
			cellContent = renderedText.element;
		}
		// if (this._coordinator.byRowOrCol === RowColMode.ByCol && elmt.loop === "header") {
		// 	cellContent = this.createVarMenuButton(cellContent, s.substr(2, s.length-4));
		// }
		if (elmt.loop === "header") {
			cellContent = this.createVarMenuButton(cellContent, s.substr(2, s.length-4));
		}
		cell.appendChild(cellContent);
	}

	private populateTableByCols(table: HTMLTableElement, renderer: MarkdownRenderer, rows: TableElement[][]) {
		rows.forEach((row:TableElement[]) => {
			let newRow = table.insertRow(-1);
			row.forEach((elmt: TableElement) => {
				let newCell = newRow.insertCell(-1);
				this.addCellContentAndStyle(newCell, elmt, renderer);
			});
		});
	}

	private populateTableByRows(table: HTMLTableElement, renderer: MarkdownRenderer, rows: TableElement[][]) {
		let tableCellsByLoop = this._coordinator.tableCellsByLoop;
		for (let colIdx = 0; colIdx < rows[0].length; colIdx++) {
			let newRow = table.insertRow(-1);
			for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
				let elmt = rows[rowIdx][colIdx];
				let newCell = newRow.insertCell(-1);
				this.addCellContentAndStyle(newCell, elmt, renderer);
				if (elmt.loop !== "") {
					if (tableCellsByLoop[elmt.loop] === undefined) {
						tableCellsByLoop[elmt.loop] = [];
					}
					tableCellsByLoop[elmt.loop].push(newCell);
				}
			}
		}
	}

	// private createTableByRows2(rows: TableElement[][]) {
	// 	this._box.textContent = "";
	// 	let tableCellsByLoop = this._coordinator.tableCellsByLoop;
	// 	const renderer = new MarkdownRenderer(this._editor, this._modeService, this._openerService);
	// 	let table = document.createElement('div');
	// 	table.style.display = "table";
	// 	for (let colIdx = 0; colIdx < rows[0].length; colIdx++) {
	// 		let newRow = document.createElement('div');
	// 		newRow.style.display = "table-row";
	// 		table.appendChild(newRow);
	// 		for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
	// 			let elmt = rows[rowIdx][colIdx];
	// 			let newCell = this.computeCellContent(elmt.content, renderer)
	// 			newCell.style.display = "table-cell";
	// 			newCell.style.width = "120px";
	// 			newRow.appendChild(newCell);
	// 		}
	// 	}
	// 	this._box.appendChild(table);
	// }

	public indentAtLine(lineno: number): number {
		return indent(this._coordinator.getLineContent(lineno));
	}

	public updateContent() {

		if (!this._coordinator.showBoxAtLoopStmt && this.isLoopLine()) {
			this.hide();
			return;
		}

		if (this.isConditionalLine()) {
			this.hide();
			return;
		}

		// Get all envs at this line number
		let envsAtLine = this._coordinator.envs[this._lineNumber-1];
		if (envsAtLine === undefined) {
			this.hide();
			return;
		}

		this.show();

		// collect all next step envs
		let envs: any[] = [];
		let isLoop = this.isLoopLine();
		let currIndent = this.indentAtLine(this._lineNumber);
		envsAtLine.forEach((env) => {
			if (env.begin_loop !== undefined) {
				envs.push(env);
			} else if (env.end_loop !== undefined) {
				envs.push(env);
			} else if (env.next_lineno !== undefined) {
				if (!isLoop || this.indentAtLine(env.next_lineno+1) > currIndent) {
					let nextEnvs = this._coordinator.envs[env.next_lineno];
					if (nextEnvs !== undefined) {
						nextEnvs.forEach((nextEnv) => {
							if (nextEnv.time === env.time + 1) {
								envs.push(nextEnv);
							}
						});
					}
				}
			}
		});

		envs = this.addMissingLines(envs);

		// Compute set of vars in all envs
		this._allVars = new Set<string>();
		//let writesAtLine = this._coordinator.writes[this._lineNumber-1];
		envs.forEach((env) => {
			for (let key in env) {
				if (key !== "prev_lineno" && key !== "next_lineno" && key !== "lineno" && key !== "time") {
					//if (!this._coordinator.displayOnlyModifiedVars || key === "rv" ||
					//    (writesAtLine !== undefined && writesAtLine.some(x => x === key))) {
						this._allVars.add(key);
					//}
				}
			}
		});

		let vars = this._displayedVars.getSet();
		// let vars = new Set<string>(this._allVars);
		// this._removedVars.forEach((v) => {
		// 	if (!vars.delete(v)) {
		// 		this._removedVars.delete(v);
		// 	}
		// });

		if (vars.size === 0) {
			this.hide();
			//console.log("No vars to display");
			return;
		}

		// Generate header
		let rows: TableElement [][] = [];
		let header:TableElement[] = [];
		vars.forEach((v:string) => {
			header.push(new TableElement("**" + v + "**", "header"));
		});
		rows.push(header);

		// Generate all rows
		for (let i = 0; i < envs.length; i++) {
			let env = envs[i];
			let loop = env["#"];
			let row:TableElement [] = [];
			vars.forEach((v:string) => {
				var v_str:string;
				if (env[v] === undefined) {
					v_str = "";
				} else if (isHtmlEscape(env[v])) {
					v_str = env[v];
				} else {
					v_str = "```python\n" + env[v] + "```";
				}
				// if (env[v] !== undefined && i > 0 && env[v] === envs[i-1][v]) {
				// 	v_str = "&darr;";
				// }
				row.push(new TableElement(v_str, loop));
			});
			rows.push(row);
		};

		// Set border
		if (this._coordinator.boxBorder) {
			this._box.style.border = "";
		} else {
			this._box.style.border = "0";
		}

		// Create html table from rows
		this._box.textContent = "";
		const renderer = new MarkdownRenderer(this._editor, this._modeService, this._openerService);
		let table = document.createElement('table');
		table.style.borderSpacing = "0px";
		table.style.paddingLeft = "13px";
		table.style.paddingRight = "13px";
		if (this._coordinator.byRowOrCol === RowColMode.ByRow) {
			this.populateTableByRows(table, renderer, rows);
		} else {
			this.populateTableByCols(table, renderer, rows);
		}
		this._box.appendChild(table);

		this.addStalenessIndicator();

		//this.addConfigButton();
		this.addPlusButton();
	}

	private addStalenessIndicator() {
		// Add green/red dot to show out of date status
		let stalenessIndicator = document.createElement('div');
		stalenessIndicator.style.width = '5px';
		stalenessIndicator.style.height = '5px';
		stalenessIndicator.style.position = 'absolute';
		stalenessIndicator.style.top = '5px';
		stalenessIndicator.style.left = '3px';
		stalenessIndicator.style.borderRadius = '50%';
		let x = this._coordinator._changedLinesWhenOutOfDate;
		if (x === null) {
			stalenessIndicator.style.backgroundColor = 'green';
		} else {
			let green = 165 - (x.size-1) * 35;
			if (green < 0) {
				green = 0;
			}
			stalenessIndicator.style.backgroundColor = 'rgb(255,' + green.toString() + ',0)';
		}

		this._box.appendChild(stalenessIndicator);
	}

	public varRemove(varname: string) {
		this._displayedVars = this._displayedVars.remove(varname);
		//this._removedVars.add(varname);
	}

	public varKeepOnly(varname: string) {
		this._displayedVars = new ConcreteVarSet(new Set<string>([varname]));
		// this._removedVars = new Set<string>(this._allVars);
		// this._removedVars.delete(varname);
	}

	public varAdd(varname: string) {
		this._displayedVars = this._displayedVars.add(varname);
		// this._removedVars.delete(varname);
	}

	public varAddAll() {
		this._displayedVars = new FullVarSet(this);
		//this._removedVars.clear();
	}

	public varRemoveAll() {
		this._displayedVars = new EmptyVarSet();
		//this._removedVars.clear();
	}

	public varRestoreToDefault() {
		if (this._coordinator.displayOnlyModifiedVars) {
			this._displayedVars = new ModVarSet(this);
		} else {
			this._displayedVars = new FullVarSet(this);
		}
	}

	private newAction(label: string, actionCallBack: () => void): Action {
		return new Action("id", label, "", true, (event?) => {
			actionCallBack();
			return new Promise((resolve, reject) => {
				resolve();
			});
		});
		//x.checked = true;
		//return new Separator();
	}

	private createVarMenuButton(elmt: HTMLElement, varname: string): HTMLDivElement {
		let menubar = document.createElement('div');
		menubar.className = "menubar";
		if (this._coordinator.byRowOrCol === RowColMode.ByCol) {
			menubar.style.height = "23px";
		} else {
			menubar.style.height = "19.5px";
		}
		menubar.appendChild(elmt);
		elmt.className = "menubar-menu-button";
		let c = this._coordinator;
		elmt.onclick = (e) => {
			e.stopImmediatePropagation();
			c.contextMenuService.showContextMenu({
				getAnchor: () => elmt,
				getActions: () => [
					this.newAction("Remove <strong> " + varname + " </strong> in This Box", () => {
						c.varRemoveInThisBox(varname, this);
					}),
					this.newAction("Remove <strong> " + varname + " </strong> in All Boxes", () => {
						c.varRemoveInAllBoxes(varname);
					}),
					this.newAction("Only <strong> " + varname + " </strong> in This Box", () => {
						c.varKeepOnlyInThisBox(varname, this);
					}),
					this.newAction("Only <strong> " + varname + " </strong> in All Boxes", () => {
						c.varKeepOnlyInAllBoxes(varname);
					})
				],
				onHide: () => {},
				autoSelectFirstItem: true
			});
		}
		return menubar;
	}

	private addPlusButton() {
		let menubar = document.createElement('div');
		menubar.className = "menubar";
		menubar.style.height = "23px";
		menubar.style.position = 'absolute';
		menubar.style.top = '0px';
		menubar.style.right = '0px';
		let addButton = document.createElement('div');
		menubar.appendChild(addButton)
		addButton.className = "menubar-menu-button";
		addButton.innerHTML = "+";
		addButton.onclick = (e) => {
			e.stopImmediatePropagation();
			this._coordinator.contextMenuService.showContextMenu({
				getAnchor: () => addButton,
				getActions: () => this.createActionsForPlusMenu(),
				// [
				// 	new ContextSubMenu("Submenu 1", [
				// 		new Action("Hi", "Remove from THIS box","",true,(event?) => {
				// 			console.log("AAAAA");
				// 			console.log(event);
				// 			return new Promise((resolve, reject) => {
				// 				console.log("in promise A");
				// 				resolve(123);
				// 			});
				// 		}),
				// 		new Action("Hi", "Remove from ALL box","",true,(event?) => {
				// 			console.log("BBBBB");
				// 			console.log(event);
				// 			return new Promise((resolve, reject) => {
				// 				console.log("in promise B");
				// 				resolve(123);
				// 			});
				// 		})
				// 	]),
				// 	new ContextSubMenu("Submenu 2", [
				// 		new Action("Hi", "Remove from THIS box","",true,(event?) => {
				// 			console.log("CCCC");
				// 			console.log(event);
				// 			return new Promise((resolve, reject) => {
				// 				console.log("in promise C");
				// 				resolve(123);
				// 			});
				// 		}),
				// 		new Action("Hi", "Remove from ALL box","",true,(event?) => {
				// 			console.log("DDDD");
				// 			console.log(event);
				// 			return new Promise((resolve, reject) => {
				// 				console.log("in promise D");
				// 				resolve(123);
				// 			});
				// 		})
				// 	])
				// ],
				onHide: () => {},
				autoSelectFirstItem: true
			});

		}
		this._box.appendChild(menubar);

	}

	private createActionsForPlusMenu(): (IAction | ContextSubMenu)[] {
		let res: (IAction | ContextSubMenu)[] = [];
		this.notDisplayedVars().forEach((v) => {
			res.push(new ContextSubMenu("Add <strong> " + v , [
				this.newAction("to This Box", () => {
					this._coordinator.varAddInThisBox(v, this);
				}),
				this.newAction("to All Boxes", () => {
					this._coordinator.varAddInAllBoxes(v);
				})
			]));
		});
		res.push(new ContextSubMenu("Add All Vars ", [
			this.newAction("to This Box", () => {
				this._coordinator.varAddAllInThisBox(this);
			}),
			this.newAction("to All Boxes", () => {
				this._coordinator.varAddAllInAllBoxes();
			})
		]));
		return res;
	}


	// public addConfigButton() {
	// 	let configButton = document.createElement('div');
	// 	let lines: HTMLElement[] = [];

	// 	for(let i = 0; i < 3; i++){
	// 		let hamburgerIconLine = document.createElement('div');
	// 		hamburgerIconLine.style.width = '90%';
	// 		hamburgerIconLine.style.height = '10%';
	// 		hamburgerIconLine.style.margin =  '20% 0%';
	// 		hamburgerIconLine.style.backgroundColor = 'black';
	// 		configButton.appendChild(hamburgerIconLine);
	// 		lines.push(hamburgerIconLine);
	// 	}
	// 	lines[0].style.transition = 'transform 0.2s';
	// 	lines[2].style.transition = 'transform 0.2s';

	// 	configButton.style.width = '10px';
	// 	configButton.style.height = '10px';
	// 	configButton.style.position = 'absolute';
	// 	configButton.style.top = '5px';
	// 	configButton.style.right = '2px';
	// 	if(configButton){
	// 		configButton.onclick = (e) =>{
	// 			e.stopPropagation();
	// 			if(this._coordinator._configBox){
	// 				console.log(this._coordinator._configBox.style.display);
	// 				this._coordinator.showOrHideConfigDialogBox();
	// 			}
	// 			else{
	// 				this._coordinator.addConfigDialogBox();
	// 			}
	// 			if(lines[1].style.opacity !== '0'){
	// 				lines[0].style.transform = 'translate(0%, 3px) rotate(-45deg)';
	// 				lines[2].style.transform = 'translate(0%, -3px) rotate(45deg)';
	// 				lines[1].style.opacity = '0';
	// 				console.log(lines[2]);
	// 			}else{
	// 				lines[0].style.transform = 'translate(0%, 0px) rotate(0deg)';
	// 				lines[1].style.opacity = '1';
	// 				lines[2].style.transform = 'translate(0%, 0px) rotate(0deg)';
	// 			}

	// 		};
	// 	}
	// 	this._box.appendChild(configButton);
	// }


	public getHeight() {
		return this._box.offsetHeight*this._zoom;
	}

	public updateLayout(top: number) {
		let pixelPosAtLine = this._coordinator.getLinePixelPos(this._lineNumber);

		let boxTop = top;
		if (this._coordinator.boxAlignsToTopOfLine) {
			boxTop = boxTop - (pixelPosAtLine.height/2);
		}
		let left = this._coordinator.maxPixelCol+130;
		let zoom_adjusted_left =  left - ((1-this._zoom) * (this._box.offsetWidth / 2));
		let zoom_adjusted_top = boxTop - ((1-this._zoom) * (this._box.offsetHeight / 2));
		this._box.style.top = zoom_adjusted_top.toString() + "px";
		this._box.style.left = zoom_adjusted_left.toString() + "px";
		this._box.style.transform = "scale(" + this._zoom.toString() +")";
		this._box.style.opacity = this._opacity.toString();

		// update the line
		let midPointTop = pixelPosAtLine.top + (pixelPosAtLine.height / 2);

		this._line.move(this._coordinator.maxPixelCol+30, midPointTop, left, top);

	}

	public updateZoomAndOpacity(dist: number) {
		let distAbs = Math.abs(dist);
		let zoom_upper = 1;
		let zoom_lower = 1 / (distAbs*0.5 + 1);
		this._zoom = zoom_lower + (zoom_upper-zoom_lower) * this._coordinator.zoomLevel;

		this._opacity = 1;
		if (distAbs !== 0) {
			let opacity_upper = 1;
			let opacity_lower = 1/distAbs;
			this._opacity = opacity_lower + (opacity_upper-opacity_lower) * this._coordinator.opacityLevel;
		}
		this._line.setOpacity(this._opacity);
	}

	public fade() {
		let oldOpacity = this._box.style.opacity === "" ? '1' : this._box.style.opacity;
		if (oldOpacity) {
			let newOpacity = parseFloat(oldOpacity) * 0.9;
			this._box.style.opacity = newOpacity.toString();
			this._line.setOpacity(newOpacity);
			this._opacity = newOpacity;
		}
	}

}

enum RowColMode {
	ByRow,
	ByCol
}

export class RTVCoordinator implements IEditorContribution {
	public envs: { [k:string]: any []; } = {};
	public writes: { [k:string]: string[]; } = {};
	private _boxes: RTVDisplayBox[] = [];
	private _maxPixelCol = 0;
	private _prevModel: string[] = [];
	public _changedLinesWhenOutOfDate: Set<number> | null = new Set();
	private _row: boolean = false;
	public _configBox: HTMLDivElement | null = null;
	public tableCellsByLoop: MapLoopsToCells;
	private _config: ConfigurationServiceCache;

	constructor(
		private readonly _editor: ICodeEditor,
		@IOpenerService private readonly _openerService: IOpenerService,
		@IModeService private readonly _modeService: IModeService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextMenuService public readonly contextMenuService: IContextMenuService,
	) {
		this._editor.onDidChangeCursorPosition((e) => {	this.onChangeCursorPosition(e);	});
		this._editor.onDidScrollChange((e) => { this.onScrollChange(e); });
		this._editor.onDidLayoutChange((e) => { this.onLayoutChange(e); });
		this._editor.onDidChangeModelContent((e) => { this.onChangeModelContent(e); });
		for (let i = 0; i < this.getLineCount(); i++) {
			this._boxes.push(new RTVDisplayBox(this, _editor, _modeService, _openerService, i+1));
		}
		this.updateMaxPixelCol();
		this.updatePrevModel();
		//this.configurationService.onDidChangeConfiguration((e) => { this.onChangeConfiguration(e); });
		this._config = new ConfigurationServiceCache(configurationService)
		this._config.onDidUserChangeConfiguration = (e) => {
			this.onUserChangeConfiguration(e);
		};
	}

	public getId(): string {
		return 'editor.contrib.rtv';
	}

	public dispose():void {
	}

	public saveViewState(): any {
		this._boxes = [];
		this.envs = {};
		this.writes = {};
	}

	public restoreViewState(state: any): void {
		this.updateContentAndLayout();
	}

	// Configurable properties
	get boxAlignsToTopOfLine(): boolean {
		return this._config.getValue(boxAlignsToTopOfLineKey);
	}
	set boxAlignsToTopOfLine(v: boolean) {
		this._config.updateValue(boxAlignsToTopOfLineKey, v);
	}

	get boxBorder(): boolean {
		return this._config.getValue(boxBorderKey);
	}
	set boxBorder(v: boolean) {
		this._config.updateValue(boxBorderKey, v);
	}

	get byRowOrCol(): RowColMode {
		return this._config.getValue(byRowOrColKey) === 'byRow' ? RowColMode.ByRow : RowColMode.ByCol;
	}
	set byRowOrCol(v: RowColMode) {
		this._config.updateValue(byRowOrColKey, v ===  RowColMode.ByRow ? 'byRow' : 'byCol');
	}

	get cellPadding(): number {
		return this._config.getValue(cellPaddingKey);
	}
	set cellPadding(v: number) {
		this._config.updateValue(cellPaddingKey, v);
	}

	get colBorder(): boolean {
		return this._config.getValue(colBorderKey);
	}
	set colBorder(v: boolean) {
		this._config.updateValue(colBorderKey, v);
	}

	get displayOnlyModifiedVars(): boolean {
		return this._config.getValue(displayOnlyModifiedVarsKey);
	}
	set displayOnlyModifiedVars(v: boolean) {
		this._config.updateValue(displayOnlyModifiedVarsKey, v);
	}

	get opacityLevel(): number {
		return this._config.getValue(opacityKey);
	}
	set opacityLevel(v: number) {
		this._config.updateValue(opacityKey, v);
	}

	get showBoxAtLoopStmt(): boolean {
		return this._config.getValue(showBoxAtLoopStmtKey);
	}
	set showBoxAtLoopStmt(v: boolean) {
		this._config.updateValue(showBoxAtLoopStmtKey, v);
	}

	get spaceBetweenBoxes(): number {
		return this._config.getValue(spaceBetweenBoxesKey);
	}
	set spaceBetweenBoxes(v: number) {
		this._config.updateValue(spaceBetweenBoxesKey, v);
	}

	get zoomLevel(): number {
		return this._config.getValue(zoomKey);
	}
	set zoomLevel(v: number) {
		this._config.updateValue(zoomKey, v);
	}

	get viewMode(): string {
		return this._config.getValue(presetsKey);
	}
	set viewMode(v: string) {
		this._config.updateValue(presetsKey, v);
	}

	// End of configurable properties

	get maxPixelCol() {
		return this._maxPixelCol;
	}

	public changeToCompactView() {
		this.viewMode = 'compact';
		this.boxAlignsToTopOfLine = true;
		this.boxBorder = false;
		this.byRowOrCol = RowColMode.ByRow;
		this.cellPadding = 6;
		this.colBorder = true;
		this.displayOnlyModifiedVars = true;
		this.opacityLevel = 1;
		this.showBoxAtLoopStmt = true;
		this.spaceBetweenBoxes = -4;
		this.zoomLevel = 1;
		this.restoreAllBoxesToDefault();
	}

	public changeToFullView() {
		this.viewMode = 'full';
		this.boxAlignsToTopOfLine = false;
		this.boxBorder = true;
		this.byRowOrCol = RowColMode.ByCol;
		this.cellPadding = 6;
		this.colBorder = false;
		this.displayOnlyModifiedVars = false;
		this.opacityLevel = 0;
		this.showBoxAtLoopStmt = false;
		this.spaceBetweenBoxes = 20;
		this.zoomLevel = 0;
		this.restoreAllBoxesToDefault();
	}

	private onUserChangeConfiguration(e: IConfigurationChangeEvent) {
		if (e.affectedKeys.indexOf(presetsKey) != -1) {
			let v:string = this.viewMode;
			if (v === 'full') {
				this.changeToFullView();
			} else if (v === 'compact') {
				this.changeToCompactView();
			}
		} else if (e.affectedKeys.some((s) => strings.startsWith(s, 'rtv'))) {
			this.viewMode = 'custom';
		}
	}

	private getLineCount(): number {
		let model = this._editor.getModel();
		if (model === null) {
			return 0;
		}
		return model.getLineCount();
	}

	public getLineContent(lineNumber: number): string {
		let model = this._editor.getModel();
		if (model === null) {
			return "";
		}
		return model.getLineContent(lineNumber);
	}

	private updateMaxPixelCol() {
		let model = this._editor.getModel();
		if (model === null) {
			return;
		}
		let max = 0;
		let lineCount = model.getLineCount();
		for (let line = 1; line <= lineCount; line++) {
			let col = model.getLineMaxColumn(line);
			let pixelPos = this._editor.getScrolledVisiblePosition(new Position(line,col));
			if (pixelPos !== null && pixelPos.left > max) {
				max = pixelPos.left;
			}
		}
		this._maxPixelCol = max;
	}

	public showOrHideConfigDialogBox(){
		if(!this._configBox){
			return;
		}
		this._configBox.style.display = this._configBox.style.display === 'block' ? 'none' : 'block';
	}

	public addConfigDialogBox(){
		let editor_div = this._editor.getDomNode();
		if(!editor_div){
			return;
		}
		let div = document.createElement('div');
		div.textContent = "";
		div.style.position = "absolute";
		div.style.top = "200px";
		div.style.left = "800px";
		div.style.width = '100px';
		div.style.textAlign = 'left';
		div.style.transitionProperty = "all";
		div.style.transitionDuration = "0.3s";
		div.style.transitionDelay = "0s";
		div.style.transitionTimingFunction = "ease-in";
		div.style.boxShadow = "0px 2px 8px black";
		div.className = "monaco-editor-hover";
		div.style.display = 'block';

		/*Creates the row selector
		let row = document.createElement('div');
		let currColor = '#9effb1';
		row.textContent = 'Row';
		row.style.backgroundColor = this._row ? currColor : 'transparent';
		row.onclick = (e) => {
			e.stopImmediatePropagation();
			//Change row
			this._row = true;
			row.style.backgroundColor = this._row ? currColor : 'transparent';
			column.style.backgroundColor = this._row ? 'transparent' : currColor;
		};
		row.style.cssFloat = 'left';
		row.style.width = '35%';
		row.style.margin = '8px';
		row.style.padding = '5px';
		div.appendChild(row);

		//Creates the column selector
		let column = document.createElement('div');
		column.textContent = 'Column';
		column.style.backgroundColor = this._row ? 'transparent' : currColor;
		column.onclick = (e) => {
			e.stopImmediatePropagation();
			//Change col
			this._row = false;
			column.style.backgroundColor = this._row ? 'transparent' : currColor;
			row.style.backgroundColor = this._row ? currColor : 'transparent';
		};
		column.style.width = '35%';
		column.style.margin = '8px';
		column.style.cssFloat = 'right';
		column.style.padding = '5px';
		div.appendChild(column);*/

		let row = document.createElement('input');
		row.type = 'radio';
		row.name = 'row-or-col';
		row.value = 'row';
		row.textContent = 'Row';

		let rowText = document.createElement('label');
		rowText.innerText = 'Row';


		div.appendChild(row);
		div.appendChild(rowText);
		div.appendChild(document.createElement('br'));

		let col = document.createElement('input');
		col.type = 'radio';
		col.name = 'row-or-col';
		col.value = 'col';

		let colText = document.createElement('label');
		colText.innerText = 'Col';
		div.appendChild(col);
		div.appendChild(colText);
		div.appendChild(document.createElement('br'));

		editor_div.appendChild(div);
		this._configBox = div;
	}

	private updateLinesWhenOutOfDate(e: IModelContentChangedEvent, exitCode: number | null) {
		if (exitCode === 0) {
			this._changedLinesWhenOutOfDate = null;
		} else {
			if (this._changedLinesWhenOutOfDate === null) {
				this._changedLinesWhenOutOfDate = new Set();
			}
			let s = this._changedLinesWhenOutOfDate;
			e.changes.forEach((change) => {
				for (let i = change.range.startLineNumber; i <= change.range.endLineNumber; i++){
					s.add(i);
				}
			});
		}
	}

	private getBox(lineNumber:number) {
		let i = lineNumber - 1;
		if (i >= this._boxes.length) {
			for (let j = this._boxes.length; j <= i; j++) {
				this._boxes[j] = new RTVDisplayBox(this, this._editor, this._modeService, this._openerService, j+1);
			}
		}
		return this._boxes[i];
	}

	private padBoxArray() {
		let lineCount = this.getLineCount();
		if (lineCount > this._boxes.length) {
			for (let j = this._boxes.length; j < lineCount; j++) {
				this._boxes[j] = new RTVDisplayBox(this, this._editor, this._modeService, this._openerService, j+1);
			}
		}
	}

	private onChangeCursorPosition(e: ICursorPositionChangedEvent) {
		this.updateLayout();
	}

	private onScrollChange(e:IScrollEvent) {
		if (e.scrollHeightChanged || e.scrollWidthChanged) {
			// this means the content also changed, so we will let the onChangeModelContent event handle it
			return;
		}
		this.updateMaxPixelCol();
		this.updateLayout();
	}

	private onLayoutChange(e: EditorLayoutInfo) {
		this.updateMaxPixelCol();
		this.updateLayout();
	}

	private updateCellSizesForNewContent() {
		if (this.byRowOrCol !== RowColMode.ByRow) {
			return;
		}

		// Compute set of loop iterations
		let loops: string[] = [];
		for (let loop in this.tableCellsByLoop) {
			loops.push(loop);
		}
		// sort by deeper iterations first
		loops = loops.sort((a,b) => b.split(',').length - a.split(',').length);

		let widths: { [k:string]: number; } = {};
		loops.forEach((loop:string) => {
			widths[loop] = Math.max(...this.tableCellsByLoop[loop].map(e=>e.offsetWidth));
			//console.log("Max for " + loop + " :" + widths[loop]);
		});

		let spaceBetweenCells = 2 * this.cellPadding;
		if (this.colBorder) {
			spaceBetweenCells = spaceBetweenCells + 1;
		}
		for (let i = 1; i < loops.length; i++) {
			let width = 0;
			let parent_loop = loops[i];
			for (let j = 0; j < i; j++) {
				let child_loop = loops[j];
				if (child_loop.split(',').length === 1 + parent_loop.split(',').length &&
					strings.startsWith(child_loop, parent_loop)) {
					width = width + widths[child_loop];
					//width = width + widths[child_loop] + spaceBetweenCells;
				}
			}
			if (width !== 0) {
				//width = width - spaceBetweenCells;
				widths[parent_loop] = width;
			}
		}

		loops.forEach((loop:string) => {
			// console.log("Computed width for " + loop + ": " + widths[loop]);
			this.tableCellsByLoop[loop].forEach(e => { e.width = (widths[loop] - spaceBetweenCells) + "px"; });
		});

	}
	public updateContentAndLayout() {
		this.tableCellsByLoop = {};
		this.updateContent();
		// for (let x in this.tableCellsByLoop) {
		// 	this.tableCellsByLoop[x].forEach(y => {
		// 		console.log(x + " " + y.offsetWidth + " " + y.clientWidth);
		// 	});
		// }
		// The following seems odd, but it's really a thing in browsers.
		// We need to let layout threads catch up after we updated content to
		// get the correct sizes for boxes.
		//setTimeout(() => { this.updateLayout();	}, 0);
		setTimeout(() => {
			for (let x in this.tableCellsByLoop) {
				this.tableCellsByLoop[x].forEach(y => {
					//console.log("Delayed: " + x + " " + y.offsetWidth + " " + y.clientWidth);
				});
			}
			this.updateCellSizesForNewContent();
			this.updateLayout();
		}, 0);
	}

	private updateContent() {
		this.padBoxArray();
		this._boxes.forEach((b) => {
			b.updateContent();
		});
	}

	private updateLayout() {
		this.padBoxArray();

		let cursorPos = this._editor.getPosition();
		if (cursorPos === null) {
			return;
		}

		// Compute focused line, which is the closest line to the cursor with a visible box
		let minDist = Infinity;
		let focusedLine = 0;
		for (let line = 1; line <= this.getLineCount(); line++) {
			if (this.getBox(line).visible) {
				let dist = Math.abs(cursorPos.lineNumber - line);
				if (dist <  minDist) {
					minDist = dist;
					focusedLine = line;
				}
			}
		}
		// this can happen if no boxes are visible
		if (minDist === Infinity) {
			return
		}

		// compute distances from focused line, ignoring hidden lines.
		// Start from focused line and go outward.
		let distancesFromFocus: number[] = new Array(this._boxes.length);
		let dist = 0;
		for (let line = focusedLine; line >= 1; line--) {
			if (this.getBox(line).visible) {
				distancesFromFocus[line-1] = dist;
				dist = dist - 1;
			}
		}
		dist = 1;
		for (let line = focusedLine+1; line <= this.getLineCount(); line++) {
			if (this.getBox(line).visible) {
				distancesFromFocus[line-1] = dist;
				dist = dist + 1;
			}
		}

		for (let line = 1; line <= this.getLineCount(); line++) {
			let box = this.getBox(line);
			if (box.visible) {
				box.updateZoomAndOpacity(distancesFromFocus[line-1]);
			}
		}
		// let cursorPixelPos = this._editor.getScrolledVisiblePosition(cursorPos);
		// let nextLinePixelPos = this._editor.getScrolledVisiblePosition(new Position(cursorPos.lineNumber+1,cursorPos.column));
		// if (cursorPixelPos === null || nextLinePixelPos === null) {
		// 	return;
		// }

		let focusedLinePixelPos = this._editor.getScrolledVisiblePosition(new Position(focusedLine, 1));
		let nextLinePixelPos = this._editor.getScrolledVisiblePosition(new Position(focusedLine+1, 1));
		if (focusedLinePixelPos === null || nextLinePixelPos === null) {
			return;
		}

		let spaceBetweenBoxes = this.spaceBetweenBoxes;
		// let top_start = focusedLinePixelPos.top + (focusedLinePixelPos.height / 2);
		//let top_start = (focusedLinePixelPos.top + nextLinePixelPos.top) / 2;
		//let top_start = focusedLinePixelPos.top;
		let top_start = this.getLinePixelMid(focusedLine);
		let top = top_start;
		for (let line = focusedLine-1; line >= 1; line--) {
			let box = this.getBox(line);
			if (box.visible) {
				top = top - spaceBetweenBoxes - box.getHeight();
				let lineMidPoint = this.getLinePixelMid(line);
				if (lineMidPoint < top) {
					top = lineMidPoint;
				}
				box.updateLayout(top);
			}
		}
		top = top_start;
		for (let line = focusedLine; line <= this.getLineCount(); line++) {
			let box = this.getBox(line);
			if (box.visible) {
				let lineMidPoint = this.getLinePixelMid(line);
				if (lineMidPoint > top) {
					top = lineMidPoint;
				}
				box.updateLayout(top);
				top = top + box.getHeight() + spaceBetweenBoxes;
			}
		}

	}

	public getLinePixelPos(line:number): { top: number; left: number; height: number; } {
		let result = this._editor.getScrolledVisiblePosition(new Position(line, 1));
		if (result === null) {
			throw new Error();
		}
		return result;
	}

	public getLinePixelMid(line: number): number {
		let pixelPos = this.getLinePixelPos(line);
		return pixelPos.top + (pixelPos.height / 2)
	}

	private updatePrevModel() {
		let model = this._editor.getModel();
		if (model !== null) {
			this._prevModel = model.getLinesContent().map((x) => x);
		}
	}

	public getLineLastNonWhitespaceColumn(lineNumber: number): number {
		const result = strings.lastNonWhitespaceIndex(this._prevModel[lineNumber-1]);
		if (result === -1) {
			return 0;
		}
		return result + 2;
	}

	private addRemoveBoxes(e: IModelContentChangedEvent) {
		let orig = this._boxes;
		let changes = e.changes.sort((a,b) => Range.compareRangesUsingStarts(a.range,b.range));
		let changeIdx = 0;
		let origIdx = 0;
		let i = 0;
		this._boxes = [];
		let lineCount = this.getLineCount();
		while (i < lineCount) {
			if (changeIdx >= changes.length) {
				this._boxes[i++] = orig[origIdx++];
				this._boxes[i-1].lineNumber = i;
			} else {
				let line = i + 1;
				let change = changes[changeIdx];
				let numAddedLines = change.text.split("\n").length-1;
				let changeStartLine = change.range.startLineNumber;
				let changeEndLine = change.range.endLineNumber;
				let numRemovedLines = changeEndLine - changeStartLine;
				let deltaNumLines = numAddedLines - numRemovedLines;
				let changeStartCol = change.range.startColumn;
				if ((deltaNumLines <= 0 && changeStartLine === line) ||
					(deltaNumLines > 0 && ((changeStartLine === line && changeStartCol < this.getLineLastNonWhitespaceColumn(line)) ||
						 				   (changeStartLine === line-1 && changeStartCol >= this.getLineLastNonWhitespaceColumn(line-1))))) {
					changeIdx++;
					if (deltaNumLines === 0) {
						// nothing to do
					} else if (deltaNumLines > 0) {
						for (let j = 0; j < deltaNumLines; j++) {
							let new_box = new RTVDisplayBox(this, this._editor, this._modeService, this._openerService, i+1);
							this._boxes[i++] = new_box;
						}
					} else {
						for (let j = origIdx; j < origIdx + (-deltaNumLines); j++) {
							orig[j].destroy();
						}
						// need to make the removed boxes disapear
						origIdx = origIdx + (-deltaNumLines);
					}
				}
				else {
					this._boxes[i++] = orig[origIdx++];
					this._boxes[i-1].lineNumber = i;
				}
			}
		}
		this.updatePrevModel();
	}

	private onChangeModelContent(e: IModelContentChangedEvent) {
		let py3 = process.env["PYTHON3"];
		if (py3 === undefined) {
			return;
		}
		let runpy = process.env["RUNPY"];
		if (runpy === undefined) {
			return;
		}
		//console.log(e);
		this.padBoxArray();
		this.addRemoveBoxes(e);
		this.updateMaxPixelCol();
		let code_fname = os.tmpdir() + path.sep + "tmp.py";
		let model = this._editor.getModel();
		if (model === null) {
			return;
		}
		let lines = model.getLinesContent();
		fs.writeFileSync(code_fname, lines.join("\n"));
		let c = cp.spawn(py3, [runpy, code_fname]);

		c.stdout.on("data", (data) => {
			//console.log(data.toString())
		});
		c.stderr.on("data", (data) => {
			//console.log(data.toString())
		});
		c.on('exit', (exitCode, signalCode) => {
			//console.log("Exit code from run.py: " + exitCode);
			this.updateLinesWhenOutOfDate(e, exitCode);
			if (exitCode === 0) {
				this.updateData(fs.readFileSync(code_fname + ".out").toString());
				this.updateContentAndLayout();
				//console.log(envs);
			}
			else {
				this.updateContentAndLayout();
			}
		});

	}

	private updateData(str: string) {
		let data = JSON.parse(str);
		this.envs = data[1];
		this.writes = data[0];
	}

	public varRemoveInThisBox(varname: string, box: RTVDisplayBox) {
		box.varRemove(varname);
		this.updateContentAndLayout();
	}

	public varRemoveInAllBoxes(varname: string) {
		this._boxes.forEach((box) => {
			box.varRemove(varname);
		});
		this.updateContentAndLayout();
	}

	public varKeepOnlyInThisBox(varname: string, box: RTVDisplayBox) {
		box.varKeepOnly(varname);
		this.updateContentAndLayout();
	}

	public varKeepOnlyInAllBoxes(varname: string) {
		this._boxes.forEach((box) => {
			box.varKeepOnly(varname);
		});
		this.updateContentAndLayout();
	}

	public varAddInThisBox(varname: string, box: RTVDisplayBox) {
		box.varAdd(varname);
		this.updateContentAndLayout();
	}

	public varAddInAllBoxes(varname: string) {
		this._boxes.forEach((box) => {
			box.varAdd(varname);
		});
		this.updateContentAndLayout();
	}

	public varAddAllInThisBox(box: RTVDisplayBox) {
		box.varAddAll();
		this.updateContentAndLayout();
	}

	public varAddAllInAllBoxes() {
		this._boxes.forEach((box) => {
			box.varAddAll();
		});
		this.updateContentAndLayout();
	}

	public hideBox(box: RTVDisplayBox) {
		box.varRemoveAll();
		this.updateContentAndLayout();
	}

	public hideAllOtherBoxes(box: RTVDisplayBox) {
		this._boxes.forEach((b) => {
			if (b !== box) {
				b.varRemoveAll();
			}
		});
		this.updateContentAndLayout();
	}

	public restoreBoxToDefault(box: RTVDisplayBox) {
		box.varRestoreToDefault();
		this.updateContentAndLayout();
	}

	public restoreAllBoxesToDefault() {
		this._boxes.forEach((box) => {
			box.varRestoreToDefault();
		});
		this.updateContentAndLayout();
	}

}

registerEditorContribution(RTVCoordinator);

const boxAlignsToTopOfLineKey = 'rtv.box.alignsToTopOfLine';
const boxBorderKey = 'rtv.box.border';
const byRowOrColKey = 'rtv.box.byRowOrColumn';
const cellPaddingKey = 'rtv.box.cellPadding';
const colBorderKey = 'rtv.box.colBorder';
const displayOnlyModifiedVarsKey = 'rtv.box.displayOnlyModifiedVars';
const opacityKey = 'rtv.box.opacity';
const showBoxAtLoopStmtKey = 'rtv.box.showBoxAtLoopStatements';
const spaceBetweenBoxesKey = 'rtv.box.spaceBetweenBoxes';
const zoomKey = 'rtv.box.zoom';
const presetsKey = 'rtv.presets';

Registry.as<IConfigurationRegistry>(Extensions.Configuration).registerConfiguration({
	'id': 'rtv',
	'order': 110,
	'type': 'object',
	'title': localize('rtvConfigurationTitle', "RTV"),
	'properties': {
		[presetsKey]: {
			'type': 'string',
			'enum': ['full', 'compact', 'custom'],
			'enumDescriptions': [
				localize('presets.full', 'Full View'),
				localize('presets.compact', 'Compact View')
			],
			'default': 'full',
			'description': localize('presetDescr', 'Allows you to choose different mdoes (which are preset configurations)')
		},
		[boxAlignsToTopOfLineKey]: {
			'type': 'boolean',
			'default': false,
			'description': localize('boxalignstop', 'Controls whether box aligns to top of line (true: align to top of line; false: align to middle of line )')
		},
		[boxBorderKey]: {
			'type': 'boolean',
			'default': true,
			'description': localize('boxborder', 'Controls whether boxes have a border')
		},
		[byRowOrColKey]: {
			'type': 'string',
			'enum': ['byCol', 'byRow'],
			'enumDescriptions': [
				localize('byRowOrColumn.byCol', 'Each column is a variable'),
				localize('byRowOrColumn.byRow', 'Each row is a variable')
			],
			'default': 'byCol',
			'description': localize('byroworcol', 'Controls if variables are displayed in rows or columns')
		},
		[cellPaddingKey]: {
			'type': 'number',
			'default': 6,
			'description': localize('padding', 'Controls padding for each data cell')
		},
		[colBorderKey]: {
			'type': 'boolean',
			'default': false,
			'description': localize('colborder', 'Controls whether columns in box have a border')
		},
		[displayOnlyModifiedVarsKey]: {
			'type': 'boolean',
			'default': false,
			'description': localize('modvarsonly', 'Controls whether only modified vars are shown (true: display only mod vars; false: display all vars)')
		},
		[opacityKey]: {
			'type': 'number',
			'default': 0,
			'description': localize('zoom', 'Controls opacity level (value between 0 and 1; 0: see-through; 1: no see-through)')
		},
		[showBoxAtLoopStmtKey]: {
			'type': 'boolean',
			'default': false,
			'description': localize('showboxatloop', 'Controls whether boxes are displayed at loop statements')
		},
		[spaceBetweenBoxesKey]: {
			'type': 'number',
			'default': 20,
			'description': localize('boxspace', 'Controls spacing between boxes')
		},
		[zoomKey]: {
			'type': 'number',
			'default': 0,
			'description': localize('zoom', 'Controls zoom level (value between 0 and 1; 0 means shrink; 1 means no shrinking)')
		}
	}
});

class ConfigurationServiceCache {
	private _vals: { [k:string]: any; } = {};
	public onDidUserChangeConfiguration: (e:IConfigurationChangeEvent)=>void;
	constructor(private readonly configurationService: IConfigurationService) {
		this.configurationService.onDidChangeConfiguration((e) => { this.onChangeConfiguration(e); });
	}

	public getValue<T>(key: string): T {
		let result = this._vals[key];
		if (result === undefined) {
			result = this.configurationService.getValue(key);
			this._vals[key] = result;
		}
		return result;
	}

	public updateValue(key: string, value: any) {
		this._vals[key] = value;
		this.configurationService.updateValue(key, value);
	}

	private onChangeConfiguration(e: IConfigurationChangeEvent) {
		e.affectedKeys.forEach((key: string) => {
			if (strings.startsWith(key, 'rtv')) {
				let v = this.configurationService.getValue(key);
				if (v !== this._vals[key]) {
					this._vals[key] = v;
					if (this.onDidUserChangeConfiguration !== undefined) {
						this.onDidUserChangeConfiguration(e);
					}
				}
			}
		});
	}
}