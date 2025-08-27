// eslint-disable-next-line code-import-patterns
import { IRTVController, ViewMode, } from "../RTVInterfaces.js";
import { Range as RangeClass, Range } from '../../../common/core/range.js';
import {
	example,
	firstNonCommentLine,
	getFunctionCode, getLineIndent,
	makeEmptyTable,
	TableElement
} from '../RTVUtils.js';

import { RTVSynthModel } from "..//RTVSynthModel.js";
import { DecorationManager, DecorationType } from "../RTVDecorations.js";
import { SpecificationsRangeProvider } from "./SpecificationsRangeProvider.js";
import { RTVController } from "../RTVDisplay.js";
import { ParsedComment } from "./RTVComment.js";
import { ICodeEditor } from '../../../browser/editorBrowser.js';
import { RTVSpecification } from '../RTVSpecification.js';
import { RTVInputBox } from '../RTVInputBox.js';
import { FoldingController } from '../../folding/browser/folding.js';
import { FoldingModelChangeEvent } from '../../folding/browser/foldingModel.js';
import { IModelContentChangedEvent } from '../../../common/textModelEvents.js';
import { Selection as MonacoSelection } from '../../../common/core/selection.js';
import { SYNTHESIZED_COMMENT_END, SYNTHESIZED_COMMENT_START } from './RTVCommentsConsts.js';
import { IPythonParserService } from '../../../../workbench/contrib/rtv/common/Ipython_parse.js';
import { displayError } from '../RTVSynthView.js';
import { IRTVLogger, IRTVLoggerService } from '../../../../workbench/contrib/rtv/common/IRTVLogger.js';
import { getScopeIdx } from './RTVCommentsUtils.js';
import { IRTVNodeUtils, IRTVNodeUtilsService } from '../../../../workbench/contrib/rtv/common/IRTVNodeUtils.js';
import { ILanguageFeaturesService } from '../../../common/services/languageFeatures.js';
import { IDisposable } from 'monaco-editor';

//const FAKE_TIME = 100;


// this class is in charge of all the comments in the editor.
export class CommentsManager {

	private _disposable: IDisposable;

	get specifications(): RTVSpecification {
		return this._specifications;
	}
	private comments: { [index: number]: DecorationManager } = {}; // map from comment idx to the decorations ids
	private _specifications: RTVSpecification;
	private inputBox: RTVInputBox | undefined = undefined; // used to get user's input for more examples.
	private _folded: { [index: number]: boolean } = {}
	constructor(private readonly controller: RTVController,
		private readonly editor: ICodeEditor,
		@IRTVLoggerService private readonly logger: IRTVLogger,
		@IPythonParserService private readonly parsePythonService: IPythonParserService,
		@IRTVNodeUtilsService private readonly RTVUtils: IRTVNodeUtils,
		@ILanguageFeaturesService private readonly languageFeaturesService: ILanguageFeaturesService) {
		this._specifications = new RTVSpecification();
		this._disposable = this.languageFeaturesService.foldingRangeProvider.register(
            '*',
            new SpecificationsRangeProvider()
        );
		const registerOnDidChangeFolding = () => {
			const foldingController: FoldingController = FoldingController.get(editor)!;
			foldingController.getFoldingModel()?.then(foldingModel => {
				foldingModel!.onDidChange((e) => {
					this.onFold(e);
					setTimeout(() => this.controller.renderLayout(), 200); // after the folding happens.
				});
			});
		};
		this.editor.onDidChangeModel((e) => registerOnDidChangeFolding());
		this.editor.onDidChangeModelContent((e) => { this.onDidChangeModelContent(e); });
	}

	dispose() {
        this._disposable.dispose();
    }

	private onFold(e: FoldingModelChangeEvent) {
		if (e.collapseStateChanged) {
			let commentStartLineno = e.collapseStateChanged[0].startLineNumber
			let scopeIdx = this.getScopeIdxForLine(commentStartLineno);
			let decorationManager = this.comments[scopeIdx];
			if (e.collapseStateChanged[0].isCollapsed) {
				decorationManager.fold();
				this._folded[scopeIdx] = true;
			}
			else {
				decorationManager.unfold();
				this._folded[scopeIdx] = false;
			}
		}
	}

