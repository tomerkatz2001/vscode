import { RTVLogger, RemoteLogger } from 'vs/editor/contrib/rtv/RTVLogger';
import { ICodeEditor } from 'vs/editor/browser/editorBrowser';

export interface Process {
	onExit(fn: (exitCode: any, result?: string) => void): void;
	onStdout(fn: (data: any) => void): void;
	onStderr(fn: (data: any) => void): void;
	kill(): void;
}

class RunpyProcess implements Process {
	private errFn: (data: any) => void = (_) => {};
	private exitFn: (data: any) => void = (_) => {};

	constructor(private request: Promise<Response>) { }

	onStdout(fn: (data: any) => void): void {
		// TODO (How) could we use this?
	}

	onStderr(fn: (data: any) => void): void {
		this.errFn = fn;
		this.request.then(this.exitFn, this.errFn);
	}

	kill() {
		this.request.then(() => {}, () => {});
	}

	onExit(fn: (exitCode: any, result?: string) => void): void {
		this.exitFn = fn;
		this.request.then(this.exitFn, this.errFn);
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
	const baseUrl = 'localhost:8080'; // $(location).attr('href');

	const response = fetch(`${baseUrl}/editor/runProgram`, {
		method: 'POST',
		body: program,
		headers: { 'Content-Type': 'text/plain; charset=UTF-8' }
	});

	return new RunpyProcess(response);
}

export function synthesizeSnippet(problem: string): Process {
	return new SynthProcess();
}

export function getLogger(editor: ICodeEditor): RTVLogger {
	return new RemoteLogger();
}

export const EOL: string = '\n';
