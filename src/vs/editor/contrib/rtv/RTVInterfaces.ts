import { IEditorContribution } from 'vs/editor/common/editorCommon';

export interface IRTVController extends IEditorContribution {
	runProgram(): void;
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
	toPromise(success: (exitCode: any, result?: string) => void): Promise<any>;
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
