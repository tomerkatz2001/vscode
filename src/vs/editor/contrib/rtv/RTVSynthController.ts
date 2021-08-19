import { Range } from 'vs/editor/common/core/range';
import { Selection } from 'vs/editor/common/core/selection';
import { ICodeEditor } from 'vs/editor/browser/editorBrowser';
import { getUtils } from 'vs/editor/contrib/rtv/RTVUtils';
import { Utils, RunResult, SynthResult, SynthProblem, IRTVLogger, IRTVController, ViewMode, SynthProcess, DelayedRunAtMostOne } from './RTVInterfaces';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { RTVDisplayBox } from 'vs/editor/contrib/rtv/RTVDisplay';
import { RTVSynthDisplayBox } from 'vs/editor/contrib/rtv/RTVSynthDisplay';
import { RTVSynthService } from 'vs/editor/contrib/rtv/RTVSynthService';

// const SYNTHESIZING_MESSAGE: string = '# Please wait. Synthesizing...';
// const SPEC_AWAIT_INDICATOR: string = '??';

enum EditorState {
	Synthesizing,
	Failed,
	HasProgram,
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

	synthesizing() {
		if (this._state === EditorState.Synthesizing) {return;}
		this._state = EditorState.Synthesizing;
		this.insertFragment(this.SYNTHESIZING_INDICATOR);
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
		let range = new Range(this.lineno, startCol, this.lineno, endCol);

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
	private _synthService?: RTVSynthService = undefined;
	private _synthBox?: RTVSynthDisplayBox = undefined;
	private logger: IRTVLogger;
	enabled: boolean;
	includedTimes: Set<number> = new Set();
	// allEnvs?: any[] = undefined;
	prevEnvs?: Map<number, any>;
	boxEnvs?: any[] = undefined;
	varnames?: string[] = undefined;
	row?: number = undefined;
	lineno?: number = undefined;
	utils: Utils;
	process: SynthProcess;
	rowsValid?: boolean[];
	synthTimer: DelayedRunAtMostOne = new DelayedRunAtMostOne();
	editorState?: EditorStateManager = undefined;
	// errorBox: ErrorHoverManager;

	constructor(
		private readonly editor: ICodeEditor,
		private readonly RTVController: IRTVController,
		@IThemeService readonly _themeService: IThemeService
	) {
		this.utils = getUtils();
		this.logger = this.utils.logger(editor);
		this.process = this.utils.synthesizer();
		this.enabled = false;
		this._synthService = new RTVSynthService();
		// this._synthBox = new RTVSynthDisplayBox(editor);

		// explicit the binding with the service and the view
		// this.synthDisplay.bindKeystroke(this.handleKeystroke);
		// shift + enter only involves the front end behavior\
		// controller runs run.py to get results, service update box content ds on the back end
		this._synthService.bindBoxContentChanged(this.onBoxContentChanged);

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

	public isSynthesizing() {
		return this.editorState!.state === EditorState.Synthesizing;
	}

	onBoxContentChanged = (data: {[k: string]:[v: any]}) => {
		this._synthBox!.updateBoxContent(data);
	}


	// -----------------------------------------------------------------------------------
	// Interface
	// -----------------------------------------------------------------------------------

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

		if (l_operand === '' || r_operand === '' || !r_operand.endsWith('??') || !varnames || varnames.length !== 1) {
			this.stopSynthesis();
			return;
		}

		if (!this.process.connected()) {
			this.process = this.utils.synthesizer();
		}

		// ------------------------------------------
		// Really Start Synthesis
		// ------------------------------------------
		this.RTVController.changeViewMode(ViewMode.Stealth);

		this.lineno = lineno;
		this.varnames = varnames;
		this.row = 0;
		this.editorState = new EditorStateManager(l_operand, this.lineno, this.editor, this.RTVController);

		this.logger.synthStart(this.varnames, this.lineno);

		r_operand = r_operand.substr(0, r_operand.length - 2).trim();

		let model = this.RTVController.getModelForce();
		let startCol = model.getLineFirstNonWhitespaceColumn(lineno);
		let endCol = model.getLineMaxColumn(lineno);

		let range = new Range(lineno, startCol, lineno, endCol);

		let defaultValue = await this.defaultValue(r_operand);
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
		let error = runResults? runResults[1] : undefined;
		if (error) {
			// TODO: show that updateBoxes failed with the default value
			this.stopSynthesis();
			return;
		}

		// Keep the view mode up to date.
		this.RTVController.disable();

		let oldBox : RTVDisplayBox = this.RTVController.getBox(lineno) as RTVDisplayBox;
		this._synthBox = new RTVSynthDisplayBox(
							this.editor,
							oldBox.getLine().getElement(),
							oldBox.getElement(),
							oldBox.getModeService(),
							oldBox.getOpenerService(),
							this.lineno!,
							this.varnames!,
							this._themeService);
		this._synthBox.bindSynth(this.synthesizeFragment);
		this._synthBox.bindExitSynth(this.exitSynthesis);
		this._synthBox.bindValidateInput(this.validateInput);
		this._synthBox.bindUpdateBoxContent(this.updateBoxContent);
		this._synthBox.bindSynthState(this.isSynthesizing);

		// TODO??
		// this.boxEnvs = this.box.getEnvs();

		// TODO Cleanup all available envs
		this._synthService!.updateAllEnvs(runResults); // allEnvs updated by synthService

		// Now that we have all the info, update the box again!
		error = await this.updateBoxContent(true); // service updates the envs, display updates cell contents

		// TODO: let SynthDisplay handle this
		if (error) {
			// We shouldn't start synthesis if the underlying code
			// doesn't even excute.
			this._synthBox.addError(error);
			this.stopSynthesis();
			return;
		}

		let selectCell = this._synthBox.selectFirstEditableCell();

		if (!selectCell) {
			this.stopSynthesis();
			return;
		}

		// TODO: check if the following code work with the replaced SynthBox
		// Last chance to make sure the synthesizer is working
		if (!this.process.connected()) {
			// Show the error message
			this._synthBox.addError('Cannot start the synthesizer. Please contact the admin.', undefined, 0, 2500);
			this.stopSynthesis();
			return;
		}
	}

	public stopSynthesis() {
		if (this.enabled) {
			this.logger.synthEnd();
			this.enabled = false;
			this.process.stop();

			// Clear the state
			this.includedTimes = new Set();

			this.lineno = undefined;
			this.varnames = [];
			this._synthService = undefined;
			this._synthBox?.destroy();
			this._synthBox = undefined;
			// this.boxEnvs = undefined;
			this.editorState = undefined;

			// Then reset the Projection Boxes
			this.RTVController.enable();
			this.RTVController.resetChangedLinesWhenOutOfDate();
			this.RTVController.updateBoxes();
			this.RTVController.changeViewMode(ViewMode.Full);
			this.editor.focus();
		}
	}

	// -----------------------------------------------------------------------------------
	// UI requests handlers
	// -----------------------------------------------------------------------------------

	public exitSynthesis(accept: boolean = false) {
		if (accept && (this.editorState!.state === EditorState.HasProgram) || !accept) {
			this.stopSynthesis();
		} else {
			this._synthBox!.addError("No program available to accept. Please use ESC to exit synthesis.");
		}
	}


	public async validateInput(
		env: any,
		cell: HTMLElement,
		varname: string,
		force?: boolean,
		updateBoxContent: boolean = true
	): Promise<boolean> {

		return false;
	}

	public async synthesizeFragment(cell: HTMLTableCellElement): Promise<boolean> {
		// Build and write the synth_example.json file content
		let envs = [];
		let optEnvs = [];

		let boxEnvs = this._synthService!.boxEnvs;
		let includedTimes = this._synthService!.includedTimes;

		for (const env of boxEnvs) {
			const time = env['time'];

			if (includedTimes.has(time)) {
				envs.push(env);
			} else {
				optEnvs.push(env);
			}
		}

		let previousEnvs: { [t: string]: any } = {};
		for (const [time, env] of this.prevEnvs!) {
			previousEnvs[time.toString()] = env;
		}

		let problem = new SynthProblem(this.varnames!, previousEnvs, envs, optEnvs);
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
				this.editorState!.program(rs.result!);
				await this.updateBoxContent(true);

				return true;
			} else {
				this.editorState!.failed();
				if (rs.result) {
					// We have an error message!
					if (cell) {
						this._synthBox!.addError(rs.result, cell, 500);
					}
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

	// -----------------------------------------------------------------------------------
	// Utility functions
	// -----------------------------------------------------------------------------------


	private async defaultValue(currentVal: string): Promise<string> {
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

		for (const varname of this.varnames!) {
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
		let values: any = {};
		for (let env of this.boxEnvs!) {
			if (this.includedTimes.has(env['time'])) {
				values[`(${env['lineno']},${env['time']})`] = env;
			}
		}

		const runResults: RunResult = await this.utils.runProgram(
			this.RTVController.getProgram(),
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
		includedTimes?: Set<number>
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
		this._synthService!.updateAllEnvs(content, includedTimes);


		//
		// only create new boxes when `updateBoxContent` is true
		if (updateSynthBox) {
			// the call below = updateBoxEnvs + updateRowsValid
			// further calls `updateBoxContent` on `synthDisplay`
			this._synthService!.updateBoxContent(content[2], this.varnames, this.prevEnvs);
		}

		return undefined;
	}


}
