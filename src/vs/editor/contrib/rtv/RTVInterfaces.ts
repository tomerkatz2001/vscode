import { IEditorContribution } from 'vs/editor/common/editorCommon';
import { ITextModel } from 'vs/editor/common/model';

export interface IRTVDisplayBox {
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
	getCellId(row: number, col: number): string;

	/**
	 * Return the HTML <TD> element at the given row and column.
	 */
	getCell(row: number, col: number): HTMLTableCellElement | null;

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
	updateContent(allEnvs?: any[], updateInPlace?: boolean): void;
}

export interface IRTVController extends IEditorContribution {
	// Utility functions for accessing the editor or PB content
	getBox(lineno: number): IRTVDisplayBox;
	getLineContent(lineno: number): string;
	getProgram(): string;
	getModelForce(): ITextModel;

	// Functions for running the program
	runProgram(): Promise<any>;
	getId(): string;
	byRowOrCol: RowColMode;
}

/**
 * The Logging interface for RTVDisplay.
 */
export interface IRTVLogger {
	// General Projection Boxes
	projectionBoxCreated(): void;
	projectionBoxDestroyed(): void;
	projectionBoxUpdateStart(program: string): void;
	projectionBoxUpdateEnd(result: string | undefined): void;
	projectionBoxModeChanged(mode: string): void;

	// Image Processing
	imgSummaryStart(lineno: number, variable: string): void;
	imgSummaryEnd(result?: string): void;

	// Output Box
	showOutputBox(): void;
	hideOutputBox(): void;

	// SnipPy
	projectionBoxFocus(line: string, custom?: boolean): void;
	projectionBoxExit(): void;
	synthStart(problem: any, examples: number, lineno: number): void;
	synthOut(msg: string): void;
	synthErr(msg: string): void;
	synthEnd(exitCode: number, result?: string): void;
	exampleBlur(idx: number, content: string): void;
	exampleFocus(idx: number, content: string): void;
	exampleChanged(idx: number, was: string, is: string): void;
	exampleInclude(idx: number, content: string): void;
	exampleExclude(idx: number, content: string): void;
	exampleReset(): void;
}

/**
 * A "Process" interface that lets us share the API
 * between the local and remote versions of RTVDisplay.
 */
export interface Process {
	onExit(fn: (exitCode: any, result?: string) => void): void;
	onStdout(fn: (data: any) => void): void;
	onStderr(fn: (data: any) => void): void;
	kill(): void;
	toPromise(): Promise<any>;
}


/**
 * An empty implementation of Process. Can be used in place of the
 * actual process until initial setups are completed. Resolves
 * immediately.
 */
export class EmptyProcess implements Process {
	onExit(_fn: (exitCode: any, result?: string) => void): void {}
	onStdout(_fn: (data: any) => void): void {}
	onStderr(_fn: (data: any) => void): void {}
	kill(): void {}
	toPromise(): Promise<any> {
		return new Promise((resolve) => {
			resolve();
		});
	}
}


/**
 * The Projection Box view modes.
 */
export enum ViewMode {
	Full = 'Full',
	CursorAndReturn = 'Cursor and Return',
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
