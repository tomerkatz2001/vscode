import { Process, IRTVController, IRTVLogger, EmptyProcess, ViewMode } from 'vs/editor/contrib/rtv/RTVInterfaces';
import { RTVLogger } from 'vs/editor/contrib/rtv/RTVLogger';
import { ICodeEditor } from 'vs/editor/browser/editorBrowser';

declare const window: {
	editor: ICodeEditor
};

class IDGenerator {
	private next: number;

	constructor() {
		this.next = 0;
	}

	getId(): number {
		return this.next++;
	}
}

const idGen: IDGenerator = new IDGenerator();

enum ResponseType {
	// Responses related to the running program
	STDOUT = 1,
	STDERR = 2,
	RESULT = 3,
	EXCEPTION = 4,

	// Responses related to the web worker itself
	ERROR = 5,
	LOADED = 6
}

enum RequestType {
	RUNPY = 1,
	IMGSUM = 2
}

class PyodideWorkerResponse {
	constructor(
		public id: number,
		public type: ResponseType,
		public msg: string) {}
}

class RunpyWorkerRequest {
	public type: RequestType;
	constructor(
		public id: number,
		public name: string,
		public content: string) {
			this.type = RequestType.RUNPY;
		}
}

class ImgSumWorkerRequest {
	public type: RequestType = RequestType.IMGSUM;

	constructor(
		public id: number,
		public name: string,
		public content: string,
		public line: number,
		public varname: string
	) {
		this.type = RequestType.IMGSUM;
	}
}

class RunpyProcess implements Process {
	private id: number;

	private onResult?: ((exitCode: any, result?: string) => void) = undefined;
	private onOutput?: ((data: any) => void) = undefined;
	private onError?: ((data: any) => void) = undefined;

	private result?: string = undefined;
	private error: string = '';
	private output: string = '';

	private killed: boolean = false;

	private eventListener: (this: Worker, event: MessageEvent) => void;

	constructor(program: string) {
		this.id = idGen.getId();

		this.eventListener = (event: MessageEvent) =>
		{
			let msg: PyodideWorkerResponse = event.data;

			if (msg.id !== this.id) {
				return;
			}

			switch (msg.type)
			{
				case ResponseType.RESULT:
					this.result = msg.msg;
					if (this.onResult) {
						this.onResult(this.result);
					}
					break;
				case ResponseType.STDOUT:
					this.output += msg.msg;
					break;
				case ResponseType.STDERR:
				case ResponseType.EXCEPTION:
					this.error += msg.msg;
					break;
				default:
					break;
			}
		};

		pyodideWorker.addEventListener('message', this.eventListener);
		pyodideWorker.postMessage(new RunpyWorkerRequest(this.id, `program_${this.id}.py`, program));
	}

	onStdout(fn: (data: any) => void): void {
		this.onOutput = fn;
	}

	onStderr(fn: (data: any) => void): void {
		this.onError = fn;
	}

	kill() {
		this.killed = true;
		pyodideWorker.removeEventListener('message', this.eventListener);

		if (this.onResult) {
			this.onResult('');
		}
	}

	onExit(fn: (exitCode: any, result?: string) => void): void {
		this.onResult = (result) => {
			if (this.onOutput) {
				this.onOutput(this.output);
			}

			if (this.onError) {
				this.onError(this.error);
			}

			fn((result && result !== '') ? 0 : null, result);
		};

		if (this.result) {
			this.onResult(this.result);
		} else if (this.killed) {
			this.onResult('');
		}
	}

	toPromise(): Promise<any> {
		// TODO Implement
		return new Promise((_1, _2) => {});
	}
}

class ImgSummaryProcess implements Process {
	private id: number;

	private onResult?: ((exitCode: any, result?: string) => void) = undefined;
	private onOutput?: ((data: any) => void) = undefined;
	private onError?: ((data: any) => void) = undefined;

	private result?: string = undefined;
	private error: string = '';
	private output: string = '';

	private eventListener: (this: Worker, event: MessageEvent) => void;

	constructor(program: string, line: number, varname: string) {
		this.id = idGen.getId();

		this.eventListener = (event: MessageEvent) =>
		{
			let msg: PyodideWorkerResponse = event.data;

			if (msg.id !== this.id) {
				return;
			}

			switch (msg.type)
			{
				case ResponseType.RESULT:
					this.result = msg.msg;
					if (this.onResult) {
						this.onResult(this.result);
					}
					break;
				case ResponseType.STDOUT:
					this.output += msg.msg;
					if (this.onOutput) {
						this.onOutput(msg.msg);
					}
					break;
				case ResponseType.STDERR:
				case ResponseType.EXCEPTION:
					this.error += msg.msg;
					if (this.onError) {
						this.onError(msg.msg);
					}
					break;
				default:
					break;
			}
		};

		pyodideWorker.addEventListener('message', this.eventListener);
		pyodideWorker.postMessage(new ImgSumWorkerRequest(this.id, `imgsum_${this.id}.py`, program, line, varname));
	}

