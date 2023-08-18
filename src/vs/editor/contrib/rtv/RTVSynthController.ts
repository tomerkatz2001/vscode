import { Range as RangeClass } from 'vs/editor/common/core/range';
import { Selection } from 'vs/editor/common/core/selection';
import { ICodeEditor } from 'vs/editor/browser/editorBrowser';
import { getUtils, TableElement } from 'vs/editor/contrib/rtv/RTVUtils';
import {
	Utils,
	RunResult,
	SynthResult,
	SynthProblem,
	IRTVLogger,
	IRTVController,
	ViewMode,
	SynthProcess,
	ReSynthProcess
} from './RTVInterfaces';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { RTVDisplayBox } from 'vs/editor/contrib/rtv/RTVDisplay';
import { RTVSynthView } from 'vs/editor/contrib/rtv/RTVSynthView';
import { RTVSynthModel } from 'vs/editor/contrib/rtv/RTVSynthModel';
import {CommentsManager, ParsedComment} from "vs/editor/contrib/rtv/comments/index";


enum EditorState {
	Synthesizing,
	Failed,
	HasProgram,
	resynthesizing,
}

class EditorStateManager {
	private readonly SYNTHESIZING_INDICATOR: string;
	private readonly SYNTH_FAILED_INDICATOR: string;
	private _state: EditorState = EditorState.HasProgram;

	constructor(
		l_operand: string,
		private lineno: number,
		private editor: ICodeEditor,
		private controller: IRTVController) {
		this.SYNTHESIZING_INDICATOR = `${l_operand} = ...`;
		this.SYNTH_FAILED_INDICATOR = `${l_operand} = '🤯'`;
	}

	get state(): EditorState {
		return this._state;
	}

	/**
	 * adds delta to the line number of the current state
	 * @param delta
	 */
	moveLinenoBy(delta: number) {
		this.lineno += delta;
	}

	synthesizing() {
		if (this._state === EditorState.Synthesizing) {return;}
		this._state = EditorState.Synthesizing;
		this.insertFragment(this.SYNTHESIZING_INDICATOR);
	}

	resynthesizing(strartLine: number, endLine: number) {
		if(this._state === EditorState.resynthesizing) {return;}
		this._state = EditorState.resynthesizing;
		CommentsManager.removeCommentsAndCode(this.controller, this.editor, strartLine, endLine,this.SYNTHESIZING_INDICATOR);
	}

	failed() {
		if (this._state === EditorState.Failed) {return;}
		this._state = EditorState.Failed;
		this.insertFragment(this.SYNTH_FAILED_INDICATOR);
	}

	program(program: string) {
		this._state = EditorState.HasProgram;
		this.insertFragment(program);
	}

	private insertFragment(fragment: string): void {
		// Cleanup fragment
		// TODO We don't support return ?? sadly.
		// if (fragment.startsWith('rv = ')) {
		// 	fragment = fragment.replace('rv = ', 'return ');
		// }
		let model = this.controller.getModelForce();
		let cursorPos = this.editor.getPosition();
		let startCol: number;
		let endCol: number;

		if (
			model.getLineContent(this.lineno).trim() === '' &&
			cursorPos !== null &&
			cursorPos.lineNumber === this.lineno
		) {
			startCol = cursorPos.column;
			endCol = cursorPos.column;
		} else {
			startCol = model.getLineFirstNonWhitespaceColumn(this.lineno);
			endCol = model.getLineMaxColumn(this.lineno);
		}
		let range = new RangeClass(this.lineno, startCol, this.lineno, endCol);

		// Add spaces for multiline results
		if (fragment.includes('\n')) {
			let indent = (model.getOptions()!.insertSpaces) ? ' ' : '\t';
			fragment = fragment.split('\n').join('\n' + indent.repeat(startCol - 1));
		}

		this.editor.pushUndoStop();
		let selection = new Selection(
			this.lineno,
			startCol,
			this.lineno,
			startCol + fragment.length
		);
		this.editor.executeEdits(
			this.controller.getId(),
			[{ range: range, text: fragment }],
			[selection]
		);
	}
}