	/**
	 * Given a lineno of a #! comment, returns the block index it belongs to.
	 * @param lineno
	 * @private
	 */
	private getScopeIdxForLine(lineno: number) {
		return getScopeIdx(lineno, this.editor.getModel()!.getLinesContent());
	}

	public getScopeIdx(lineno: number, lines: string[]): number {
		return getScopeIdx(lineno, lines);
	}

	public async getScopeSpecification(scopeIdx: number) {
		let model = this.controller.getModelForce();
		await this._specifications.gatherComments(model.getLinesContent().join("\n"));
		return this._specifications.getSpecificationOfScope(scopeIdx)

	}

	public getExamples() {
		let model = this.controller.getModelForce();
		return this._specifications.getExamples(model.getLinesContent().join("\n"));
	}

	private convertExampleToString(example: example, idx: number) {
		let leftSide = `#! ${idx}) `;
		Object.keys(example.inputs).forEach((inputVar) => {
			leftSide += `${inputVar.replace("_in", "")} = ${example.inputs[inputVar]}, `; // add the input vars
		});
		leftSide = leftSide.substring(0, leftSide.length - 2); //remove the last ', '

		let rightSide = ``;
		Object.keys(example.outputs).forEach((outputVar) => {
			rightSide += `${outputVar} = ${example.outputs[outputVar]}, `; // add the output vars
		});
		rightSide = rightSide.substring(0, rightSide.length - 2); //remove the last ', '
		return `${leftSide} => ${rightSide} \n`;
	}

	/**
	 * @param synthModel the synthmodel the was used to synthesize the code.
	 * @returns the number of lines that lineno needs to be increased.
	 */
	public insertExamples(synthModel: RTVSynthModel) {
		let outVars = synthModel!.varnames;
		let examplesCounter = 1;
		let examples: string = ``;
		let synthExamples = synthModel.getExamples();
		for (let example of synthExamples) {
			examples += this.convertExampleToString(example, examplesCounter++);
		}

		this.logger.insertComments(synthModel.getLineno(), examples);
		this.insertExamplesToEditor(examples, outVars, synthModel.getLineno());
		// increasing lineno so the synth won't override these comments
		return (examples.split("\n")).length;
	}

	public async wrapWithExamples(range: Range) {
		// Update the projection box with the new value
		const runResults: any = await this.controller.updateBoxes();

		let firstLineno = range.startLineNumber;
		let lastLineno = range.endLineNumber;
		// let firstBox:RTVDisplayBox;
		// for(let i=firstLineno - 1; i < lastLineno; i++){
		// 	if(this.controller.envs[i]){
		// 		firstBox = this.controller.getBox(i+1);
		// 		break
		// 	}
		// }
		let reserved_names: string[] = ["time", "#", "$", "lineno", "prev_lineno", "next_lineno", "__run_py__"];


		let allEnvs: any[] = [];
		for (let line in (runResults[2] as { [k: string]: any[]; })) {
			allEnvs = allEnvs.concat(runResults[2][line]);
		}

		let firstCodeLine = firstNonCommentLine(this.editor.getModel()!.getLinesContent().slice(firstLineno, lastLineno)) + firstLineno;
		let lineEnvs = allEnvs.filter(env => env["lineno"] == firstCodeLine);
		if (lineEnvs.length == 0) {
			displayError("Failed wrapping with examples. Try adding an empty line before the selection.", this.editor);
			return
		}
		let time = lineEnvs[0]["time"];
		let liveVars = Object.keys(lineEnvs[0]).filter(v => !reserved_names.includes(v))
		if (!time) {
			time = lineEnvs[1]["time"]; // maybe in the second TODO:fix it
			liveVars = Object.keys(lineEnvs[1]).filter(v => !reserved_names.includes(v))
		}


		let inputVars = Array.from(liveVars).filter(v => !reserved_names.includes(v));
		let outputVars = this.getAllAssignedVars(firstLineno, lastLineno);
		let insertScope = () => {
			let userExample = this.inputBox?.getBoxAsExample()!
			let exampleAsString = this.convertExampleToString(userExample, 1);
			this.insertExamplesToEditor(exampleAsString, Object.keys(userExample.outputs), firstLineno, lastLineno);
			this.onExit(firstLineno);
		}
		if (this.controller)
			this.setUpInputBox(inputVars, outputVars, firstLineno, insertScope);


	}
	public insertStaticExamples(parsedComment: ParsedComment, lineno: number): void {
		let examples: string = parsedComment.asString();
		this.logger.insertComments(lineno, examples);
		this.insertExamplesToEditor(examples, parsedComment.outputVarNames, lineno);
	}

