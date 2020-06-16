import {RTVLogger} from 'vs/editor/contrib/rtv/RTVLogger';
import {ICodeEditor} from 'vs/editor/browser/editorBrowser';

export interface Process {
	onExit(fn: (exitCode: any, result?: string) => void): void;
	onStdout(fn: (data: any) => void): void;
	onStderr(fn: (data: any) => void): void;
	kill(): void;
}

class RunpyProcess implements Process {
	onStdout(fn: (data: any) => void): void {
		// TODO
	}

	onStderr(fn: (data: any) => void): void {
		// TODO
	}

	kill() {
		// TODO
	}

	onExit(fn: (exitCode: any, result?: string) => void): void {
		fn(0, '[{"1": ["y"], "2": ["z"], "3": ["z"]}, {"1": [{"time": 0, "#": "", "$": "", "inp": "2", "lineno": 1, "next_lineno": 2}], "2": [{"time": 1, "#": "", "$": "", "inp": "2", "y": "0", "lineno": 2, "prev_lineno": 1, "next_lineno": 3}], "3": [{"time": 2, "#": "", "$": "", "inp": "2", "y": "0", "z": "22", "lineno": 3, "prev_lineno": 2, "next_lineno": 4}], "4": [{"time": 3, "#": "", "$": "", "inp": "2", "y": "0", "z": "0", "lineno": 4, "prev_lineno": 3, "next_lineno": "R4"}], "R4": [{"time": 4, "#": "", "$": "", "inp": "2", "y": "0", "z": "0", "lineno": "R4", "prev_lineno": 4, "rv": "0"}]}]\n');
	}
}

class SynthProcess implements Process {
	onStdout(fn: (data: any) => void): void {
		// TODO
	}

	onStderr(fn: (data: any) => void): void {
		// TODO
	}

	kill() {
		// TODO
	}

	onExit(fn: (exitCode: any, result?: string) => void): void {
		// TODO
	}
}

export function runProgram(program: string): Process {
	return new RunpyProcess();
}

export function synthesizeSnippet(problem: string): Process {
	return new SynthProcess();
}

export function getLogger(editor: ICodeEditor): RTVLogger {
	return {
		dispose(): void {},
		synthStart(problem: any, examples: number, lineno: number): void {},
		synthOut(msg: string): void {},
		synthErr(msg: string): void {},
		synthEnd(exitCode: number, result?: string): void {},
		projectionBoxFocus(line: string, custom?: boolean): void {},
		projectionBoxExit(): void {},
		exampleBlur(idx: number, content: string): void {},
		exampleFocus(idx: number, content: string): void {},
		exampleChanged(idx: number, was: string, is: string): void {},
		exampleInclude(idx: number, content: string): void {},
		exampleExclude(idx: number, content: string): void {},
		exampleReset(): void {}
	};
}

export const EOL: string = '\n';