export class RTVSynthController {
	private _synthModel?: RTVSynthModel = undefined;
	private _synthView?: RTVSynthView = undefined;
	private logger: IRTVLogger;
	enabled: boolean;
	lineno?: number = undefined;
	utils: Utils;
	process: SynthProcess;
	resynthProcess: ReSynthProcess;
	editorState?: EditorStateManager = undefined;

	constructor(
		private readonly editor: ICodeEditor,
		private readonly RTVController: IRTVController,
		@IThemeService readonly _themeService: IThemeService,
		private readonly  commentsManager: CommentsManager
	) {
		this.utils = getUtils();
		this.logger = this.utils.logger(editor);
		this.process = this.utils.synthesizer();
		this.resynthProcess = this.utils.resynthesizer();
		this.enabled = false;

		// In case the user click's out of the boxes.
		editor.onDidFocusEditorText(() => {
			this.stopSynthesis();
		});

		// The output selection process blocks everything!
		window.onkeydown = (e: KeyboardEvent) => {
			if (!this.enabled) {
				// The rest of this only applies when waiting on synth result.
				return true;
			}

			let rs = false;

			switch (e.key) {
				case 'Escape':
					this.stopSynthesis();
					break;
				default:
					rs = true;
			}

			return rs;
		};
	}

	public enable() {
		this.enabled = true;
	}

	public disable() {
		this.enabled = false;
	}

	public isEnabled() : boolean {
		return this.enabled;
	}

	onBoxContentChanged = (rows: TableElement[][], init: boolean = false) => {
		this._synthView!.updateBoxContent(rows, init);
	}

	onCursorPosChanged = (range: Range, node: HTMLElement) => {
		this._synthModel!.updateCursorPos(range, node);
	}

	onCellElementsChanged = (cells: Map<string, HTMLTableCellElement[]>) => {
		this._synthModel!.updateCellElements(cells);
	}

	handleRequestNextCell = (backwards: boolean, skipLine: boolean, varname: string) => {
		return this._synthModel!.findNextCell(backwards, skipLine, varname);
	}

	handleRequestCurrNode = () => {
		return this._synthModel!.getCurrNode();
	}

	handleResetHighlight = (idx: number, editable?: boolean) => {
		const highlight = this._synthModel!.removeInvalidTimes(idx, editable);
		if (highlight !== undefined) {
			if (highlight) {
				this._synthView!.highlightRow(idx);
			} else {
				this._synthView!.removeHighlight(idx);
			}
		}
	}

	handleRequestSynth = async (
									idx: number,
									varname: string,
									cell: HTMLElement,
									force?: boolean,
									updateSynthBox?: boolean,
									includeRow?: boolean
								) => {
		let success = false;
		if (!includeRow) {
			if (!this._synthModel!.cellContentChanged(idx, varname, cell.innerText)) {
				console.error('cell content not changed');
				return false;
			}
		}
		const validInput = await this.toggleElement(idx, varname, cell, force, updateSynthBox);
		if (validInput) {
			success = await this.synthesizeFragment();
		}

		return success;
	}

	handleExitSynth = (accept: boolean = false) => {
		if (accept && (this.editorState!.state === EditorState.HasProgram) || !accept) {
			this.stopSynthesis();
		} else {
			this._synthView!.addError("No program available to accept. Please use ESC to exit synthesis.");
		}
	}

	handleValidateInput = async (input: string) => {
		let error = await this.utils.validate(input);
		return error;
	}

	handleUpdateBoxContent = async (updateSynthBox: boolean, includedTimes: Set<number>) => {
		let error = await this.updateBoxContent(updateSynthBox, includedTimes);
		return error;
	}

	handleToggleIfChanged = async (idx: number, varname: string, cell: HTMLElement, updateBoxContent?: boolean) => {
		let success = await this.toggleIfChanged(idx, varname, cell, updateBoxContent);
		return success;
	}