	onStdout(fn: (data: any) => void): void {
		this.onOutput = fn;

		if (this.output) {
			this.onOutput(this.output);
		}
	}

	onStderr(fn: (data: any) => void): void {
		this.onError = fn;

		if (this.error) {
			this.onError(this.error);
		}
	}

	kill() {
		pyodideWorker.removeEventListener('message', this.eventListener);
	}

	onExit(fn: (exitCode: any, result?: string) => void): void {
		this.onResult = (result) => {
			fn((result && result !== '') ? 0 : 1, result);
		};

		if (this.result) {
			this.onResult(this.result);
		}
	}

	toPromise(): Promise<any> {
		// TODO Implement
		return new Promise((_1, _2) => {});
	}
}

class SynthProcess implements Process {

	private onResult?: ((exitCode: any, result?: string) => void) = undefined;
	// private onOutput?: ((data: any) => void) = undefined;
	private onError?: ((data: any) => void) = undefined;

	private result?: string = undefined;
	private error: string = '';
	// private output: string = '';

	constructor(problem: string) {
		fetch(
			'/synthesize',
			{
				method: 'POST',
				body: problem,
				mode: 'same-origin'
			}).
			then(response => {
				if (response && response.status < 200 || response.status >= 300 || response.redirected) {
					// TODO Error handling
					this.error = response.statusText;

					if (this.onError) {
						this.onError(this.error);
					}

					return Promise.reject();
				} else {
					return response.text();
				}
			}).
			then(result => {
				this.result = result;

				if (this.onResult) {
					this.onResult(0, this.result);
				}
			}).
			catch(error => {
				// TODO Error handling
				this.error = error;

				if (this.onError) {
					this.onError(this.error);
				}

				if (this.onResult) {
					this.onResult(1, this.error);
				}
			});
	}

	onStdout(fn: (data: any) => void): void {
		// TODO
	}

	onStderr(fn: (data: any) => void): void {
		this.onStderr = fn;

		if (this.error) {
			fn(this.error);
		}
	}

	kill() {
		// TODO
	}

	onExit(fn: (exitCode: any, result?: string) => void): void {
		this.onResult = fn;

		if (this.result) {
			this.onResult(0, this.result);
		}
	}

	toPromise(): Promise<any> {
		// TODO Implement
		return new Promise((_1, _2) => {});
	}
}

export function runProgram(program: string): Process {
	if (!pyodideLoaded) {
		// @Hack: We want to ignore this call until pyodide has loaded.
		return new EmptyProcess();
	}

	return new RunpyProcess(program);
}

export function synthesizeSnippet(problem: string): Process {
	return new SynthProcess(problem);
}

export function runImgSummary(program: string, line: number, varname: string) {
	if (!pyodideLoaded) {
		// @Hack: We want to ignore this call until pyodide has loaded.
		return new EmptyProcess();
	}

	return new ImgSummaryProcess(program, line, varname);
}

export function getLogger(editor: ICodeEditor): IRTVLogger {
	return new RTVLogger(editor);
}

// Assuming the server is running on a unix system
export const EOL: string = '\n';

/**
 * Don't allow switching views unless we find the set cookie
 */
export function isViewModeAllowed(m: ViewMode): boolean {
	return true;
}

// Start the web worker
const pyodideWorker = new Worker('pyodide/webworker.js');
let pyodideLoaded = false;

const pyodideWorkerInitListener = (event: MessageEvent) =>
{
	let msg = event.data as PyodideWorkerResponse;

	if (msg.type === ResponseType.LOADED)
	{
		console.log('Pyodide loaded!');
		pyodideLoaded = true;
		pyodideWorker.removeEventListener('message', pyodideWorkerInitListener);

		const program = window.editor.getModel()!!.getLinesContent().join('\n');
		runProgram(program).onExit((_code, _result) =>
		{
			(window.editor.getContribution('editor.contrib.rtv') as IRTVController).runProgram();
			(document.getElementById('spinner') as HTMLInputElement).style.display = 'none';
		});
	}
	else
	{
		console.error('First message from pyodide worker was not a load message!');
		console.error(msg.type);
		console.error(ResponseType.LOADED);
	}
};

pyodideWorker.onerror = console.error;
pyodideWorker.addEventListener('message', pyodideWorkerInitListener);
