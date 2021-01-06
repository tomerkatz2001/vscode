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
	IMGSUM = 2,
	SNIPPY = 3,
}

class PyodideResponse {
	constructor(
		public id: number,
		public type: ResponseType,
		public msg: string) {}
}

abstract class PyodideRequest {
	public id: number = idGen.getId();

	constructor(public type: RequestType) {}
}

class RunpyRequest extends PyodideRequest {
	public name: string;

	constructor(
		public content: string,
		public values?: string
	) {
		super(RequestType.RUNPY);
		this.name = `program_${this.id}.py`;
	}
}

class ImgSumRequest extends PyodideRequest {
	public name: string;
	constructor(
		public content: string,
		public line: number,
		public varname: string
	) {
		super(RequestType.IMGSUM);
		this.name = `imgum_${this.id}.py`;
	}
}

class SnipPyRequest extends PyodideRequest {
	constructor(
		public action: string,
		public parameter: string,
	) {
		super(RequestType.SNIPPY);
	}
}

class PyodideProcess<R extends PyodideRequest> implements Process {
	private id: number;

	// Event listeners
	private onResult?: ((exitCode: any, result?: string) => void) = undefined;
	private onOutput?: ((data: any) => void) = undefined;
	private onError?: ((data: any) => void) = undefined;

	private result?: string = undefined;
	private error: string = '';
	private output: string = '';

	private resolve?: (result: any) =>  void = undefined;

	private killed: boolean = false;

	private eventListener: (this: Worker, event: MessageEvent) => void;

	constructor(request: R) {
		this.id = request.id;
		this.eventListener = (event: MessageEvent) =>
		{
			let msg: PyodideResponse = event.data;

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
					if (this.resolve) {
						this.resolve(this.result);
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
		pyodideWorker.postMessage(request);
	}

	onStdout(fn: (data: any) => void): void {
		this.onOutput = fn;
	}

	onStderr(fn: (data: any) => void): void {
		this.onError = fn;
	}

	kill() {
		pyodideWorker.removeEventListener('message', this.eventListener);

		if (this.onOutput && this.output) {
			this.onOutput(this.output);
		}

		if (this.onError && this.error) {
			this.onError(this.error);
		}

		if (this.onResult) {
			this.onResult(0);
		}

		if (this.resolve) {
			this.resolve('');
		}

		this.killed = true;
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
		return new Promise((resolve, _reject) => {
			this.resolve = (result) => {
				const rs = [(result && result !== '') ? 0 : null, result];

				// TODO Delete me
				console.log('Resolving request with:');
				console.log(rs);

				resolve(rs);
			}

			if (this.result) {
				this.resolve(this.result);
			} else if (this.killed) {
				this.resolve('');
			}
		});
	}
}

class SynthProcess implements Process {

	private onResult?: ((exitCode: any, result?: string) => void) = undefined;
	// private onOutput?: ((data: any) => void) = undefined;
	private onError?: ((data: any) => void) = undefined;

	private result?: string = undefined;
	private error: string = '';
	private promise: Promise<string | undefined>;
	private abortController: AbortController;

	constructor(problem: string) {
		this.abortController = new AbortController();
		const signal = this.abortController.signal;

		this.promise = fetch(
			'/synthesize',
			{
				method: 'POST',
				body: problem,
				mode: 'same-origin',
				signal: signal
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

				return result;
			}).
			catch(error => {
				// TODO Error handling
				this.error = error;

				if (this.onError) {
					this.onError(error);
				}

				if (this.onResult) {
					this.onResult(1, error);
				}

				return error;
			});
	}

	onStdout(_fn: (data: any) => void): void {}

	onStderr(fn: (data: any) => void): void {
		this.onStderr = fn;

		if (this.error) {
			fn(this.error);
		}
	}

	kill() {
		// TODO What happens to the promise?
		this.abortController.abort();
	}

	onExit(fn: (exitCode: any, result?: string) => void): void {
		this.onResult = fn;

		if (this.result) {
			this.onResult(0, this.result);
		}
	}

	toPromise(): Promise<any> {
		return this.promise;
	}
}

export function runProgram(program: string, values?: any): Process {
	if (!pyodideLoaded) {
		// @Hack: We want to ignore this call until pyodide has loaded.
		return new EmptyProcess();
	}

	values = JSON.stringify(values)
	// values = undefined;
	return new PyodideProcess(new RunpyRequest(program, values));
}

export function synthesizeSnippet(problem: string): Process {
	return new SynthProcess(problem);
}

export function runImgSummary(program: string, line: number, varname: string): Process {
	if (!pyodideLoaded) {
		// @Hack: We want to ignore this call until pyodide has loaded.
		return new EmptyProcess();
	}

	return new PyodideProcess(new ImgSumRequest(program, line, varname));
}

/**
 * Runs the SnipPy helper python code with a request to validate the
 * given user input.
 */
export async function validate(input: string): Promise<string | undefined> {
	if (!pyodideLoaded) {
		// @Hack: We want to ignore this call until pyodide has loaded.
		return new EmptyProcess().toPromise();
	}

	let process = new PyodideProcess(new SnipPyRequest('validate', input));
	let results = (await process.toPromise())[1];

	return results;
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
	let msg = event.data as PyodideResponse;

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