	handleToggleElement = async (idx: number, varname: string, cell: HTMLElement, force?: boolean, updateSynthBox?: boolean) => {
		let validInput = await this.toggleElement(idx, varname, cell, force, updateSynthBox);
		return validInput;
	}

	private  moveLinenoBy(linesDelta: number) {
		this.editorState!.moveLinenoBy(linesDelta);
		this._synthModel!.moveLineoBy(linesDelta);
	}
	// -----------------------------------------------------------------------------------
	// Interface
	// -----------------------------------------------------------------------------------
	public async getSpecificationAsJson(socpeIdx: number){
		var s = await this.commentsManager.getScopeSpecification(socpeIdx);
		var s2 = await this.commentsManager.getExamples();

		return `{"scopeTree": ${s}, "scopes": ${s2}}`;

	}
	public async startSynthesis(lineno: number) {
		this.enabled = true;

		// First of all, we need to disable Projection Boxes since we are going to be
		// modifying both the editor content, and the current projection box, and don't
		// want the boxes to auto-update at any point.
		const line = this.RTVController.getLineContent(lineno).trim();
		let l_operand: string = '';
		let r_operand: string = '';

		let listOfElems = line.split('=');

		if (listOfElems.length !== 2) {
			// TODO Can we inform the user of this?
			console.error(
				'Invalid input format. Must be of the form <varname> = ??'
			);
		} else {
			l_operand = listOfElems[0].trim();
			r_operand = listOfElems[1].trim();
		}

		const varnames = this.extractVarnames(lineno);

		if (l_operand === '' || r_operand === '' || !r_operand.endsWith('??') || !varnames) {
			this.stopSynthesis();
			return;
		}

		if (!this.process.connected()) {
			this.process = this.utils.synthesizer();
		}

		// ------------------------------------------
		// Really Starts Synthesis
		// ------------------------------------------
		this.RTVController.changeViewMode(ViewMode.Stealth);

		this.lineno = lineno;
		this.editorState = new EditorStateManager(l_operand, this.lineno, this.editor, this.RTVController);

		this.logger.synthStart(varnames, this.lineno);

		r_operand = r_operand.substr(0, r_operand.length - 2).trim();

		let model = this.RTVController.getModelForce();
		let startCol = model.getLineFirstNonWhitespaceColumn(lineno);
		let endCol = model.getLineMaxColumn(lineno);

		let range = new RangeClass(lineno, startCol, lineno, endCol);

		let defaultValue = await this.defaultValue(r_operand, varnames);
		let txt: string;


		// TODO: should probably disable the following
		if (l_operand === 'rv') {
			txt = `return ${defaultValue}`;
		} else {
			txt = `${l_operand} = ${defaultValue}`;
		}

		this.editor.executeEdits(this.RTVController.getId(), [
			{ range: range, text: txt },
		]);

		// Update the projection box with the new value
		const runResults: any = await this.RTVController.updateBoxes();

		let error: any = runResults? runResults[0] !== 0 : undefined;
		if (error) {
			// TODO: inform user that updateBoxes failed with the default value
			this.stopSynthesis();
			console.error('default value failed');
			return;
		}

		// Keep the view mode up to date.
		this.RTVController.disable();

		let oldBox : RTVDisplayBox = this.RTVController.getBox(lineno) as RTVDisplayBox;
		this._synthModel = new RTVSynthModel(varnames, lineno, oldBox.allVars());
		this._synthModel.bindBoxContentChanged(this.onBoxContentChanged);

		this._synthView = new RTVSynthView(
							this.editor,
							oldBox.getLine().getElement(),
							oldBox.getElement(),
							oldBox.getModeService(),
							oldBox.getOpenerService(),
							this.lineno!,
							varnames!,
							this._themeService);
		this._synthView.bindSynth(this.handleRequestSynth);
		this._synthView.bindExitSynth(this.handleExitSynth);
		this._synthView.bindValidateInput(this.handleValidateInput);
		this._synthView.bindUpdateBoxContent(this.handleUpdateBoxContent);
		this._synthView.bindToggleIfChanged(this.handleToggleIfChanged);
		this._synthView.bindToggleElement(this.handleToggleElement);
		this._synthView.bindUpdateCursorPos(this.onCursorPosChanged);
		this._synthView.bindCellElementsChanged(this.onCellElementsChanged);
		this._synthView.bindRequestNextCell(this.handleRequestNextCell);
		this._synthView.bindRequestCurrNode(this.handleRequestCurrNode);
		this._synthView.bindResetHighlight(this.handleResetHighlight);

		// TODO Cleanup all available envs
		this._synthModel!.updateAllEnvs(runResults, undefined); // allEnvs updated by synthService

		// Now that we have all the info, update the box again!
		error = await this.updateBoxContent(true, undefined, true); // service updates the envs, display updates cell contents

		if (error) {
			// We shouldn't start synthesis if the underlying code
			// doesn't even excute.
			this._synthView.addError(error);
			this.stopSynthesis();
			return;
		}

		let selectCell = this._synthView.selectFirstEditableCell();

		if (!selectCell) {
			this.stopSynthesis();
			return;
		}

		// Last chance to make sure the synthesizer is working
		if (!this.process.connected()) {
			// Show the error message
			this._synthView.addError('Cannot start the synthesizer. Please contact the admin.', undefined, 0, 2500);
			this.stopSynthesis();
			return;
		}
	}