	public insertOneExample(example: example, lineno: number, examplesIdx: number): void {
		const exampleString = this.convertExampleToString(example, examplesIdx).replace("\n", "");
		this.insertExamplesToEditor(exampleString, Object.keys(example.outputs), lineno, lineno, false);
	}


	/**
	 * this function is in charge of inserting the text at the right place in the editor.
	 * it will also update the cursor position to point to the next line.
	 * @param examples- the examples to insert
	 * @param outVars - the variables that were synthesized
	 * @param lineno - the line number to insert the text at
	 */
	private insertExamplesToEditor(examples: string, outVars: string[], lineno: number, endLineno: number = lineno, withProlog: boolean = true) {
		let model = this.controller.getModelForce();
		let cursorPos = this.editor.getPosition();
		let startCol: number;
		let endCol: number = 0;
		if (
			model.getLineContent(lineno).trim() === '' &&
			cursorPos !== null &&
			cursorPos.lineNumber === lineno
		) {
			startCol = cursorPos.column;
			endCol = cursorPos.column;
		} else {
			startCol = 1// model.getLineFirstNonWhitespaceColumn(lineno);
			for (let i = lineno; i <= endLineno; i++) {
				endCol = Math.max(model.getLineMaxColumn(i), endCol);
			}

		}
		let firstLineIndent = getLineIndent(model.getLinesContent()[lineno - 1])
		examples = examples.split("\n").map((example) => {
			if (example != "")
				return firstLineIndent + example
			else
				return ""
		}
		).join("\n");
		let range = new RangeClass(lineno, startCol, endLineno, endCol);
		let oldText = model.getValueInRange(range);
		let prolog = firstLineIndent + SYNTHESIZED_COMMENT_START + "\n";
		let epilogue = "\n" + firstLineIndent + SYNTHESIZED_COMMENT_END + "\n";
		let newText;
		if (withProlog)
			newText = prolog + examples + oldText + epilogue;
		else
			newText = examples;

		this.editor.pushUndoStop();
		let startLine = withProlog ? lineno + newText.split('\n').length - 2 : lineno;

		let selection = new MonacoSelection(
			startLine,
			startCol,
			startLine,
			startCol + newText.length
		); // Adjusted to match the expected arguments

		this.editor.executeEdits(
			this.controller.getId(),
			[{ range: range, text: newText }],
			[selection]
		);

	}

	/**
	 * This function will clean the comment starting from lineno.
	 *
	 * @returns the indent of the code that was deleted .
	 */
	static removeCommentsAndCode(controller: IRTVController, editor: ICodeEditor, lineno: number, endLineno: number, replacedText: string = "") {
		let model = controller.getModelForce();

		let startCol = model.getLineFirstNonWhitespaceColumn(lineno);
		let endCol = startCol;
		for (let i = lineno; i < endLineno; i++) {
			let curr_end_col = model.getLineMaxColumn(i);
			if (curr_end_col > endCol) {
				endCol = curr_end_col;
			}
		}
		let range = new Range(lineno, startCol, endLineno, endCol);
		let selection = new MonacoSelection(
			lineno,
			startCol,
			lineno,
			startCol //+ replacedText.length
		);
		let oldLines = model.getLinesContent().slice(lineno - 1, endLineno);
		oldLines[0] = oldLines[0].trim()// remove the first tab since we insert in the right indent
		let oldText = oldLines.join("\n");
		editor.pushUndoStop();
		editor.executeEdits(
			controller.getId(),
			[{ range: range, text: oldText.replace("!!", "") }],
			[selection]
		);
		editor.pushUndoStop(); // pushing a state where no !! is present

		editor.pushUndoStop();
		editor.executeEdits(
			controller.getId(),
			[{ range: range, text: replacedText }],
			[selection]
		);


		editor.popUndoStop(); // make sure you can't return to the  ... state ?
		return startCol;
	}

