import { IEditorContribution } from 'vs/editor/common/editorCommon';

export interface IRTVController extends IEditorContribution {
	runProgram(): void;
}

/**
 * The Logging interface for RTVDisplay.
 */
export interface IRTVLogger {
	dispose(): void;
	synthStart(problem: any, examples: number, lineno: number): void;
	synthOut(msg: string): void;
	synthErr(msg: string): void;
	synthEnd(exitCode: number, result?: string): void;
	projectionBoxFocus(line: string, custom?: boolean): void;
	projectionBoxUpdateStart(program: string): void;
	projectionBoxUpdateEnd(result: string | undefined): void;
	projectionBoxExit(): void;
	exampleBlur(idx: number, content: string): void;
	exampleFocus(idx: number, content: string): void;
	exampleChanged(idx: number, was: string, is: string): void;
	exampleInclude(idx: number, content: string): void;
	exampleExclude(idx: number, content: string): void;
	exampleReset(): void;
	imgSummaryStart(): void;
	imgSummaryEnd(): void;
	modeChanged(mode: string): void;
	showOutputBox(program: string): void;
	hideOutputBox(): void;
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
}