	public stopSynthesis() {
		if (this.enabled) {
			this.logger.synthEnd();
			this.enabled = false;
			this.process.stop();

			this.lineno = undefined;
			this._synthModel = undefined;
			this._synthView?.destroy();
			this._synthView = undefined;
			this.editorState = undefined;

			// Then reset the Projection Boxes
			this.RTVController.enable();
			this.RTVController.resetChangedLinesWhenOutOfDate();
			this.RTVController.updateBoxes();
			this.RTVController.changeViewMode(ViewMode.Full);
			this.editor.focus();
		}
	}

	public async startResynthesis(lineno: number) {
		this.enabled = true;
		//get the values from the comment
		const model = this.editor.getModel()!;
		const scopeIdx = CommentsManager.getScopeIdx(lineno, model.getLinesContent())
		let scopSpec = await this.commentsManager.getScopeSpecification(scopeIdx);
		// console.log(scopSpec);
		// let sceps =  this.commentsManager.getExamples();
		// console.log(sceps);

		var parsedComment:ParsedComment = await this.commentsManager.getParsedComment(lineno - 1);



		const blockEnd = this.commentsManager.getBlockSize(lineno) + lineno;

		this.editorState = new EditorStateManager(parsedComment.outputVarNames.join(", "), lineno, this.editor, this.RTVController);
		this.editorState.resynthesizing(lineno, blockEnd); // replace the old text with the varNames
		this._synthModel = new RTVSynthModel(parsedComment.outputVarNames, lineno, new Set(parsedComment.inVarNames));
		this._synthModel.boxEnvs = parsedComment.getEnvsToResynth();
		this._synthModel.prevEnvs = parsedComment.getPreEnvsToResynth()!;
		this._synthModel.includedTimes = new Set(this._synthModel.prevEnvs.keys());
		this._synthModel.bindBoxContentChanged(()=>{});

		try {
			console.log(scopSpec.ToJSON())
			const rs: SynthResult | undefined = await this.resynthProcess.reSynthesize(scopSpec)

			if (!rs) {
				// The request was cancelled!
				return;
			}

			this.logger.synthResult(rs);

			if (rs.success) {
				//let box : RTVDisplayBox = this.RTVController.getBox(this.lineno!) as RTVDisplayBox;
				let linesDelta= this.commentsManager.insertExamples(this._synthModel!);
				this.moveLinenoBy(linesDelta);
				this.editorState!.program(rs.program!);
				await this.updateBoxContent(true);

				return;
			} else {
				this.editorState!.failed();
				if (rs.program) {
					this._synthView!.addError(rs.program, undefined, 500);
				}
			}
		} catch (err) {
			// If the synth promise is rejected
			console.error('Synth problem rejected.');
			if (err) {
				console.error(err);
				this.editorState!.failed();
			}
		}

	}
	// -----------------------------------------------------------------------------------
	// UI requests handlers
	// -----------------------------------------------------------------------------------