	/**
	 * This function will search the end of the block that starts at lineno.
	 * @param lineno
	 */
	public getBlockSize(lineno: number): number {
		let model = this.controller.getModelForce();
		//scan all lines until we find equal number of #start and #end
		let startCount = 0;
		let endCount = 0;
		let i = lineno;
		while (i < model.getLineCount()) {
			let line = model.getLineContent(i);
			if (line.includes(SYNTHESIZED_COMMENT_START)) {
				startCount++;
			}
			if (line.includes(SYNTHESIZED_COMMENT_END)) {
				endCount++;
			}
			if (startCount === endCount) {
				return i - lineno;
			}
			i++;
		}
		return -1;// error - no end found - it is a function block
	}

	public async updateComments(testResults: RTVTestResults,) {
		await this._specifications.gatherComments(this.editor.getModel()!.getLinesContent().join("\n"));
		const blocksLines = testResults.commentsLocation;
		//delete all the decorations in previous blocks
		for (let decorationManager of Object.values(this.comments)) {
			decorationManager.removeAllDecoration();
		}
		this.comments = {};
		let endLinenos: number[] = [1];
		let currentMargin: number = 0;
		//the tests aer organized by ordered - from top to bottom.
		Object.keys(testResults.commentsLines).map(x => parseInt(x)).forEach(blockId => {
			let commentInfo: linesInfo = blocksLines[blockId];

			while (commentInfo.start >= endLinenos[endLinenos.length - 1]) {
				endLinenos.pop();
			}
			const col = this.editor.getModel()!.getLineFirstNonWhitespaceColumn(commentInfo.start);
			const prevCol = this.editor.getModel()!.getLineFirstNonWhitespaceColumn(endLinenos[endLinenos.length - 1])
			if (col > prevCol) {
				currentMargin = 0; // no need to add margin there is indent
			}
			else {
				let currentIndents = endLinenos.map(x => this.editor.getModel()!.getLineFirstNonWhitespaceColumn(x)).filter(x => x == col);
				currentMargin = currentIndents.length;
			}
			endLinenos.push(commentInfo.end);

			const results = testResults.getResultsForBlock(blockId);
			let parsedComment = this._specifications.comments[blockId];

			let isFolded: boolean = this._folded[blockId] ?? false;
			this.comments[blockId] = new DecorationManager(this.controller, this.editor, blockId, blocksLines[blockId].start!, this.getBlockSize(parsedComment.lineno), isFolded, currentMargin);
			results.forEach((result, index) => {
				let type = DecorationType.passTest;
				if (result[0] === false) {
					type = DecorationType.failedTest;
				}
				else if (result[0] === 'conflict') {
					type = DecorationType.conflict;
				}
				this.comments[blockId].addDecoration(index, type, result[1]);
			});
			this.comments[blockId].render();
		}
		);
	}

	public blockContainsConflict(blockId: number): boolean {
		return Object.values(this.comments[blockId].decorationsTypes).includes(DecorationType.conflict);
	}
	public async getParsedComment(lineno: number): Promise<ParsedComment> {
		let model = this.controller.getModelForce();
		let program = model.getLinesContent().slice(lineno);
		let parsedComment = await this.RTVUtils.parseComment(program.join(""));
		parsedComment.scopeId = this.getScopeIdxForLine(lineno);
		parsedComment.lineno = lineno;
		return parsedComment;
	}

