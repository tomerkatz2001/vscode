import { IEditorContribution } from '../../common/editorCommon.js';
import { IModelDecorationOptions, ITextModel } from '../../common/model.js';
import { RTVSpecification } from './RTVSpecification.js';

import { ILanguageService } from '../../common/languages/language.js';
import { IModelContentChangedEvent } from '../../common/textModelEvents.js';
import { IRange } from "../../common/core/range.js";

import { IOpenerService } from '../../../platform/opener/common/opener.js';
import { Position } from '../../common/core/position.js';
import { Event } from 'vs/base/common/event.js';



export interface IRTVDisplayBox {
	/**
	 * Returns the box's HTML element.
	 * */
	getElement(): HTMLElement;

	getCellContent(): { [k: string]: [HTMLElement] };

	/**
	 * Returns the environments displayed in this PB.
	 * The values are not identical to the result of
	 * `runProgram()`, since the box does some post
	 * processing before displaying its `envs`.
	 */
	getEnvs(): any[];

	/**
	 * Return the ID of the HTML <TD> element at the
	 * given row and column.
	 */
	getCellId(varname: string, idx: number): string;

	/**
	 * Return the HTML <TD> element at the given row and column.
	 */
	getCell(varname: string, idx: number): HTMLTableCellElement | null;
	/**
	 * Return the box's related lineno.
	*/
	getLineno(): number;
	/**
	 * Updates the box's values, destroys the existing
	 * HTML table and recreates it from the new data.
	 *
	 * @param allEnvs Optional. If provided, these values
	 * will be used to update the box. If not, it reads the
	 * `envs` from its `RTVController`.
	 * @param updateInPlace Optional. If `true`, the table
	 * values will be updated in-place, without destroying
	 * the table and rebuilding it from scratch.
	 */
	updateContent(allEnvs?: any[], updateInPlace?: boolean, outputVars?: string[], prevEnvs?: Map<number, any>): void;

	/**
	 * Returns if the box is a SynthBox
	 */
	isSynthBox(): boolean;
}

export class BoxUpdateEvent {
	constructor(
		public isStart: boolean,
		public isCancel: boolean,
		public isFinish: boolean,
	) { }
}

export interface IRTVController extends IEditorContribution {
	// Utility functions for accessing the editor or PB content
	getBox(lineno: number): IRTVDisplayBox;
	getCursorPos(): Position | null;
	getLineContent(lineno: number): string;
	getProgram(): string;
	getModelForce(): ITextModel;
	envs: { [k: string]: any[]; };
	pythonProcess?: RunProcess;

	onUpdateEvent: Event<BoxUpdateEvent>;
	addDecoration(range: IRange, options: IModelDecorationOptions): string;
	removeDecoration(id: string): void;

	// Functions for running the program
	updateBoxes(e?: IModelContentChangedEvent, outputVars?: string[], prevEnvs?: Map<number, any>): Promise<any>;
	updateBoxesNoRefresh(
		e?: IModelContentChangedEvent,
		runResults?: [string, string, any?],
		outputVars?: string[],
		prevEnvs?: Map<number, any>): Promise<any>;
	runProgram(): Promise<any>;
	getId(): string;
	getLanguageService(): ILanguageService;
	getOpenerService(): IOpenerService;
	byRowOrCol: RowColMode;

	// Disabling the controller
	enable(): void;
	disable(): void;
	isEnabled(): boolean;

	// Misc.
	viewMode: ViewMode;
	changeViewMode(m: ViewMode): void;
	resetChangedLinesWhenOutOfDate(): void;


}

/**
 * This class is used to return the result of running
 * a run.py or img-summary.py file.
 **/
export class RunResult {
	constructor(
		public readonly stdout: string,
		public readonly stderr: string,
		public readonly exitCode: number | null,
		public readonly result: string | undefined,
		public readonly testResults: string | undefined,
		public readonly conflictsResults: string | undefined
	) { }
}

export class SynthResult {
	constructor(
		public id: number,
		public success: boolean,
		public program?: string
	) { }
}

export class SynthProblem {
	public id: number = -1;
	constructor(
		public varNames: string[],
		public previousEnvs: { [t: string]: any },
		public envs: any[],
		public optEnvs: any[] = []
	) { }
}





/**
 * A "Process" interface that lets us share the API
 * between the local and remote versions of RTVDisplay.
 */
export interface RunProcess extends PromiseLike<RunResult> {
	kill(): boolean;
}

export interface ReSynthProcess {
	reSynthesize(problem: RTVSpecification): Promise<SynthResult | undefined>;
	stop(): boolean;
	connected(): boolean;
}
export interface SynthProcess {
	synthesize(problem: SynthProblem): Promise<SynthResult | undefined>;
	stop(): boolean;
	connected(): boolean;
}


/**
 * An empty implementation of Process. Can be used in place of the
 * actual process until initial setups are completed. Resolves
 * immediately.
 */
// export class EmptyProcess implements Process {
// 	onExit(_fn: (exitCode: any, result?: string) => void): void {}
// 	onStdout(_fn: (data: any) => void): void {}
// 	onStderr(_fn: (data: any) => void): void {}
// 	toStdin(msg: string): void {}
// 	kill(): void {}
// 	toPromise(): Promise<any> {
// 		return new Promise((resolve) => {
// 			resolve('[]');
// 		});
// 	}
// }

/**
 * The Projection Box view modes.
 */
export enum ViewMode {
	Full = 'Full',
	CursorAndReturn = 'Cursor and Return',
	Cursor = 'Cursor',
	Compact = 'Compact',
	Stealth = 'Stealth',
	Focused = 'Focused',
	Custom = 'Custom'
}

/**
 * Whether 'time' in the projection boxes is
 * displayed as a row or as a column.
 */
export enum RowColMode {
	ByRow = 'By Row',
	ByCol = 'By Col'
}

export class DelayedRunAtMostOne {
	private _reject?: () => void;

	public async run(delay: number, c: () => Promise<void>) {
		if (this._reject) {
			this._reject();
		}

		if (delay === 0) {
			this._reject = undefined;
		} else {
			await new Promise((resolve, reject) => {
				let timeout = setTimeout(resolve, delay);
				this._reject = () => {
					clearTimeout(timeout);
					reject();
				};
			});
		}

		await c();
	}

	public cancel() {
		if (this._reject) {
			this._reject();
			this._reject = undefined;
		}
	}
}