	public async synthesizeFragment(): Promise<boolean> {
		// Build and write the synth_example.json file content
		let envs = [];
		let optEnvs = [];

		let boxEnvs = this._synthModel!.boxEnvs;
		let includedTimes = this._synthModel!.includedTimes;
		let prevEnvs = this._synthModel!.prevEnvs;
		let varnames = this._synthModel!.varnames;

		for (const env of boxEnvs) {
			const time = env['time'] as unknown as number;

			if (includedTimes.has(time)) {
				envs.push(env);
			} else {
				optEnvs.push(env);
			}
		}

		let previousEnvs: { [t: string]: any } = {};
		for (const [time, env] of prevEnvs!) {
			previousEnvs[time.toString()] = env;
		}

		let problem = new SynthProblem(varnames!, previousEnvs, envs, optEnvs);
		this.logger.synthSubmit(problem);
		this.editorState!.synthesizing();

		try {
			const rs: SynthResult | undefined = await this.process.synthesize(problem);

			if (!rs) {
				// The request was cancelled!
				return false;
			}

			this.logger.synthResult(rs);

			if (rs.success) {
				//let box : RTVDisplayBox = this.RTVController.getBox(this.lineno!) as RTVDisplayBox;
				let linesDelta= this.commentsManager.insertExamples(this._synthModel!);
				this.moveLinenoBy(linesDelta);
				this.editorState!.program(rs.program!);
				await this.updateBoxContent(true);

				return true;
			} else {
				this.editorState!.failed();
				if (rs.program) {
					this._synthView!.addError(rs.program, undefined, 500);
				}
			}
		} catch (err) {
			// If the synth promise is rejected
			console.error('Synth problem rejected.');
			if (err) {
				console.error(err);
				this.editorState!.failed();
			}
		}

		return false;
	}

	// moved from View
	private async toggleIfChanged(
		idx: number,
		varname: string,
		cell: HTMLElement,
		updateBoxContent: boolean = true
	): Promise<boolean> {
		// Keep track of changes
		let success = false;
		// if (this._synthModel) {
			// handle (the weird) situation where the onblur event is fired before stopSynth
			if (cell) {
				let valueChanged = this._synthModel?.cellContentChanged(idx, varname, cell.textContent!);
				success = valueChanged ? await this.toggleElement(idx, varname, cell, true, updateBoxContent) : true;
			} else {
				console.error('toggleIfChanged called, but parent can\' be found: ');
				console.error(cell);
			}
		// }
		return success;
	}

	// computes whether to toggle a cell on
	private async toggleElement(
		idx: number,
		varname: string,
		cell: HTMLElement,
		force?: boolean,
		updateSynthBox: boolean = true
	): Promise<boolean> {
		let on = this._synthModel!.toggleOn(idx, force);

		if (on) {
			let error = await this.utils.validate(cell.textContent!);
			if (error) {
				this._synthView!.addError(error, cell, 500);
				return false;
			}

			this._synthModel!.updateBoxState(idx, varname, cell.innerText.trim());
			this._synthModel!.updateIncludedTimes(idx, true);

			// if error, then controller / service won't know the most recent `_includedTimes`;
			// however, the newest info will be delivered again when another request is made
			error = await this.updateBoxContent(updateSynthBox);
			if (error) {
				this._synthView!.addError(error, cell);
				return false;
			}
			this._synthView!.highlightRow(idx);
		} else {
			this._synthModel!.updateIncludedTimes(idx, false);
			let error = await this.updateBoxContent(updateSynthBox);
			if (error) {
				this._synthModel!.updateIncludedTimes(idx, true);
				return false;
			}

			this._synthView!.removeHighlight(idx);
		}
		return true;
	}