	private setUpInputBox(inputVarNames: string[], outputVarsNames: string[], lineno: number, onEnterPressed: () => void) {
		this.controller.changeViewMode(ViewMode.Stealth);
		this.controller.disable();


		let box = this.controller.getBox(lineno);
		//enter a dummy box
		box.setTableInBox(new Set(["x", "y", "z"]), ["y"], [], false);

		let rows = makeEmptyTable(inputVarNames, outputVarsNames, lineno);

		inputVarNames = inputVarNames.map(varName => outputVarsNames.includes(varName) ? `${varName}_in` : varName);
		this.inputBox = new RTVInputBox(
			this.editor,
			box.getLine().getElement(),
			box.getElement(),
			box.getLanguageService(),
			box.getOpenerService(),
			lineno,
			this.controller.getThemeService(),
			inputVarNames,
			outputVarsNames,
			rows
		);


		this.inputBox.bindExitSynth(() => this.onExit(lineno));
		this.inputBox.bindOnEnterPresses(onEnterPressed);


		this.inputBox.updateBoxContent(rows, true);
		this.makeTableEditable(rows);

		this.inputBox.selectFirstEditableCell();

	}
	private async onDidChangeModelContent(e: IModelContentChangedEvent) {
		this.alignCommands();
		let cursorPos = this.editor.getPosition();
		if (cursorPos === null) {
			return;
		}
		let lineno = cursorPos.lineNumber;
		const lineContent = this.controller.getLineContent(lineno).trim();
		if (lineContent === "#!" && !this.inputBox) {
			let inputVarNames = await this.getInputVars(lineno);
			let outVarNames = await this.getOutputVars(lineno);
			this.setUpInputBox(inputVarNames, outVarNames, lineno, () => { this.onEnter(lineno) });
			this.onExit(lineno);
			this.setUpInputBox(inputVarNames, outVarNames, lineno, () => { this.onEnter(lineno) });
		}
	}

	//------------------------------------------------ helping functions-------------------------------------

	private alignCommands() {
		let model = this.controller.getModelForce();
		let code = model.getLinesContent();
		let changed = false;
		for (var i = 1; i < code.length; i++) {
			if (code[i].trim().startsWith("#!") && !code[i - 1].includes(SYNTHESIZED_COMMENT_END)) {
				if (code[i - 1].trimLeft().startsWith("#!")) {
					let prevLineIndent = getLineIndent(code[i - 1])
					let currentLineIindent = getLineIndent(code[i])
					if (currentLineIindent != prevLineIndent) {
						code[i] = prevLineIndent + code[i].trimLeft();
						changed = true;
					}
				}
			}
		}
		if (changed) {
			let codeRange = model.getFullModelRange();
			this.controller.executeEdits([{ range: codeRange, text: code.join("\n") }]);
		}
	}

	private makeTableEditable(rows: TableElement[][]) {
		for (let rowIdx = 1; rowIdx < rows.length; rowIdx++) {
			const row = rows[rowIdx];
			for (let _colIdx = 0; _colIdx < row.length; _colIdx++) {
				const elmt = row[_colIdx];
				const vname = elmt.vname!;
				let cell = this.inputBox!.getCell(vname, rowIdx - 1)!;
				this.inputBox!.addCellContentAndStyle(cell, elmt, rowIdx == 0);

			}
		}
	}
	private onEnter(lineno: number) {
		const exampleIdx = this.getPrevCommentIndex(lineno) + 1;
		this.insertOneExample(this.inputBox?.getBoxAsExample()!, lineno, exampleIdx);
		this.onExit(lineno);
	}
	private onExit(lineno: number) {
		this.inputBox!.destroy();
		this.inputBox = undefined;
		this.controller.getBox(lineno).destroy();
		this.controller.enable();
		this.controller.resetChangedLinesWhenOutOfDate();
		this.controller.updateBoxes();
		this.controller.changeViewMode(ViewMode.Full);
		this.editor.focus();
	}


	getInputVars = (lineno: number) => {
		let lineContent = this.editor.getModel()?.getLineContent(lineno + 1);
		if (lineContent?.trim().startsWith("def")) {
			let functionStr = getFunctionCode(this.editor.getModel()?.getLinesContent()!, lineno + 1);
			let vars = this.parsePythonService.findVariableNames(functionStr);
			// add call
			return vars;
		}
		return this.getScopeComment(lineno)!.inVarNames;
	}

	getOutputVars = (lineno: number) => {
		let lineContent = this.editor.getModel()?.getLineContent(lineno + 1);
		if (lineContent?.trim().startsWith("def")) {
			return ["rv"];
		}
		return this.getScopeComment(lineno)!.outVarNames;

	}