	// -----------------------------------------------------------------------------------
	// Utility functions
	// -----------------------------------------------------------------------------------


	private async defaultValue(currentVal: string, varnames: string[]): Promise<string> {
		// If the user specified a default value, use that.
		if (currentVal !== '') {
			return currentVal;
		}

		// Otherwise, find the best default for each variable
		let defaults: string[] = [];

		// We need to check the latest envs, so let's make sure it's up to date.
		await this.RTVController.pythonProcess;

		// See if the variable was defined before this statement.
		// If yes, we can set the default value to itself!
		// HACK
		let earliestTime = 100000;

		let boxEnvs = this.RTVController.getBox(this.lineno!)!.getEnvs();
		if (boxEnvs.length === 0) {
			boxEnvs = this.RTVController.getBox(this.lineno! - 1)?.getEnvs();
			if (boxEnvs) {
				if (boxEnvs) {
					for (let env of boxEnvs!) {
						if (env['time'] < earliestTime) {
							earliestTime = env['time'];
						}
					}
				}
			}
		} else {
			if (boxEnvs) {
				for (let env of boxEnvs!) {
					if (env['time'] < earliestTime) {
						earliestTime = env['time'];
					}
				}
			}
			earliestTime--;
		}

		for (const varname of varnames) {
			let val = '0';

			for (let line in this.RTVController.envs) {
				for (let env of this.RTVController.envs[line]) {
					if (env['time'] === earliestTime) {
						if (env.hasOwnProperty(varname)) {
							val = varname;
						}
						break;
					}
				}
			}

			// If not, we don't have any information, so let's go with 0.
			defaults.push(val);
		}

		return defaults.join(', ');
	}

	private extractVarnames(lineno: number): string[] {
		let line = this.RTVController.getLineContent(lineno).trim();
		let rs = undefined;

		if (line.startsWith('return ')) {
			rs = ['rv'];
		} else {
			let content = line.split('=');
			rs = content[0].trim().split(',').map((varname) => varname.trim());
		}

		return rs;
	}

	private async runProgram(): Promise<[string, string, any?]> {
		let values = this._synthModel!.getValues();

		const runResults: RunResult = await this.utils.runProgram(
			this.RTVController.getProgram(),
			undefined,
			values);

		const outputMsg = runResults.stdout;
		const errorMsg = runResults.stderr;
		const exitCode = runResults.exitCode;
		const result = runResults.result;

		if (exitCode === null || !result) {
			return [outputMsg, errorMsg, undefined];
		}

		return [outputMsg, errorMsg, JSON.parse(result)];
	}


	/**
	 * Tries to update the box values with the given values. It can fail
	 * if the code causes an exception/error somewhere.
	 *
	 * @return the error string, or `undefined` if no error occurs.
	 **/
	private async updateBoxContent(
		updateSynthBox: boolean = true,
		includedTimes?: Set<number>,
		init: boolean = false
	): Promise<string | undefined> {
		const runResult = await this.runProgram();
		const errorMsg = runResult[1];
		const content = runResult[2];

		if (errorMsg) {
			// Extract the error message
			const errorLines = errorMsg.split(/\n/).filter((s) => s);
			const message = errorLines[errorLines.length - 1];
			return message;
		}

		if (!content) {
			return 'Error: Failed to run program.';
		}

		// First, update our envs
		this._synthModel!.updateAllEnvs(content, includedTimes);

		// only create new boxes when `updateBoxContent` is true
		if (updateSynthBox) {
			const envs: {[k: string] : [v: {[k1: string]: any}]} = content[2];
			this._synthModel!.updateBoxContent(envs, init);
		}

		return undefined;
	}


}