	getAllAssignedVars = (i: number, j: number) => {
		const assignmentPattern: RegExp = /^\s*([a-zA-Z_]\w*)\s*\+?-?\*?=\s*.*$/;
		let varNames: string[] = [];
		for (let lineno = i; lineno <= j; lineno++) {
			let lineContent = this.editor.getModel()?.getLineContent(lineno);
			if (assignmentPattern.test(lineContent!) && !lineContent?.includes("=>")) {
				const match = lineContent!.match(assignmentPattern);
				const variableName = match && match[1];// no support for double assignment
				varNames = varNames.concat(variableName!);
			}
		}

		varNames = Array.from(new Set(varNames).values()); // remove dups
		varNames = varNames.map(x => x.trim());
		return varNames;
	}

	getPrevCommentIndex = (lineno: number) => {

		if (lineno == 1) return 0;
		let lineContent = this.editor.getModel()?.getLineContent(lineno - 1).trim()!;
		const regex = /^#! *(\d+)/;
		const match = lineContent.match(regex);
		if (match && match[1]) {
			return parseInt(match[1]);
		}
		return 0;

	}
	public getScopeComment(lineno: number) {
		const lines = this.editor.getModel()?.getLinesContent()!;
		for (let i = lineno; i > 0; i--) {
			if (lines[i].includes(SYNTHESIZED_COMMENT_START)) {
				return this._specifications.comments[this.getScopeIdxForLine(i)];
			}
		}
		console.assert(false);
		return undefined;
	}

}

type linesInfo = {
	start: number,
	end: number
}

export class RTVTestResults {
	get commentsLines(): { [p: string]: linesInfo } {
		return this._commentsLines;
	}
	private results: any;
	private _commentsLines: { [commentId: string]: linesInfo };

	constructor(testResults: any) {
		const parsed = JSON.parse(testResults);
		this.results = parsed[0]; //
		this._commentsLines = parsed[1];
	}

	public markAsConflict(envIdx1: number, commentIdx1: number, lineno1: number, envIdx2: number, commentIdx2: number, lineno2: number): void {
		let conflictString = 'This example is in conflict with the example on line:'
		if (this.results[(`(${envIdx1}, ${commentIdx1})`)][0] === 'conflict') {
			this.results[(`(${envIdx1}, ${commentIdx1})`)] = ['conflict', this.results[(`(${envIdx1}, ${commentIdx1})`)][1] + `, ${lineno2}`];
		}
		else {
			this.results[(`(${envIdx1}, ${commentIdx1})`)] = ['conflict', `${conflictString} ${lineno2}`];
		}
		if (this.results[(`(${envIdx2}, ${commentIdx2})`)][0] === 'conflict') {
			this.results[(`(${envIdx2}, ${commentIdx2})`)] = ['conflict', this.results[(`(${envIdx2}, ${commentIdx2})`)][1] + `, ${lineno1}`];
		}
		else {
			this.results[(`(${envIdx2}, ${commentIdx2})`)] = ['conflict', `${conflictString} ${lineno1}`];
		}
	}
	get commentsLocation(): { [p: string]: linesInfo } {
		return this._commentsLines;
	}

	public getLiveBlockIds() {
		return Object.keys(this._commentsLines).map(parseInt);
		// return the ids of the live blocks. it is the first element in the keys of the results separated by ..
		// var ids=  Object.keys(this.results).map((key)=> {
		// 	return parseInt(key.match(/\d+/g)![0], 10);
		// });
		// return Array.from(new Set(ids).values());
	}

	public getResultsForBlock(blockId: number,) {
		const tupleKeys: any[] = Object.keys(this.results).map(tupleString => tupleString.match(/-?\d+/g)!.map(x => parseInt(x, 10)));
		const keys = tupleKeys.filter(x => x[0] === blockId);
		const results = new Map<number, any>();
		for (let key of keys) {
			const envIdx: number = key[1];
			results.set(envIdx, this.results[`(${key.join(", ")})`]);
		}
		return results;
	}
}
